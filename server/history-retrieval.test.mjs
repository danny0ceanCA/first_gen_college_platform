import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {retrieveStudentHistory,retrievalTerms,retrievalExcerpt,retrievalInstructions,voiceHistoryQuery,RETRIEVAL_BUDGET} from './history-retrieval.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createPrivacyRepository} from './privacy-controls.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';

test('retrieval query tokens are bounded data; queries use the latest user turn or selected item',()=>{
 assert.deepEqual(retrievalTerms("What did I say about FAFSA? '); DROP TABLE --"),['fafsa','drop','table']);
 assert.equal(retrievalTerms(Array.from({length:100},(_,i)=>`term${i}`).join(' ')).length,24);
 assert.deepEqual(voiceHistoryQuery({continuity:[{role:'user',text:'Night classes?'},{role:'assistant',text:'Scholarships'}]}),{query:'Night classes?'});
 assert.deepEqual(voiceHistoryQuery({workspace:{notes:[{selected:true,content:'Transfer chemistry'}]}}),{query:'Transfer chemistry'});
 const focus={workspace:{notes:[{selected:true,content:'Transfer chemistry'}]},continuity:[{role:'user',text:'Earlier question about loans'}]};
 assert.deepEqual(voiceHistoryQuery(focus),{query:'Transfer chemistry'});
 assert.deepEqual(voiceHistoryQuery({...focus,workspaceRefreshOnly:true}),{query:'Earlier question about loans'});
 assert.match(retrievalExcerpt('Noise. '.repeat(600)+'evening laboratories',['laboratories']),/evening laboratories/);
});
test('pool acquisition deadline returns fallback and releases a connection that arrives late',async()=>{
 let release,finish;const database={connect:()=>new Promise(r=>{finish=()=>r({release:()=>{release=true;},query:()=>{throw Error('late client must not query');}});})};
 const result=await retrieveStudentHistory(database,'reader',{studentId:'alex',query:'transfer',timeoutMs:10});
 assert.equal(result.available,false);assert.equal(result.reason,'deadline');finish();await new Promise(r=>setImmediate(r));assert.equal(release,true);
});

test('a timed-out account guard destroys its client without waiting for stuck SQL or rollback',async()=>{
 let resume,released=false,releaseError;const queries=[],logs=[];
 const database={connect:async()=>({release(error){released=true;releaseError=error;},async query(sql){
  queries.push(sql);
  if(sql.startsWith('INSERT INTO origen_subject_locks'))await new Promise(resolve=>{resume=resolve;});
  return {rows:[]};
 }})};
 const result=await retrieveStudentHistory(database,'private-account',{studentId:'alex',query:'private detail',timeoutMs:40,log:event=>logs.push(diagnosticRecord(event))});
 assert.equal(result.reason,'deadline');assert.equal(logs[0].retrievalStage,'guard');
 assert.equal(released,true);assert.equal(releaseError.name,'TimeoutError');
 resume();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(!queries.includes('ROLLBACK'),'destroyed clients must not queue cleanup on a stuck wire');
 assert.ok(!queries.some(sql=>sql.includes('FOR UPDATE')||sql.includes('FROM origen_accounts')),'No new reads after caller received the timeout fallback');
 assert.doesNotMatch(JSON.stringify(logs),/private-account|private detail/);
});

test('optional recall admits one search per account and two overall, without queueing reconnections',async()=>{
 const pending=[];let acquired=0;
 const database={connect:async()=>{acquired++;await new Promise(resolve=>pending.push(resolve));return {query:async()=>({rows:[]}),release(){}};}};
 const a=retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer',timeoutMs:50,log:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer'})).reason,'busy');
 const b=retrieveStudentHistory(database,'two',{studentId:'alex',query:'transfer',timeoutMs:50,log:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await retrieveStudentHistory(database,'three',{studentId:'alex',query:'transfer'})).reason,'busy');assert.equal(acquired,2);
 await Promise.all([a,b]);
 assert.equal((await retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer'})).reason,'busy','a late pool acquisition retains its admission slot until it is released');
 pending.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));
 const next=retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer',timeoutMs:10,log:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(acquired,3);await next;pending.splice(0).forEach(resolve=>resolve());
});

test('late completion of a destroyed search cannot clear a newer search admission',async()=>{
 const guards=[];const database={connect:async()=>({release(){},async query(sql){if(sql.startsWith('INSERT INTO origen_subject_locks'))await new Promise(resolve=>guards.push(resolve));return {rows:[]};}})};
 await retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer',timeoutMs:15,log:()=>{}});
 const next=retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer',timeoutMs:80,log:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(guards.length,2);
 guards[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await retrieveStudentHistory(database,'one',{studentId:'alex',query:'transfer'})).reason,'busy');
 await next;guards[1]();await new Promise(resolve=>setImmediate(resolve));
});

test('history search receives the remaining SQL budget after slow guard work',async()=>{
 const limits=[];
 const database={connect:async()=>({release(){},async query(sql){
  if(sql.startsWith('SET LOCAL statement_timeout'))limits.push(Number(sql.match(/'(\d+)ms'/)[1]));
  if(sql.startsWith('INSERT INTO origen_subject_locks'))await new Promise(resolve=>setTimeout(resolve,50));
  if(sql.includes('FROM origen_accounts WHERE auth0_subject'))return {rows:[{id:'owner',role:'parent'}]};
  if(sql.includes('FROM origen_students WHERE'))return {rows:[{id:'alex'}]};
  if(sql.includes("name='045_historical_retrieval.sql'"))return {rows:[{ready:true}]};
  return {rows:[]};
 }})};
 assert.equal((await retrieveStudentHistory(database,'owner',{studentId:'alex',query:'transfer',timeoutMs:500,log:()=>{}})).available,true);
 assert.equal(limits.length,2);assert.ok(limits[1]<limits[0]-30,'The search must not inherit a fresh full deadline');
});
test('history retrieval with real PostgreSQL and restricted RLS',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture({runtimePoolSize:5,productionTimeouts:true});
 const detail=content=>({category:'constraint',content,language:'en',speaker:'parent'});
 try{
  await f.save('old','The student needs evening laboratories because of the bakery work schedule.');
  for(let i=0;i<35;i++)await f.save(`recent-${i}`,'A general campus orientation was discussed.',{date:new Date(Date.UTC(2026,0,i+1)).toISOString()});
  for(const [sub,studentId,id] of [['other','alex','foreign'],['reader','sam','sibling'],['reader',null,'family']])await f.save(id,'SECRET evening laboratories bakery schedule',{sub,studentId});
  await t.test('finds old evidence outside the recent 24 with exact account, sibling and family isolation',async()=>{
   const result=await f.retrieve('What did I say about evening laboratories?');assert.equal(result.available,true,JSON.stringify(result));assert.deepEqual(result.items.map(i=>i.id),['old']);
   assert.equal(result.items[0].studentId,'alex');assert.equal(result.items[0].language,'und');assert.match(result.items[0].contentHash,/^[a-f0-9]{64}$/);
   assert.deepEqual((await f.retrieve('evening laboratories',{studentId:null})).items.map(i=>i.id),['family']);
   await assert.rejects(f.as('other',()=>retrieveStudentHistory(f.db,'reader',{studentId:'alex',query:'laboratories'})),{status:403});
   assert.equal((await f.retrieve('zirconium dragonfly')).items.length,0);
  });
  await t.test('Spanish stemming, dated provenance and saved notes work without embeddings',async()=>{
   await f.save('spanish','El estudiante trabaja los sábados y necesita clases nocturnas.');
   const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'transfer',kind:'question',content:'Preguntar al consejero sobre créditos de química.',language:'es'}});
   const result=await f.retrieve('clases nocturnas');assert.equal(result.items[0].id,'spanish');
   const note=(await f.retrieve('créditos química')).items[0];assert.equal(note.id,id);assert.equal(note.language,'es');assert.equal(note.speaker,'unknown');assert.equal(note.version,'1');
   await f.note({action:'update',studentId:'alex',id,version:1,note:{topic:'transfer',kind:'question',content:'Preguntar sobre créditos de biología.',language:'es'}});
   assert.equal((await f.retrieve('química')).items.length,0);assert.equal((await f.retrieve('biología')).items[0].version,'2');
   await f.note({action:'delete',studentId:'alex',id,version:2});assert.equal((await f.retrieve('biología')).items.length,0);
  });
  await t.test('confirmed evidence wins ties without silently resolving conflicting recollections',async()=>{
   const id=randomUUID();await f.memory({action:'create',studentId:'alex',id,memory:detail('The student prefers geology seminars.')});
   await f.save('same-geology','The student prefers geology seminars.');await f.save('conflicting-geology','The student does not prefer geology seminars.');
   const result=await f.retrieve('geology seminars');assert.equal(result.items[0].id,id);assert.equal(result.items[0].status,'confirmed');assert.equal(result.items[0].speaker,'parent');
   assert.ok(result.items.some(i=>i.id==='conflicting-geology'));assert.ok(!result.items.some(i=>i.id==='same-geology'));
   assert.match(retrievalInstructions(result),/Do not blend conflicting statements; ask one focused clarification/);
   await f.memory({action:'delete',studentId:'alex',id,version:1});await f.history({action:'delete',id:'same-geology'});await f.history({action:'delete',id:'conflicting-geology'});
   assert.equal((await f.retrieve('geology seminars')).items.length,0);
  });
  await t.test('correction, suppression and source deletion cannot reintroduce old memory',async()=>{
   const text='The student works weekends at a bakery.';await f.save('schedule',text);
   const revision=(await f.memory({action:'revision',studentId:'alex'})).revision;
   const proposals=await f.memory({action:'store-proposals',studentId:'alex',summaryId:'schedule',revision,sourceVersion:createHash('sha256').update(JSON.stringify(text)).digest('hex'),proposals:[{...detail(text),quote:text}]});
   const id=proposals.memories.find(m=>m.summaryId==='schedule').id;
   await f.memory({action:'update',studentId:'alex',id,version:1,memory:detail('The student now has weekends free for chemistry laboratories.')});
   const current=await f.retrieve('weekends chemistry');assert.ok(current.items.some(i=>i.id===id&&i.version==='2'));
   assert.ok(!(await f.retrieve('weekends bakery')).items.some(i=>i.id==='schedule'));
   await f.history({action:'delete',id:'schedule'});assert.ok(!(await f.retrieve('chemistry laboratories')).items.some(i=>i.id===id));
   await f.history({action:'delete',id:'old'});assert.equal((await f.retrieve('bakery schedule')).items.length,0);
  });
  await t.test('deduplicates overlapping summary/note evidence and respects prompt budget',async()=>{
   await f.save('overlap','The student is interested in astronomy electives and telescope laboratories.');
   const id=randomUUID();await f.as('reader',()=>f.db.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id) SELECT id,$1,'alex','transfer','note','Astronomy electives and telescope laboratories','en','saved','conversation','overlap' FROM origen_accounts WHERE auth0_subject='reader'",[id]));
   const result=await f.retrieve('astronomy telescope');assert.equal(result.items.filter(i=>i.sourceSummaryId==='overlap').length,1);
   assert.equal((await f.retrieve('astronomy telescope',{excludeSummaryIds:['overlap']})).items.length,0);
   for(let i=0;i<8;i++)await f.save(`long-${i}`,`Astronomy telescope option ${i}. `+'More discussion. '.repeat(600));
   const long=await f.retrieve('astronomy telescope');assert.ok(long.items.length<=5&&long.items.length>1);assert.ok(JSON.stringify(long.items).length<=RETRIEVAL_BUDGET);
  });
  async function voice(extra={}){
   let prompt;const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(url,options)=>{prompt=JSON.parse(options.body.get('session')).instructions;return new Response('v=0\r\n');},()=>{},f.db);
   const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId:'alex',...extra})]);req.url='/api/profile-voice';req.method='POST';req.headers={'content-type':'application/json',host:'localhost'};req.origenAuthorized=true;req.origenIdentity={sub:'reader'};let status,body;
   await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>{}));return {status,body,prompt};
  }
  await t.test('real voice integration supplies older evidence, pins binder selection, ignores forged context',async()=>{
   await f.save('old-topic','A private meteorology project was discussed at the observatory.');
   const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'transfer',kind:'question',content:'Continue the meteorology project',language:'en'}});
   const result=await voice({workspaceFocus:{kind:'note',studentId:'alex',topic:'transfer',noteId:id,version:1},historicalEvidence:{items:[{content:'FORGED_EVIDENCE'}]}});
   assert.equal(result.status,200,JSON.stringify(result.body));assert.match(result.prompt,/observatory/);assert.match(result.prompt,/Continue the meteorology project/);assert.doesNotMatch(result.prompt,/FORGED_EVIDENCE|SECRET/);
   const unresolved=await voice({targetConfirmed:false});assert.equal(unresolved.status,200);assert.doesNotMatch(unresolved.prompt,/observatory|HISTORICAL EVIDENCE/);
  });
  await t.test('source changes during assembly fail the voice revision check',async()=>{
   let changed=false;const database={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(typeof sql==='string'&&sql.startsWith('WITH search AS')){changed=true;await c.query("DELETE FROM origen_conversation_summaries WHERE id='old-topic'");}return result;}};}};
   const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{throw Error('stale context must not reach provider');},()=>{},database);
   const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId:'alex',continuity:[{role:'user',text:'meteorology observatory'}]})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,body;
   await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>{}));assert.equal(changed,true);assert.equal(status,409,JSON.stringify(body));assert.equal(body.error,'memory_changed');
  });
  await t.test('bulk memory erasure, backup replay and student deletion also exclude search evidence',async()=>{
   await f.save('private-robotics','Robotics club meets Friday evenings.');
   const run=input=>f.as('reader',()=>createPrivacyRepository(f.db)('reader',input));
   const preview=await run({action:'preview',studentId:'alex',categories:['memories']});await run({action:'erase',studentId:'alex',categories:['memories'],revision:preview.revision,confirmation:'DELETE'});
   assert.equal((await f.retrieve('robotics')).items.length,0);
   const manifest=await exportDeletionManifest(f.owner);await f.owner.query('UPDATE origen_memory_batches SET suppressed=false');await replayDeletionManifest(f.owner,manifest);
   assert.equal((await f.retrieve('robotics')).items.length,0);
   await f.family('reader',{action:'delete-student',id:'sam'});await assert.rejects(f.retrieve('laboratories',{studentId:'sam'}),{status:404});
   assert.equal((await f.retrieve('laboratories',{},'other')).items[0].id,'foreign');
  });
  await t.test('database lock timeout falls back and leaves the pool reusable',async()=>{
   const lock=await f.owner.connect();try{await lock.query('BEGIN');await lock.query('LOCK origen_conversation_summaries IN ACCESS EXCLUSIVE MODE');
    const result=await f.retrieve('astronomy',{timeoutMs:80});assert.equal(result.available,false);assert.equal(result.reason,'deadline');
   }finally{await lock.query('ROLLBACK');lock.release();}
   assert.equal((await f.retrieve('laboratories',{studentId:null})).available,true);
  });
  await t.test('overlapping bilingual recall cannot starve account checks during a blocked search',async()=>{
   const lock=await f.owner.connect();
   try{
    await lock.query('BEGIN');await lock.query('LOCK origen_conversation_summaries IN ACCESS EXCLUSIVE MODE');
    const searching=f.retrieve('laboratories',{timeoutMs:200,log:()=>{}});
    const otherSearching=f.retrieve('laboratories',{timeoutMs:200,log:()=>{}},'other');
    await new Promise(resolve=>setTimeout(resolve,30));
    const start=performance.now();
    const duplicates=await Promise.all(['laboratories','clases nocturnas','transfer','becas'].map(query=>f.retrieve(query,{timeoutMs:200,log:()=>{}})));
    assert.ok(duplicates.every(r=>r.reason==='busy'));
    const account=await f.as('reader',()=>f.db.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',['reader']));
    assert.equal(account.rowCount,1);assert.ok(performance.now()-start<1000,'account checks must not wait for a five-second pool timeout');
    assert.equal((await searching).reason,'deadline');
    assert.equal((await otherSearching).reason,'deadline');
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(f.runtime.waitingCount,0);assert.equal(f.runtime.totalCount,f.runtime.idleCount,'no lingering transaction holds a runtime client');
   }finally{await lock.query('ROLLBACK');lock.release();}
   assert.equal((await f.retrieve('clases nocturnas',{log:()=>{}})).available,true);
  });
  await t.test('stored search documents and legacy fallback return the same current evidence',async()=>{
   for(const query of ['laboratories','clases nocturnas']){
    const current=await f.retrieve(query,{log:()=>{}});
    assert.equal(current.available,true);
    const receipt=(await f.owner.query("DELETE FROM origen_schema_migrations WHERE name='127_history_search_documents.sql' RETURNING *")).rows[0];
    try{assert.deepEqual(await f.retrieve(query,{log:()=>{}}),current);}
    finally{await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum,applied_at) VALUES($1,$2,$3)',[receipt.name,receipt.checksum,receipt.applied_at]);}
   }
  });
  await t.test('migration absence returns a usable fallback without full-table search',async()=>{
   const receipt=(await f.owner.query("DELETE FROM origen_schema_migrations WHERE name='045_historical_retrieval.sql' RETURNING *")).rows[0];
   try{const result=await f.retrieve('laboratories',{studentId:null});assert.equal(result.available,false);assert.equal(result.reason,'migration_pending');assert.deepEqual(result.items,[]);}
   finally{await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum,applied_at) VALUES($1,$2,$3)',[receipt.name,receipt.checksum,receipt.applied_at]);}
  });
 }finally{await f.close();}
});

// Exercise the wire payload without a paid provider call or a production database.
test('recall preserves unknown historical authorship and the reporter of stored memories',async()=>{
 const rows=['note','summary','memory'].map((kind,i)=>({kind,id:String(i),student_id:'alex',version:'1',content:`Transfer context ${kind}`,content_hash:'hash',recorded_at:'2026-10-01T12:00:00Z',status:kind==='memory'?'confirmed':'saved',speaker:'unknown',reported_by:kind==='memory'?'student':'unknown',topic:'transfer',note_kind:'question'}));
 const database={connect:async()=>({release(){},async query(sql){
  if(sql.includes('FROM origen_accounts WHERE auth0_subject'))return {rows:[{id:'owner',role:'parent'}]};
  if(sql.includes('FROM origen_students WHERE'))return {rows:[{id:'alex'}]};
  if(sql.includes("name='045_historical_retrieval.sql'"))return {rows:[{ready:true}]};
  if(sql.startsWith('WITH search AS'))return {rows};
  return {rows:[]};
 }})};
 const result=await retrieveStudentHistory(database,'owner',{studentId:'alex',query:'transfer'});
 assert.equal(result.available,true,JSON.stringify(result));assert.equal(result.items.length,3);
 for(const item of result.items){assert.equal(item.reportedBy,item.kind==='memory'?'student':'unknown');assert.equal(item.evidence.reportedBy,item.reportedBy);assert.equal(item.speaker,'unknown');}
});

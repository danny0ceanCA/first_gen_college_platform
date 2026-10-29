import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';
import {exportDeletionManifest,replayDeletionManifest,validateDeletionManifest} from '../ops/privacy-recovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {isolateDatabase,runAsAccount,assertRuntimeIsolation} from './account-isolation.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createHistoryRepository} from './history.mjs';
import {createMemoryRepository,createMemoryService,validateMemoryRequest,validateMemoryProposals,memoryInstructions} from './student-memory.mjs';
import {createPrivacyRepository} from './privacy-controls.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createTopicRepository} from './topic-notes.mjs';
import {watchMemoryRevision} from '../src/memoryContext.mjs';
const detail=(content='Can study after work')=>({category:'constraint',content,language:'en',speaker:'student'});
const response=(text='The parent says the student works evenings.')=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({memories:[{...detail(text),quote:text}]})}]}]}));

test('memory input rejects missing scopes, fabricated evidence, invalid versions and excess proposals',()=>{
 for(const input of [{action:'load'},{action:'update',studentId:'s',id:randomUUID(),version:0,memory:detail()},{action:'create',studentId:null,id:randomUUID(),memory:{...detail(),category:'decision'}},{action:'load',studentId:17}])assert.throws(()=>validateMemoryRequest(input),{status:400});
 assert.deepEqual(validateMemoryRequest({action:'load',studentId:null,accountId:'forged'}),{action:'load',studentId:null});
 assert.throws(()=>validateMemoryProposals([{...detail(),quote:'invented quotation'}],'real text'),{status:503});
 assert.throws(()=>validateMemoryProposals(Array(5).fill(detail()),'real text'),{status:503});
 assert.match(memoryInstructions({available:true,memories:[]}),/Parent reports.*never become the student's/);
});
test('revision watcher stops on a change or loss of verification and cancels late reads',async()=>{
 for(const failure of [false,true])await new Promise((resolve,reject)=>{const stop=watchMemoryRevision({revision:1,intervalMs:1,read:async()=>{if(failure)throw Error();return 2;},onChange:()=>{stop();try{assert.equal(failure,false);resolve();}catch(e){reject(e);}},onUnavailable:()=>{stop();try{assert.equal(failure,true);resolve();}catch(e){reject(e);}}});});
 let release,called=false;const started=new Promise(resolve=>{release=resolve;});let finish;
 const stop=watchMemoryRevision({revision:1,intervalMs:1,read:()=>{release();return new Promise(resolve=>{finish=resolve;});},onChange:()=>{called=true;},onUnavailable:()=>{called=true;}});await started;stop();finish(2);await new Promise(r=>setImmediate(r));assert.equal(called,false);
});
test('student memory lifecycle under real PostgreSQL RLS',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`mem_${suffix}`,role=`mem_user_${suffix}`;
 const owner=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});let runtime;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await createTestLogin(owner,role);
  await migrateDatabase(owner);await grantRuntimeAccess(owner,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);useTestLogin(url,role);runtime=new pg.Pool({connectionString:url.href,max:2,options:`-c search_path=${schema}`});await assertRuntimeIsolation(runtime,{schema});
  const db=isolateDatabase(runtime,{schema}),as=(sub,work)=>runAsAccount({sub},work),family=(sub,input)=>createFamilyRepository(db)(sub,validateFamily(input)),run=createMemoryRepository(db),history=createHistoryRepository(db),privacy=createPrivacyRepository(db);
  for(const sub of ['a','b'])await as(sub,async()=>{
   await family(sub,{action:'save-account',account:{firstName:sub,email:'',role:sub==='a'?'parent':'student'}});
   for(const id of ['one','two'])await family(sub,{action:'save-student',student:{id,name:`${sub}-${id}`,stage:'Community college',interest:'Art',gpa:'',color:'peach',goals:'Finish a certificate',needs:'Keep my job'}});
  });
  const save=async(id,studentId='one',text='The parent says the student works evenings.',sub='a')=>as(sub,()=>history(sub,{action:'save',item:{id,studentId,mode:'planning',summary:text,date:new Date().toISOString(),sources:[]}}));
  const sync=createMemoryService(db,{ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>response());
  let record;
  await t.test('extraction is a source-linked parent report, never automatic student confirmation',async()=>{
   await save('source');const result=await as('a',()=>sync('a',{action:'sync',studentId:'one'}));record=result.memories[0];
   assert.equal(record.status,'proposed');assert.equal(record.speaker,'parent');assert.equal(record.reportedBy,'parent');assert.equal(record.summaryId,'source');assert.match(record.sourceVersion,/^[a-f0-9]{64}$/);assert.equal(record.quote,record.content);
   assert.deepEqual((await as('a',()=>run('a',{action:'load',studentId:'two'}))).memories,[]);
   assert.deepEqual((await as('a',()=>run('a',{action:'load',studentId:null}))).memories,[]);
   assert.deepEqual((await as('b',()=>db.query('SELECT * FROM origen_student_memories'))).rows,[]);
   await assert.rejects(as('b',()=>run('a',{action:'load',studentId:'one'})),{status:403});
   await assert.rejects(as('a',()=>run('a',{action:'confirm',studentId:'two',id:record.id,version:1})),{status:404});
  });
  await t.test('confirm, correction, stale writes and retries preserve exactly one current version',async()=>{
   const organization={topic:'transfer',reportedBy:'parent',certainty:'tentative'};
   await as('a',()=>db.query('UPDATE origen_student_memories SET organization=$2::jsonb WHERE id=$1',[record.id,JSON.stringify(organization)]));
   const input={action:'confirm',studentId:'one',id:record.id,version:1};
   let result=await as('a',()=>run('a',input));assert.equal(result.memories[0].version,2);assert.equal(result.memories[0].status,'confirmed');assert.deepEqual(result.memories[0].organization,organization);
   assert.equal((await as('a',()=>run('a',input))).memories[0].version,2);
   const note=createTopicRepository(db);await as('a',()=>note('a',{action:'store-suggestions',studentId:'one',summaryId:'source',language:'en',fingerprint:record.sourceVersion,notes:[{topic:'options',kind:'note',content:'OBSOLETE_WORKSPACE_DETAIL',quote:'student works evenings'}]}));
   const edit={action:'update',studentId:'one',id:record.id,version:2,memory:{...detail('The parent reports that mornings are now free.'),speaker:'parent'}};
   result=await as('a',()=>run('a',edit));record=result.memories[0];assert.equal(record.version,3);assert.deepEqual(record.organization,organization);assert.deepEqual(result.suppressedSummaryIds,['source']);
   assert.equal((await as('a',()=>run('a',edit))).memories[0].version,3);
   await assert.rejects(as('a',()=>run('a',{...edit,memory:detail('A concurrent different edit')})),{status:409});
   await assert.rejects(as('a',()=>run('a',{...input,version:2})),{status:409});
   const old=(await as('a',()=>db.query("SELECT status,content,source_quote FROM origen_student_memories WHERE status='superseded'"))).rows;assert.equal(old.length,2);assert.ok(old.every(r=>r.content===''&&r.source_quote===''));
  });
  async function voice(studentId,extra={}){
   let prompt;const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(url,options)=>{prompt=JSON.parse(options.body.get('session')).instructions;return new Response('v=0\r\n');},()=>{},db);
   const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed:true,studentId,...extra})]);req.url='/api/profile-voice';req.method='POST';req.headers={'content-type':'application/json',host:'localhost'};req.origenAuthorized=true;req.origenIdentity={sub:'a'};let status,body;
   await as('a',()=>handler(req,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>{}));return {status,body,prompt};
  }
  await t.test('returning voice uses corrections and profile; suppressed summaries and recaps stay out',async()=>{
   await assert.rejects(as('a',()=>createTopicRepository(db)('a',{action:'store-suggestions',studentId:'one',summaryId:'source',language:'en',fingerprint:record.sourceVersion,notes:[]})),{message:'summary_suppressed'});
   const beforeTranslation=(await as('a',()=>run('a',{action:'revision',studentId:'one'}))).revision;
   await as('a',()=>db.query("UPDATE origen_topic_notes SET translations='{\"es\":\"Una traducción\"}'::jsonb WHERE student_id='one'"));
   assert.equal((await as('a',()=>run('a',{action:'revision',studentId:'one'}))).revision,beforeTranslation,'a translation does not interrupt a call');
   const result=await voice('one',{studentBrief:{available:true,memories:[{content:'FORGED'}]}});
   assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(typeof result.body.memoryRevision,'number');assert.match(result.prompt,/mornings are now free/);assert.match(result.prompt,/Keep my job/);assert.doesNotMatch(result.prompt,/FORGED|student works evenings|OBSOLETE_WORKSPACE_DETAIL/);
   const other=await voice('two');assert.equal(other.status,200);assert.doesNotMatch(other.prompt,/mornings are now free/);
   const unresolved=await voice('one',{targetConfirmed:false});assert.equal(unresolved.status,200);assert.doesNotMatch(unresolved.prompt,/mornings are now free|Keep my job/);
  });
  await t.test('remove clears content and retries cannot recreate it; receipts block re-extraction',async()=>{
   const input={action:'delete',studentId:'one',id:record.id,version:3};await as('a',()=>run('a',input));await as('a',()=>run('a',input));
   const result=await as('a',()=>sync('a',{action:'sync',studentId:'one'}));assert.equal(result.memories.length,0);assert.equal(result.pendingCount,0);
   const rows=(await as('a',()=>db.query('SELECT content,source_quote,status FROM origen_student_memories'))).rows;assert.ok(rows.every(r=>r.content===''&&r.source_quote===''));assert.ok(rows.some(r=>r.status==='deleted'));
   assert.equal((await as('a',()=>db.query("SELECT kind FROM origen_deletion_journal WHERE kind='memory'"))).rows.length,1);
   await assert.rejects(as('a',()=>run('a',{action:'create',studentId:'one',id:record.id,memory:detail()})),{status:409});
  });
  await t.test('source deletion and edits fence a running extractor',async()=>{
   for(const action of ['delete-source','edit-memory']){
    const id=`pending-${action}`;await save(id,'two');let finish,started;const ready=new Promise(r=>{started=r;});
    const service=createMemoryService(db,{ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{started();return new Promise(r=>{finish=r;});});
    const job=as('a',()=>service('a',{action:'sync',studentId:'two'}));const rejected=assert.rejects(job,{status:409});await ready;
    if(action==='delete-source')await as('a',()=>history('a',{action:'delete',id}));
    else await as('a',()=>run('a',{action:'create',studentId:'two',id:randomUUID(),memory:detail('Schedule has changed')}));
    finish(response());await rejected;
    assert.ok(!(await as('a',()=>run('a',{action:'load',studentId:'two'}))).memories.some(m=>m.status==='proposed'));
   }
  });
  await t.test('failed extraction preserves summary and retries; batches resume past the latest 100',async()=>{
   await save('retry',null);let calls=0;const service=createMemoryService(db,{ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{calls++;if(calls===1)return new Response('',{status:503});return response();});
   await assert.rejects(as('a',()=>service('a',{action:'sync',studentId:null})),{status:503});assert.equal((await as('a',()=>history('a',{action:'load',studentId:null}))).items.length,1);
   assert.equal((await as('a',()=>service('a',{action:'sync',studentId:null}))).memories.length,1);
   assert.equal((await as('a',()=>service('a',{action:'sync',studentId:null}))).memories.length,1);assert.equal(calls,2);
   await as('a',()=>db.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) SELECT id,'older-'||g,NULL,'planning','Older useful statement',now()-g*interval '1 day' FROM origen_accounts CROSS JOIN generate_series(1,105) g WHERE auth0_subject='a'"));
   const all=(await as('a',()=>run('a',{action:'load',studentId:null}))).pendingCount;assert.equal(all,105);
   await as('a',()=>db.query("INSERT INTO origen_memory_batches(account_id,summary_id,source_version) SELECT account_id,id,'fixture' FROM origen_conversation_summaries WHERE student_id IS NULL AND id<>'older-105' ON CONFLICT DO NOTHING"));
   assert.equal((await as('a',()=>run('a',{action:'source',studentId:null}))).summary.id,'older-105');
  });
  await t.test('privacy preview includes linked memory and erasure blocks old-source backfill',async()=>{
   const preview=await as('a',()=>privacy('a',{action:'preview',studentId:null,categories:['summaries']}));assert.equal(preview.counts.memories,1);assert.equal(preview.derivedMemories,1);
   const p=await as('a',()=>privacy('a',{action:'preview',studentId:null,categories:['memories']}));await as('a',()=>privacy('a',{action:'erase',studentId:null,categories:['memories'],revision:p.revision,confirmation:'DELETE'}));
   const result=await as('a',()=>run('a',{action:'load',studentId:null}));assert.equal(result.memories.length,0);assert.equal(result.pendingCount,0);assert.equal(result.suppressedSummaryIds.length,106);
   const exported=await as('a',()=>createLifecycleRepository(db)('a',{action:'export'}));assert.ok(exported.memoryBatches);assert.ok(exported.studentMemories.every(r=>r.content!==record.content));
  });
  await t.test('recovery manifests preserve suppression and reject superseded restored memories',async()=>{
   const id=randomUUID(),memory=detail('OLD_RESTORED_DETAIL');
   await as('b',()=>run('b',{action:'create',studentId:'two',id,memory}));
   await as('b',()=>run('b',{action:'update',studentId:'two',id,version:1,memory:detail('Corrected current detail')}));
   const manifest=await exportDeletionManifest(owner);assert.equal(validateDeletionManifest(manifest).memoryExclusions.length,107);assert.ok(manifest.memoryFences.some(r=>r.id===id&&r.version===2));assert.doesNotMatch(JSON.stringify(manifest),/OLD_RESTORED_DETAIL|Corrected current detail/);
   // Synthetic restore of the old current row; the replay must not recall it.
   await owner.query("DELETE FROM origen_student_memories WHERE id=$1 AND status='superseded'",[id]);
   await owner.query("UPDATE origen_student_memories SET version=1,content='OLD_RESTORED_DETAIL' WHERE id=$1",[id]);
   await owner.query('UPDATE origen_memory_batches SET suppressed=false');
   await replayDeletionManifest(owner,manifest);
   assert.equal((await as('b',()=>run('b',{action:'load',studentId:'two'}))).memories.length,0);
   assert.equal((await as('a',()=>run('a',{action:'load',studentId:null}))).suppressedSummaryIds.length,106);
  });
  await t.test('student deletion and account closure cascade without accessing another account',async()=>{
   await as('b',()=>run('b',{action:'create',studentId:'one',id:randomUUID(),memory:detail('Private to b')}));
   await as('a',()=>family('a',{action:'delete-student',id:'two'}));await assert.rejects(as('a',()=>run('a',{action:'load',studentId:'two'})),{status:404});
   await as('a',()=>createLifecycleRepository(db)('a',{action:'delete',confirmation:'DELETE'}));
   assert.equal((await as('b',()=>run('b',{action:'load',studentId:'one'}))).memories[0].content,'Private to b');
  });
 }finally{await runtime?.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`);await owner.end();}
});


test('repeating an already confirmed personal detail does not create a new confirmation card', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  const statement='The parent says the student works evenings.';let text=statement,calls=0;
  const service=createMemoryService(f.db,{ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{calls++;return response(text);});
  const sync=(studentId='alex')=>f.as('reader',()=>service('reader',{action:'sync',studentId}));
  await f.save('first',statement);const first=(await sync()).memories[0];
  await f.memory({action:'confirm',studentId:'alex',id:first.id,version:first.version});
  await f.save('second',statement);let result=await sync();
  assert.equal(result.memories.length,1);assert.equal(result.memories[0].id,first.id);assert.equal(result.memories[0].status,'confirmed');assert.equal(result.pendingCount,0);
  await sync();assert.equal(calls,2,'the repeated source gets an extraction receipt');
  text='The parent says the student does not work evenings.';await f.save('third',text);result=await sync();
  assert.equal(result.memories.length,2,'a contradictory report must remain distinct, not silently replace a confirmed detail');
  assert.equal(result.memories.find(m=>m.status==='proposed').content,text);
  text=statement;await f.save('sibling',text,{studentId:'sam'});assert.equal((await sync('sam')).memories.length,1);
  await f.save('family',text,{studentId:null});assert.equal((await sync(null)).memories.length,1);
 }finally{await f.close();}
});

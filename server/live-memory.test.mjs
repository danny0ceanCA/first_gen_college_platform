import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createLiveMemoryRepository,createLiveMemoryService,createLiveMemoryHandler,validateLiveMemoryRequest} from './live-memory.mjs';
import {memoryIntent,acceptsProposal} from './live-memory-intent.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createPrivacyRepository} from './privacy-controls.mjs';
import {voiceMemoryTools} from '../src/voiceMemoryTools.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const change=content=>({kind:'create',category:'constraint',content});

test('live intent requires an explicit exact request or a separately bound confirmation',()=>{
 for(const [spoken,content] of [['Remember that I work evenings.','I work evenings.'],['Por favor, recuerda que trabajo los sábados.','Trabajo los sábados.']])assert.equal(memoryIntent(spoken,change(content)),'authorized');
 for(const text of ['I work evenings.','Do not remember that I work evenings.','Please don’t save my schedule.','No guardes mi horario.','What did I tell you?'])assert.equal(memoryIntent(text,change('I work evenings.')),'not_requested');
 assert.equal(memoryIntent('Save it',change('Extra invented detail')),'clarify');
 assert.equal(memoryIntent('Change I work evenings to I work mornings',{kind:'update',content:'I work mornings'},'I work evenings'),'authorized');
 assert.equal(memoryIntent('Forget I work evenings',{kind:'delete'},'I work evenings'),'authorized');
 assert.equal(memoryIntent('Add email my counselor to my next steps',{kind:'next-step',content:'Email my counselor'}),'authorized');
 assert.equal(memoryIntent('Guarda llamar a la consejera como mi próximo paso',{kind:'next-step',content:'Llamar a la consejera'}),'authorized');
 assert.equal(acceptsProposal('Sí, guárdalo.'),true);assert.equal(acceptsProposal('Yes but save a different thing'),false);
 assert.throws(()=>validateLiveMemoryRequest({action:'read',sessionId:randomUUID(),studentId:'forged'}),{status:400});
});

test('live memory repositories enforce session, consent, receipt and lifecycle boundaries',enabled,async t=>{
 const f=await retrievalFixture(),repo=createLiveMemoryRepository(f.db,{ORIGEN_PERSONALIZATION_MODE:'on'}),service=createLiveMemoryService(f.db,{ORIGEN_PERSONALIZATION_MODE:'on'});
 const run=input=>f.as('reader',()=>repo('reader',input));
 const open=async(studentId='alex')=>run({action:'open',studentId,revision:(await f.memory({action:'revision',studentId})).revision});
 const turn=async(session,sequence,transcript,language='en')=>{const base={sessionId:session.id,sequence,turnId:`turn-${sequence}`,transcript};await run({...base,action:'turn',language});return base;};
 const write=(base,changes,requestId=randomUUID())=>run({...base,action:'write',change:changes,requestId});
 try{
  await t.test('recall is exact-scope and a confirmed voice session is the only way to mint capabilities',async()=>{
   await f.save('old-schedule','The student works at a bakery in the evenings.');await f.save('sibling-secret','SECRET bakery evenings',{studentId:'sam'});
   const s=await open(),base=await turn(s,1,'What was my bakery schedule?');
   const found=await f.as('reader',()=>service('reader',{...base,action:'read',query:'bakery evenings'}));assert.equal(found.status,'retrieved');assert.deepEqual(found.items.map(i=>i.id),['old-schedule']);
   await assert.rejects(f.as('other',()=>repo('other',{...base,action:'inspect'})),{status:409});
   await assert.rejects(run({...base,action:'write',transcript:'Remember that FORGED',change:change('FORGED'),requestId:randomUUID()}),{status:409});
   await run({action:'close',sessionId:s.id});await assert.rejects(run({...base,action:'inspect'}),{status:409});
  });
  await t.test('ordinary speech never writes; exact save and double delivery commit only once',async()=>{
   const s=await open(),casual=await turn(s,1,'I work evenings.'),c=change('I work evenings.');assert.equal((await write(casual,c)).status,'not_requested');
   const base=await turn(s,2,'Remember that I work evenings.'),requestId=randomUUID();
   const [one,two]=await Promise.all([write(base,c,requestId),write(base,c,requestId)]);assert.equal(one.status,'saved');assert.equal(two.id,one.id);assert.equal(one.version,1);
   assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.filter(m=>m.id===one.id).length,1);
   await assert.rejects(write(base,change('Changed request'),requestId),{status:409});
   const exported=(await f.owner.query('SELECT * FROM origen_live_memory_sessions')).rows;assert.doesNotMatch(JSON.stringify(exported),/I work evenings/);
  });
  await t.test('ambiguous requests need one exact, current proposal; yes cannot change its content',async()=>{
   const s=await open(),c=change('I need morning classes.');
   assert.equal((await write(await turn(s,1,'Please save my schedule'),c)).status,'clarification_required');
   // A duplicate registration must not discard an already-issued proposal.
   await turn(s,1,'Please save my schedule');
   const yes=await turn(s,2,'Yes, save it.');assert.equal((await write(yes,change('Unrelated content'))).status,'clarification_required');
   await assert.rejects(write(yes,c),{status:409}); // one proposal per user turn
   const revised=await turn(s,3,'Remember that I need morning classes.');assert.equal((await write(revised,c)).status,'saved');
   const s2=await open();assert.equal((await write(await turn(s2,1,'Guarda mi horario'),change('Trabajo los sábados.'))).status,'clarification_required');
   await run({...{sessionId:s2.id,sequence:1,turnId:'turn-1',transcript:'Guarda mi horario'},action:'present',change:change('Trabajo los sábados.'),presentation:'¿Quieres guardar: Trabajo los sábados.?'});
   assert.equal((await write(await turn(s2,2,'Sí, guárdalo.','es'),change('Trabajo los sábados.'))).status,'saved');
  });
  await t.test('yes cannot authorize a proposal that was never presented or identifies a different target',async()=>{
   const s=await open(),c=change('I need weekend classes'),first=await turn(s,1,'Save my schedule');
   assert.equal((await write(first,c)).status,'clarification_required');
   assert.equal((await run({...first,action:'present',change:c,presentation:'I saved I need weekend classes.'})).status,'not_presented');
   assert.equal((await write(await turn(s,2,'Yes'),c)).status,'clarification_required');
   assert.ok(!(await f.memory({action:'load',studentId:'alex'})).memories.some(m=>m.content===c.content));
   const sibling=await open('sam'),wrong=await turn(sibling,1,'Forget I need morning classes');
   const owned=(await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.content==='I need morning classes.');
   await assert.rejects(write(wrong,{kind:'delete',id:owned.id,version:owned.version}),{status:404});
  });
  await t.test('correction preserves attribution and version; old sessions and old receipts cannot replay after deletion',async()=>{
   const s=await open(),otherSession=await open();const record=(await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.content==='I work evenings.');
   const base=await turn(s,1,'Change I work evenings to I work mornings'),updated=await write(base,{kind:'update',id:record.id,version:1,category:'constraint',content:'I work mornings'});assert.equal(updated.version,2);
   const current=(await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.id===record.id);assert.equal(current.speaker,'parent');assert.equal(current.reportedBy,'parent');
   const stale=await turn(otherSession,1,'Remember that another detail');await assert.rejects(write(stale,change('another detail')),{status:409});
   const deletion=await turn(s,2,'Forget I work mornings');assert.equal((await write(deletion,{kind:'delete',id:record.id,version:2})).status,'saved');
   await assert.rejects(write(base,{kind:'update',id:record.id,version:1,category:'constraint',content:'I work mornings'}),{status:409});
   assert.ok(!(await f.memory({action:'load',studentId:'alex'})).memories.some(m=>m.id===record.id));
  });
  await t.test('accepted next steps reuse plans and cannot become completed actions or duplicate on retry',async()=>{
   const s=await open(),base=await turn(s,1,'Add email my counselor to my next steps'),c={kind:'next-step',category:'education',content:'Email my counselor'},id=randomUUID();
   const saved=await write(base,c,id);assert.equal((await write(base,c,id)).id,saved.id);
   const rows=(await f.as('reader',()=>f.db.query('SELECT status FROM origen_plan_steps WHERE plan_id=$1',[saved.id]))).rows;assert.deepEqual(rows,[{status:'not-started'}]);
   assert.equal((await f.as('reader',()=>f.db.query('SELECT count(*)::int AS n FROM origen_plans WHERE id=$1',[saved.id]))).rows[0].n,1);
  });
  await t.test('new turns, scope erasure, concurrent edits and session expiry fence delayed work',async()=>{
   const s=await open(),base=await turn(s,1,'Remember that a delayed detail');await turn(s,2,'A newer question');await assert.rejects(write(base,change('a delayed detail')),{status:409});
   const current=await turn(s,3,'Remember that a delayed detail');const privacy=input=>f.as('reader',()=>createPrivacyRepository(f.db)('reader',input));
   const preview=await privacy({action:'preview',studentId:'alex',categories:['memories']});await privacy({action:'erase',studentId:'alex',categories:['memories'],revision:preview.revision,confirmation:'DELETE'});await assert.rejects(write(current,change('a delayed detail')),{status:409});
   const expired=await open(),e=await turn(expired,1,'Remember that an expired detail');await f.owner.query("UPDATE origen_live_memory_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);await assert.rejects(write(e,change('an expired detail')),{status:409});
  });
  await t.test('cancellation before commit rolls back content and receipt; a later explicit retry works',async()=>{
   const s=await open(),base=await turn(s,1,'Remember that I prefer examples'),requestId=randomUUID(),abort=new AbortController();
   const db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(String(sql).startsWith('INSERT INTO origen_live_memory_receipts'))abort.abort();return result;}};}};
   await assert.rejects(f.as('reader',()=>createLiveMemoryRepository(db,{ORIGEN_PERSONALIZATION_MODE:'on'})('reader',{...base,action:'write',requestId,change:change('I prefer examples')},{signal:abort.signal})),{name:'AbortError'});
   assert.ok(!(await f.memory({action:'load',studentId:'alex'})).memories.some(m=>m.id===requestId));
   assert.equal((await write(base,change('I prefer examples'),requestId)).status,'saved');
  });
  await t.test('deletion during retrieval rejects the old evidence before returning it',async()=>{
   const s=await open();await f.save('pending-recall','A robotics workshop is planned.');const base=await turn(s,1,'robotics workshop');
   const db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(String(sql).startsWith('WITH search AS'))await c.query("DELETE FROM origen_conversation_summaries WHERE id='pending-recall'");return result;}};}};
   await assert.rejects(f.as('reader',()=>createLiveMemoryService(db,{ORIGEN_PERSONALIZATION_MODE:'on'})('reader',{...base,action:'read',query:'robotics workshop'})),{status:409});
  });
  await t.test('voice advertises tools only for enabled confirmed scopes and ignores forged capabilities',async()=>{
   for(const confirmed of [false,true]){
    let config;const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(u,o)=>{config=JSON.parse(o.body.get('session'));return new Response('v=0\r\n');},()=>{},f.db);
    const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed:confirmed,studentId:'alex',enableLiveMemory:true,liveMemoryEnabled:true})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,body;
    await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>{}));assert.equal(status,200,JSON.stringify(body));assert.equal(config.tools.some(t=>t.name==='recall_student_context'),confirmed);assert.equal(!!body.liveMemorySession,confirmed);
   }
  });
  await t.test('endpoint requires authentication and will not let bodies select account/student scope',async()=>{
   const handler=createLiveMemoryHandler(f.db,{ORIGEN_PERSONALIZATION_MODE:'on'});let status;
   await handler({url:'/api/live-memory'}, {writeHead:s=>{status=s;},end:()=>{}},()=>{});assert.equal(status,401);
   const s=await open(),req=Readable.from([JSON.stringify({action:'read',sessionId:s.id,studentId:'sam'})]);Object.assign(req,{url:'/api/live-memory',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub:'reader'}});
   await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:()=>{}},()=>{}));assert.equal(status,400);
  });
 }finally{await f.close();}
});

test('client coordinator deduplicates, ignores old turns and never announces failed or uncertain saves',async()=>{
 let saved=0,uncertain=0,writes=0,fail=false,finish;
 const post=async body=>{if(body.action==='write'){writes++;if(fail)throw Object.assign(new Error('unavailable'),{status:503});return {status:'saved',revision:2};}if(body.action==='read')return new Promise(r=>{finish=r;});return {status:'registered'};};
 const c=voiceMemoryTools({post,onSaved:()=>{saved++;},onUncertain:()=>{uncertain++;}});c.configure({id:randomUUID(),revision:0});c.begin('a');c.transcript('a','Remember that I like examples');
 const item={name:'save_student_memory',call_id:'save-1',arguments:JSON.stringify(change('I like examples'))};await Promise.all([c.invoke(item),c.invoke(item)]);assert.equal(writes,1);assert.equal(saved,1);
 c.begin('b');c.transcript('b','What was my schedule?');const recall=c.invoke({name:'recall_student_context',call_id:'read-1',arguments:'{"query":"schedule"}'});await new Promise(r=>setImmediate(r));c.begin('c');c.transcript('c','A new question');finish({status:'retrieved',items:[{content:'STALE'}]});assert.equal((await recall).status,'cancelled');
 fail=true;assert.equal((await c.invoke({...item,call_id:'failed'})).status,'unavailable');assert.equal(saved,1);assert.equal(uncertain,0);c.stop();
 const timeout=voiceMemoryTools({post:body=>body.action==='write'?new Promise(()=>{}):Promise.resolve({status:'registered'}),timeoutMs:5,onSaved:()=>{saved++;},onUncertain:()=>{uncertain++;}});timeout.configure({id:randomUUID(),revision:0});timeout.begin('t');timeout.transcript('t','Remember that I like examples');assert.equal((await timeout.invoke(item)).status,'outcome_unknown');assert.equal(saved,1);assert.equal(uncertain,1);timeout.stop();
});
test('a previous student/session cannot deliver a late recall result after reconnect',async()=>{
 let finish;
 const old=voiceMemoryTools({post:body=>body.action==='read'?new Promise(r=>{finish=r;}):Promise.resolve({status:'registered'})});old.configure({id:randomUUID(),revision:0});old.begin('old');old.transcript('old','Remembered schedule?');
 const request=old.invoke({name:'recall_student_context',call_id:'old-read',arguments:'{"query":"schedule"}'});await new Promise(r=>setImmediate(r));old.stop();
 const next=voiceMemoryTools({post:async()=>({status:'registered'})});next.configure({id:randomUUID(),revision:0});next.begin('new');next.transcript('new','A different student');finish({status:'retrieved',items:[{content:'PRIVATE PREVIOUS STUDENT'}]});
 assert.equal((await request).status,'cancelled');next.stop();
});

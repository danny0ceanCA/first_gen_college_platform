import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {personalizationControls} from './personalization-controls.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createLiveMemoryRepository,createLiveMemoryService} from './live-memory.mjs';
import {createMemoryService} from './student-memory.mjs';

const enabled={skip:!process.env.DATABASE_TEST_URL};
const input={sdp:'v=0',mode:'planning',language:'en',role:'parent',studentId:'alex',routeConversations:true,targetConfirmed:true,enableLiveMemory:true};
async function voice(f,env,extra={}){
 let config,status,body;
 const handler=createProfileVoiceHandler({...env,OPENAI_API_KEY:'synthetic'},async(u,o)=>{config=JSON.parse(o.body.get('session'));return new Response('v=0');},()=>{},f.db);
 const req=Readable.from([JSON.stringify({...input,...extra})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});
 await f.as('reader',()=>handler(req,{writeHead(s){status=s;},end(raw){body=JSON.parse(raw);}},()=>assert.fail('missed route')));
 assert.equal(status,200,JSON.stringify(body));return {config,body};
}
test('personalization is default-off, exact-subject cohort controlled, and malformed flags fail closed',()=>{
 for(const env of [{},{ORIGEN_PERSONALIZATION_MODE:'ON'},{ORIGEN_PERSONALIZATION_MODE:'cohort'},{ORIGEN_PERSONALIZATION_MODE:'cohort',ORIGEN_PERSONALIZATION_SUBJECTS:'reader-two'}])assert.equal(personalizationControls(env,'reader').enabled,false);
 const env={ORIGEN_PERSONALIZATION_MODE:'cohort',ORIGEN_PERSONALIZATION_SUBJECTS:' reader, other '};
 assert.deepEqual(personalizationControls(env,'reader'),{enabled:true,retrieval:true,writes:true,adaptive:true,extraction:false});
 assert.equal(personalizationControls(env,undefined).enabled,false);
 for(const value of ['false','FALSE','1',''])assert.equal(personalizationControls({...env,ORIGEN_PERSONALIZATION_RETRIEVAL:value},'reader').retrieval,false);
});

test('rollback retains saved records and scoped fallback, rejects forged controls and fences existing capabilities',enabled,async()=>{
 const f=await retrievalFixture();const env={ORIGEN_PERSONALIZATION_MODE:'cohort',ORIGEN_PERSONALIZATION_SUBJECTS:'reader'};
 const repo=createLiveMemoryRepository(f.db,env),service=createLiveMemoryService(f.db,env);
 const run=body=>f.as('reader',()=>repo('reader',body));
 try{
  const id=randomUUID();await f.memory({action:'create',studentId:'alex',id,memory:{category:'constraint',content:'PRIVATE_NEW_BRIEF',language:'en',speaker:'parent'}});
  const oldText='Removed source says the student wants OLD_PRIVATE_GOAL.';await f.save('removed-source',oldText);
  const proposals=await f.memory({action:'store-proposals',studentId:'alex',summaryId:'removed-source',sourceVersion:createHash('sha256').update(JSON.stringify(oldText)).digest('hex'),revision:(await f.memory({action:'revision',studentId:'alex'})).revision,proposals:[{category:'goal',content:'OLD_PRIVATE_GOAL',language:'en',quote:oldText}]});
  const proposed=proposals.memories.find(m=>m.status==='proposed');await f.memory({action:'delete',studentId:'alex',id:proposed.id,version:proposed.version});
  await f.save('recent','RECENT_SCOPED_SUMMARY');await f.save('sibling','SIBLING_PRIVATE',{studentId:'sam'});
  const on=await voice(f,env);assert.match(on.config.instructions,/PRIVATE_NEW_BRIEF|ADAPTIVE GUIDANCE/);assert.equal(on.config.tools.filter(t=>/student_memory|next_step|student_context/.test(t.name)).length,3);
  const s=on.body.liveMemorySession,base={sessionId:s.id,sequence:1,turnId:'one',transcript:'Remember that a durable detail'};
  await run({...base,action:'turn',language:'en'});
  env.ORIGEN_PERSONALIZATION_LIVE_WRITES='false';
  await assert.rejects(run({...base,action:'write',requestId:randomUUID(),change:{kind:'create',category:'goal',content:'a durable detail'}}),{message:'live_memory_disabled'});
  const readOnly=await voice(f,env);assert.ok(readOnly.config.tools.some(t=>t.name==='recall_student_context'));assert.ok(!readOnly.config.tools.some(t=>t.name==='save_student_memory'));
  env.ORIGEN_PERSONALIZATION_RETRIEVAL='false';
  await assert.rejects(f.as('reader',()=>service('reader',{...base,action:'read',query:'schedule'})),{message:'live_memory_disabled'});
  env.ORIGEN_PERSONALIZATION_MODE='off';
  const off=await voice(f,env,{liveMemoryEnabled:true,adaptiveEnabled:true,liveMemoryReadEnabled:true,ORIGEN_PERSONALIZATION_MODE:'on',studentBrief:{memories:[{content:'FORGED'}]}});
  assert.doesNotMatch(off.config.instructions,/PRIVATE_NEW_BRIEF|OLD_PRIVATE_GOAL|SIBLING_PRIVATE|FORGED|ADAPTIVE GUIDANCE|HISTORICAL EVIDENCE/);
  assert.match(off.config.instructions,/RECENT_SCOPED_SUMMARY/);assert.equal(off.body.liveMemorySession,undefined);assert.ok(Number.isInteger(off.body.memoryRevision));
  assert.equal((await f.memory({action:'load',studentId:'alex'})).memories[0].id,id);
  assert.equal((await run({action:'close',sessionId:s.id})).status,'closed');
  env.ORIGEN_PERSONALIZATION_MODE='cohort';env.ORIGEN_PERSONALIZATION_SUBJECTS='other';
  assert.equal((await voice(f,env)).body.liveMemorySession,undefined);
 }finally{await f.close();}
});

test('disabling writes while a transaction is in flight rolls back both record and receipt',enabled,async()=>{
 const f=await retrievalFixture(),env={ORIGEN_PERSONALIZATION_MODE:'on'};
 const repo=createLiveMemoryRepository(f.db,env),run=body=>f.as('reader',()=>repo('reader',body));
 try{
  const s=await run({action:'open',studentId:'alex',revision:0}),id=randomUUID(),base={sessionId:s.id,sequence:1,turnId:'one',transcript:'Remember that I prefer examples'};
  await run({...base,action:'turn',language:'en'});
  const db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(String(sql).startsWith('INSERT INTO origen_live_memory_receipts'))env.ORIGEN_PERSONALIZATION_LIVE_WRITES='false';return result;}};}};
  await assert.rejects(f.as('reader',()=>createLiveMemoryRepository(db,env)('reader',{...base,action:'write',requestId:id,change:{kind:'create',category:'preference',content:'I prefer examples'}})),{message:'live_memory_disabled'});
  assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.length,0);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_live_memory_receipts')).rows[0].n,0);
 }finally{await f.close();}
});

test('disabled extraction makes no paid request; an in-flight result cannot create proposals after disable',enabled,async()=>{
 const f=await retrievalFixture(),env={ORIGEN_PERSONALIZATION_MODE:'on',OPENAI_API_KEY:'synthetic'};let calls=0,finish,started;
 const began=new Promise(r=>{started=r;});
 const service=createMemoryService(f.db,env,async()=>{calls++;started();return new Promise(r=>{finish=r;});});
 const run=action=>f.as('reader',()=>service('reader',{action,studentId:'alex'}));
 try{
  await f.save('source','The student needs morning classes.');
  const disabled=await run('sync');assert.equal(calls,0);assert.equal(disabled.extractionEnabled,false);assert.equal(disabled.pendingCount,1);
  env.ORIGEN_PERSONALIZATION_EXTRACTION='true';const pending=run('sync');await began;
  env.ORIGEN_PERSONALIZATION_MODE='off';finish(new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({memories:[{category:'constraint',content:'Needs morning classes.',language:'en',quote:'The student needs morning classes.'}]})}]}]})));
  assert.equal((await pending).extractionEnabled,false);assert.equal((await run('load')).memories.length,0);assert.equal(calls,1);
  assert.equal((await f.history({action:'load',studentId:'alex'})).items.length,1);
 }finally{await f.close();}
});

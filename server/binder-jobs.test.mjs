import {binderFixture as fixture} from './binder-jobs-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBinderProcessor,binderJobStatus,startBinderWorker} from './binder-jobs.mjs';
import {createTopicNotesHandler} from './topic-notes.mjs';
import {Readable} from 'node:stream';
import {createPrivacyRepository} from './privacy-controls.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const env=()=>({ORIGEN_BINDER_JOBS:'true',OPENAI_API_KEY:'synthetic'});
const output=(content='The student asked about evening labs.')=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({notes:[{topic:'transfer',kind:'question',content:'Are evening labs offered?',quote:content}]})}]}]}));

test('saved summaries atomically enqueue jobs; two workers cannot claim the same job; restart/retry preserves one set of notes',enabled,async()=>{
 const f=await fixture();let calls=0;const settings=env();
 try{
  await f.save('source','The student asked about evening labs.');
  const pair=await Promise.all([f.claim(),f.claim()]),job=pair.find(Boolean);assert.equal(pair.filter(Boolean).length,1);assert.equal(job.summary_id,'source');assert.equal(job.attempts,1);assert.ok(job.permission_revision);
  const failed=createBinderProcessor(f.db,settings,async()=>{calls++;return new Response('',{status:503});});assert.equal(await failed(job),'pending');assert.equal((await f.notes()).notes.length,0);
  await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");
  // New processor has no in-memory history: the durable row is the retry source.
  const retry=await f.claim(),process=createBinderProcessor(f.db,settings,async()=>{calls++;return output();});assert.equal(retry.attempts,2);assert.equal(await process(retry),'complete');assert.equal((await f.notes()).notes.length,1);assert.equal(calls,2);
  assert.equal(await f.claim(),null);
  await f.history({action:'save',item:{id:'source',studentId:'alex',mode:'planning',summary:'The student asked about evening labs.',sources:[],date:new Date().toISOString()}});
  assert.equal(await f.claim(),null);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_binder_jobs')).rows[0].n,1);
  assert.equal((await f.notes('other')).notes.length,0);assert.equal((await f.notes('reader','sam')).notes.length,0);
 }finally{await f.close();}
});
test('lease expiry permits recovery but an obsolete worker cannot commit',enabled,async()=>{
 const f=await fixture();try{
  await f.save('source','The student asked about evening labs.');const old=await f.claim();
  await f.owner.query("UPDATE origen_binder_jobs SET lease_until=now()-interval '1 second'");const current=await f.claim();assert.notEqual(current.lease_token,old.lease_token);
  assert.equal(await createBinderProcessor(f.db,env(),async()=>output())(old),'cancelled');assert.equal((await f.notes()).notes.length,0);
  assert.equal(await createBinderProcessor(f.db,env(),async()=>output())(current),'complete');assert.equal((await f.notes()).notes.length,1);
 }finally{await f.close();}
});
test('deletion, suppression, permission withdrawal and disable during provider work cannot publish notes',enabled,async()=>{
 for(const event of ['delete','suppress','permission','disable','erase-notes']){
  const f=await fixture(),settings=env();try{
   await f.save('source','The student asked about evening labs.');const job=await f.claim();
   const process=createBinderProcessor(f.db,settings,async()=>{
    if(event==='delete')await f.history({action:'delete',id:'source'});
    if(event==='suppress')await f.owner.query("INSERT INTO origen_memory_batches(account_id,summary_id,source_version,suppressed) VALUES($1,'source','removed',true)",[job.account_id]);
    if(event==='permission')await f.as('reader',()=>f.permission.account('reader',{action:'withdraw'}));
    if(event==='erase-notes'){const privacy=body=>f.as('reader',()=>createPrivacyRepository(f.db)('reader',body));const selection=await privacy({action:'preview',studentId:'alex',categories:['notes']});await privacy({action:'erase',studentId:'alex',categories:['notes'],revision:selection.revision,confirmation:'DELETE'});}
    if(event==='disable')settings.ORIGEN_BINDER_JOBS='false';return output();
   });
   assert.ok(['cancelled','pending'].includes(await process(job)));assert.equal((await f.notes()).notes.length,0,event);
   if(event==='delete')assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_binder_jobs')).rows[0].n,0);
  }finally{await f.close();}
 }
});
test('worker disable and old permission revisions make no paid request; per-account persisted attempt budget bounds retries',enabled,async()=>{
 const f=await fixture();let calls=0;try{
  await f.save('source','The student asked about evening labs.');const job=await f.claim();
  const settings=env();settings.ORIGEN_BINDER_JOBS='false';assert.equal(await createBinderProcessor(f.db,settings,async()=>{calls++;return output();})(job),'pending');assert.equal(calls,0);
  settings.ORIGEN_BINDER_JOBS='true';await f.as('reader',()=>f.permission.account('reader',{action:'withdraw'}));
  await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");const stale=await f.claim();assert.equal(await createBinderProcessor(f.db,settings,async()=>{calls++;return output();})(stale),'cancelled');assert.equal(calls,0);
  await f.owner.query("UPDATE origen_eligibility SET status='adult',revision=revision+1");await f.save('next','The student asked about evening labs.');
  await f.owner.query("UPDATE origen_binder_jobs SET attempt_times=array_fill(now(),ARRAY[20]) WHERE summary_id='source'");assert.equal(await f.claim(),null);
 }finally{await f.close();}
});
test('queue HTTP sync returns before provider work, reports failures, and explicit retry is bounded; language is retained',enabled,async()=>{
 const f=await fixture();let calls=0;try{
  await f.history({action:'save',language:'es',item:{id:'spanish',studentId:'alex',mode:'planning',summary:'La estudiante preguntó por laboratorios vespertinos.',sources:[],date:new Date().toISOString()}});
  assert.equal((await f.owner.query('SELECT language FROM origen_binder_jobs')).rows[0].language,'es');
  const handler=createTopicNotesHandler(f.db,env(),async()=>{calls++;throw Error('HTTP must not call a model');});
  const req=Readable.from([JSON.stringify({action:'sync',studentId:'alex',language:'es'})]);Object.assign(req,{url:'/api/topic-notes',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,data;
  await f.as('reader',()=>handler(req,{writeHead(s){status=s;},end(raw){data=JSON.parse(raw);}},()=>{}));assert.equal(status,200);assert.equal(data.background.pending,1);assert.equal(calls,0);
  await f.owner.query("UPDATE origen_binder_jobs SET status='failed',attempts=5");
  const retry=()=>f.as('reader',()=>binderJobStatus(f.db,'reader',{action:'retry',studentId:'alex'}));
  for(let i=0;i<2;i++){assert.equal((await retry()).pending,1);await f.owner.query("UPDATE origen_binder_jobs SET status='failed',attempts=5");}
  const exhausted=await retry();assert.equal(exhausted.failed,1);assert.equal(exhausted.canRetry,false);assert.equal((await f.owner.query('SELECT manual_retries FROM origen_binder_jobs')).rows[0].manual_retries,2);
 }finally{await f.close();}
});


test('background loop organizes a saved summary with no open browser; shutdown leaves unfinished work retryable',enabled,async()=>{
 const f=await fixture();let stop;
 try{
  await f.save('source','The student asked about evening labs.');
  stop=startBinderWorker({application:f.db,maintenance:f.maintenance,schema:f.schema,env:env(),request:async()=>output(),intervalMs:10});
  for(let i=0;i<200;i++){if((await f.notes()).notes.length)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal((await f.notes()).notes.length,1);await stop();stop=undefined;
  await f.save('interrupted','The student asked about evening labs.');const job=await f.claim(),abort=new AbortController();
  const result=await createBinderProcessor(f.db,env(),async()=>{abort.abort();return output();})(job,{signal:abort.signal});
  assert.equal(result,'pending');assert.equal((await f.owner.query("SELECT status FROM origen_binder_jobs WHERE summary_id='interrupted'")).rows[0].status,'pending');
 }finally{await stop?.();await f.close();}
});
test('automatic retries terminate and an expired last attempt becomes a visible failure',enabled,async()=>{
 const f=await fixture();try{
  await f.save('source','The student asked about evening labs.');const process=createBinderProcessor(f.db,env(),async()=>new Response('',{status:503}));
  for(let i=1;i<=5;i++){await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");const job=await f.claim();assert.equal(job.attempts,i);assert.equal(await process(job),i===5?'failed':'pending');}
  assert.equal(await f.claim(),null);
  await f.owner.query("UPDATE origen_binder_jobs SET status='running',lease_until=now()-interval '1 second'");assert.equal(await f.claim(),null);
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_jobs')).rows[0].status,'failed');
 }finally{await f.close();}
});

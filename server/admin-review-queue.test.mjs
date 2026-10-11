import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {adminReviewQueue,adminReviewEvidence,adminReviewHistory,reviewQueueItem,purgeAdminReviews} from './admin-review-queue.mjs';
import {createAuditedAdminHandler as createAdminHandler,staffTestIdentity} from './staff-test-fixture.mjs';
const now=new Date('2026-10-09T22:00:00Z'),uuid=()=>crypto.randomUUID();
test('queue inputs and decisions fail before querying; missing migration is explicit',async()=>{
 const db={query:()=>assert.fail('unexpected query'),connect:()=>assert.fail('unexpected connection')};
 for(const input of [{days:2},{page:0},{page:10001},{status:'sql'},{kind:'abandoned'},{recovery:'failed'},{evidence:'absent'},{asOf:5},{asOf:'2026-10-10'},{asOf:'2026-09-01'}])await assert.rejects(adminReviewQueue(db,input,now),{status:400});
 for(const input of [{accountId:'bad',key:'a'.repeat(32)},{accountId:uuid(),key:'bad'},{accountId:uuid(),key:'a'.repeat(32),status:'resolved',revision:'x',reason:'recovery_observed'},{accountId:uuid(),key:'a'.repeat(32),revision:'a'.repeat(64),status:'resolved',reason:'private notes'}])await assert.rejects(reviewQueueItem(db,'admin',input,now),{status:400});
 let calls=0;const report=await adminReviewQueue({query:async()=>{calls++;return {rows:[]};}},{},now);assert.equal(report.coverage.available,false);assert.equal(calls,1);
});
test('queue, evidence, history and writes require admin permission and return safe errors',async()=>{
 for(const action of ['review-queue','review-history','review-evidence','review-decision']){
  for(const authorized of [false,true]){
   const req=Object.assign(Readable.from([JSON.stringify({action})]),{url:'/api/admin',method:'POST',origenAuthorized:authorized,origenIdentity:{sub:'ordinary'}});let status;
   await createAdminHandler({query:()=>assert.fail('unauthorized read'),connect:()=>assert.fail('unauthorized write')},{})(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,authorized?403:401);
  }
 }
 let status,payload;const call=method=>Object.assign(Readable.from([JSON.stringify({action:'review-queue'})]),{url:'/api/admin',method,origenAuthorized:true,origenIdentity:staffTestIdentity('admin')});
 const res={writeHead:s=>status=s,end:v=>payload=JSON.parse(v)};
 await createAdminHandler({query:()=>assert.fail()},{})(call('GET'),res,()=>{});assert.equal(status,405);
 await createAdminHandler({query:()=>{throw Error('PRIVATE database password');}},{})(call('POST'),res,()=>{});assert.equal(status,503);assert.equal(payload.error,'review_queue_unavailable');
});
const enabled=!!(process.env.ADMIN_TEST_PGLITE_MODULE||process.env.DATABASE_TEST_URL);
test('PostgreSQL review queue groups explicit failures, verifies recovery, audits decisions and reopens new evidence',{skip:!enabled},async()=>{
 let db,close;if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);db=new PGlite();close=()=>db.close();}else{const {Client}=await import('pg');db=new Client({connectionString:process.env.DATABASE_TEST_URL});await db.connect();close=()=>db.end();}
 const schema='review_'+uuid().replaceAll('-',''),owner=uuid(),other=uuid(),attempt=uuid(),voice=uuid(),session=uuid(),segment=uuid(),anotherSegment=uuid();
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 try{
  await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);
  for(const sql of [
   'CREATE TABLE origen_accounts(id uuid PRIMARY KEY,first_name text)',
   'CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)',
   'CREATE TABLE origen_guidance_sessions(account_id uuid,id uuid,started_at timestamptz)',
   'CREATE TABLE origen_guidance_events(account_id uuid,session_id uuid,segment_id uuid,producer text,name text,received_at timestamptz,payload jsonb)',
   'CREATE TABLE origen_ai_executions(account_id uuid,session_id uuid,segment_id uuid,id uuid,operation text,status text,error_code text,finished_at timestamptz)',
   'CREATE TABLE origen_summary_segments(account_id uuid,segment_id uuid,summary_id text)',
   'CREATE TABLE origen_conversation_summaries(account_id uuid,id text,created_at timestamptz,summary text)'
  ])await db.query(sql);
  for(const name of ['019_voice_quality.sql','027_onboarding_events.sql','029_admin_issue_reviews.sql']){const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');if(db.exec)await db.exec(sql);else await db.query(sql);}
  await db.query("INSERT INTO origen_accounts VALUES($1,'Sample student'),($2,'Other account')",[owner,other]);
  await db.query("INSERT INTO origen_schema_migrations VALUES('029_admin_issue_reviews.sql','2026-10-01'),('015_guidance_history.sql','2026-10-01'),('019_voice_quality.sql','2026-10-01'),('027_onboarding_events.sql','2026-10-01')");
  const visit=async(account,id,saved=null)=>db.query("INSERT INTO origen_onboarding_attempts(account_id,id,started_at,last_received_at,saved_at) VALUES($1,$2,'2026-10-08T12:00Z','2026-10-08T12:30Z',$3)",[account,id,saved]);
  const event=async(account,id,name,seq,time='2026-10-08T12:01Z',metadata={},producer='client')=>db.query('INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at,received_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',[account,id,producer,seq,name,time,JSON.stringify(metadata)]);
  const quality=async(account,sessionId,attemptId,name,seq,time='2026-10-08T12:01Z',state=null)=>db.query("INSERT INTO origen_voice_quality_events(account_id,session_id,attempt_id,event,sequence,received_at,connection_state,code) VALUES($1,$2,$3,$4,$5,$6,$7,'PRIVATE')",[account,sessionId,attemptId,name,seq,time,state]);
  const execution=async(account,seg,code='summary_unavailable',time='2026-10-08T12:05Z',status='failed')=>db.query("INSERT INTO origen_ai_executions VALUES($1,$2,$3,$4,'summary',$5,$6,$7)",[account,session,seg,uuid(),status,code,time]);
  const store=async(account,seg,id,time='2026-10-08T12:06Z')=>{await db.query("INSERT INTO origen_conversation_summaries VALUES($1,$2,$3,'PRIVATE summary content')",[account,id,time]);await db.query('INSERT INTO origen_summary_segments VALUES($1,$2,$3)',[account,seg,id]);await db.query("INSERT INTO origen_guidance_events VALUES($1,$2,$3,'server','summary.saved',$4,$5)",[account,session,seg,time,JSON.stringify({summaryId:id,private:'PRIVATE'})]);};
  await visit(owner,attempt,'2026-10-08T12:03Z');await event(owner,attempt,'save_failed',1);await event(owner,attempt,'save_failed',2,'2026-10-08T12:02Z');await event(owner,attempt,'voice_connection_failed',3,undefined,{voiceAttemptId:voice,private:'PRIVATE'});await event(owner,attempt,'voice_connected',4,'2026-10-08T12:04Z');await event(owner,attempt,'tracking_delivery_gap',5);await event(owner,attempt,'save_confirmation_interrupted',6);
  await quality(owner,session,voice,'connection_failure',1);await quality(owner,session,voice,'response_cancelled',2);
  await db.query("INSERT INTO origen_guidance_sessions VALUES($1,$3,'2026-10-08'),($2,$3,'2026-10-08')",[owner,other,session]);
  await execution(owner,segment);await store(other,segment,'other-owner');await store(owner,anotherSegment,'other-student');
  let report=await adminReviewQueue(pool,{},now);assert.equal(report.total,3);assert.equal(report.counts.recovered,2);assert.equal(report.items.find(x=>x.kind==='profile_save').occurrences,2);assert.equal(report.items.find(x=>x.kind==='summary_processing').recoveryAt,null);assert.equal(report.items.filter(x=>x.kind==='connection').length,1);
  const gap=await adminReviewQueue(pool,{evidence:'gaps'},now);assert.equal(gap.total,1);assert.equal(gap.items[0].kind,'telemetry_gap');assert.equal(gap.items[0].recoveryAt,null);
  await store(owner,segment,'correct-segment');report=await adminReviewQueue(pool,{kind:'summary_processing'},now);assert.ok(report.items[0].recoveryAt);
  await execution(owner,segment,'summary_storage_failed','2026-10-08T12:10Z');assert.equal((await adminReviewQueue(pool,{kind:'summary_save'},now)).items[0].recoveryAt,null);
  await store(owner,segment,'future-save','2026-10-09T23:00Z');assert.equal((await adminReviewQueue(pool,{kind:'summary_save'},now)).items[0].recoveryAt,null);
  await visit(other,attempt);await event(other,attempt,'save_failed',1);await event(other,attempt,'fields_updated',2,undefined,{fields:{notes:true},private:'PRIVATE'});
  report=await adminReviewQueue(pool,{},now);const item=report.items.find(x=>x.kind==='profile_save'&&x.accountId===owner),key={key:item.key,accountId:owner};
  const evidence=await adminReviewEvidence(pool,key,now);assert.equal(evidence.total,5);assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE|metadata|fields_updated/);
  await assert.rejects(adminReviewEvidence(pool,{...key,accountId:other},now),{status:404});
  let decision={...key,revision:item.revision,status:'investigating',reason:'investigating'};
  assert.deepEqual(await reviewQueueItem(pool,'auth0|reviewer',decision,now),{saved:true});
  await assert.rejects(reviewQueueItem(pool,'auth0|reviewer2',decision,now),{status:409}); // Same request timestamp after lock still sees committed review.
  const later=new Date(+now+1000);let updated=(await adminReviewQueue(pool,{status:'all'},later)).items.find(x=>x.key===item.key);assert.equal(updated.status,'investigating');
  await reviewQueueItem(pool,'auth0|reviewer2',{...key,revision:updated.revision,status:'resolved',reason:'recovery_observed'},later);
  let audit=await adminReviewHistory(pool,key);assert.equal(audit.total,2);assert.deepEqual(audit.items.map(x=>x.status),['resolved','investigating']);assert.doesNotMatch(JSON.stringify(audit),/auth0|reviewer_hash|PRIVATE/);
  updated=(await adminReviewQueue(pool,{status:'resolved'},new Date(+now+2000))).items.find(x=>x.key===item.key);assert.ok(updated);
  // A new failure changes the evidence revision and reopens the existing item.
  await event(owner,attempt,'save_failed',7,'2026-10-09T22:00:03Z');
  const nextTime=new Date(+now+4000);updated=(await adminReviewQueue(pool,{},nextTime)).items.find(x=>x.key===item.key);assert.equal(updated.status,'open');assert.equal(updated.newEvidence,true);assert.equal(updated.recoveryAt,null);
  await assert.rejects(reviewQueueItem(pool,'admin',{...key,revision:updated.revision,status:'resolved',reason:'recovery_observed'},nextTime),{status:409});
  await assert.rejects(reviewQueueItem(pool,'admin',{...decision,status:'resolved',reason:'fix_verified'},nextTime),{status:409});
  assert.equal((await adminReviewQueue(pool,{asOf:now.toISOString()},nextTime)).items.find(x=>x.key===item.key).occurrences,2);
  // Independent attempts do not borrow a connection success from another call.
  const failedVoice=uuid();await quality(owner,session,failedVoice,'connection_failure',1);await quality(other,session,failedVoice,'connection_state',2,'2026-10-08T12:04Z','connected');
  let voiceItem=(await adminReviewQueue(pool,{kind:'connection'},nextTime)).items.find(x=>x.source==='voice');assert.equal(voiceItem.recoveryAt,null);
  await quality(owner,session,failedVoice,'connection_state',2,'2026-10-08T12:04Z','connected');voiceItem=(await adminReviewQueue(pool,{kind:'connection'},nextTime)).items.find(x=>x.source==='voice');assert.ok(voiceItem.recoveryAt);
  assert.equal((await adminReviewEvidence(pool,{accountId:owner,key:voiceItem.key},nextTime)).total,2);
  // Older diagnostics disappearing must not impersonate a newly received failure.
  await quality(owner,session,failedVoice,'connection_failure',3,'2026-10-07T12:01Z');
  voiceItem=(await adminReviewQueue(pool,{kind:'connection'},nextTime)).items.find(x=>x.source==='voice');
  await reviewQueueItem(pool,'admin',{accountId:owner,key:voiceItem.key,revision:voiceItem.revision,status:'resolved',reason:'review_complete'},nextTime);
  await db.query('DELETE FROM origen_voice_quality_events WHERE account_id=$1 AND attempt_id=$2 AND sequence=3',[owner,failedVoice]);
  const afterRetention=(await adminReviewQueue(pool,{kind:'connection',status:'all'},new Date(+nextTime+1000))).items.find(x=>x.key===voiceItem.key);
  assert.equal(afterRetention.status,'resolved');assert.equal(afterRetention.newEvidence,false);
  // Stable pagination and bounded evidence/audit lists.
  for(let i=0;i<23;i++){const id=uuid();await visit(owner,id);await event(owner,id,'audio_playback_blocked',1);}
  const one=await adminReviewQueue(pool,{status:'all',evidence:'all'},nextTime),two=await adminReviewQueue(pool,{status:'all',evidence:'all',page:2,asOf:one.window.end},nextTime);assert.equal(one.items.length,20);assert.equal(new Set([...one.items,...two.items].map(x=>x.key)).size,one.total);
  for(let i=20;i<55;i++)await event(owner,attempt,'voice_connected',i);
  const e1=await adminReviewEvidence(pool,key,nextTime),e2=await adminReviewEvidence(pool,{...key,page:2,asOf:nextTime.toISOString()},nextTime);assert.equal(e1.items.length,30);assert.equal(e1.items.length+e2.items.length,e1.total);
  // Expired visits cannot be reviewed even before physical cleanup runs.
  await db.query("UPDATE origen_onboarding_attempts SET last_received_at='2026-09-30' WHERE account_id=$1 AND id=$2",[owner,attempt]);
  assert.equal((await adminReviewQueue(pool,{status:'all'},nextTime,{ONBOARDING_RETENTION_DAYS:'7'})).items.some(x=>x.key===item.key),false);
  await purgeAdminReviews(pool,nextTime,{ONBOARDING_RETENTION_DAYS:'7'});assert.equal((await adminReviewHistory(pool,key)).total,0);
  // Account deletion cascades audit rows.
  const another=(await adminReviewQueue(pool,{kind:'playback'},nextTime)).items[0];await reviewQueueItem(pool,'admin',{accountId:owner,key:another.key,revision:another.revision,status:'investigating',reason:'investigating'},nextTime);
  await db.query('DELETE FROM origen_accounts WHERE id=$1',[owner]);assert.equal(Number((await db.query('SELECT count(*) AS n FROM origen_admin_issue_reviews WHERE account_id=$1',[owner])).rows[0].n),0);
 }finally{await db.query('SET search_path TO public');await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await close();}
});

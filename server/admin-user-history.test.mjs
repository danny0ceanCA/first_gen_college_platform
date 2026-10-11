import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {adminUserHistory,historyFilters,historyRecap,presentHistoryEvent} from './admin-user-history.mjs';
import {createAuditedAdminHandler as createAdminHandler,staffTestIdentity} from './staff-test-fixture.mjs';
const now=new Date('2026-10-09T22:00:00Z');

test('user history rejects invalid scope, filters and stale/future cutoffs before reading',async()=>{
 const id=crypto.randomUUID(),db={query:()=>assert.fail('invalid request accessed database')};
 for(const input of [{id:'bad'},{id,days:1},{id,page:0},{id,page:1.2},{id,page:10001},{id,category:'injected'},{id,asOf:42},{id,asOf:'invalid'},{id,asOf:'2026-10-10'},{id,asOf:'2026-10-01'}])await assert.rejects(adminUserHistory(db,input,now),{status:400});
 assert.equal(historyFilters({id},now).window.end,now.toISOString());
 await assert.rejects(adminUserHistory({query:async()=>({rows:[]})},{id},now),{status:404});
});

test('unified history requires admin permission and hides database failures',async()=>{
 for(const authorized of [false,true]){
  const req=Object.assign(Readable.from([JSON.stringify({action:'user-history',id:crypto.randomUUID()})]),{url:'/api/admin',method:'POST',origenAuthorized:authorized,origenIdentity:{sub:'auth0|regular'}});let status;
  await createAdminHandler({query:()=>assert.fail('unauthorized database read')},{})(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,authorized?403:401);
 }
 const req=Object.assign(Readable.from([JSON.stringify({action:'user-history',id:crypto.randomUUID()})]),{url:'/api/admin',method:'POST',origenAuthorized:true,origenIdentity:staffTestIdentity('auth0|admin')});let status,payload;
 await createAdminHandler({query:()=>{throw new Error('private database credentials');}},{})(req,{writeHead:s=>status=s,end:value=>payload=JSON.parse(value)},()=>{});
 assert.equal(status,503);assert.deepEqual(payload,{error:'user_history_unavailable'});
});

test('recaps and call descriptions preserve uncertainty without claiming abandonment or active calls',()=>{
 const recap=historyRecap({onboarding_started_at:'2026-10-01'},{visits:2,calls:1,problems:2,gaps:1});
 assert.equal(recap.title,'Setup started; save not confirmed');assert.match(recap.lines.join(' '),/does not establish a save failure/);assert.match(recap.lines.join(' '),/same incident/);assert.doesNotMatch(recap.lines.join(' '),/abandoned|resolved successfully/);
 assert.equal(historyRecap({onboarding_completed_at:'2026-10-01'},{summaries:2,home_arrivals:1}).title,'Profile save confirmed');
 const event=presentHistoryEvent({id:'one',kind:'voice_call',details:{topic:'planning',seconds:60},problem:false});assert.match(event.note,/1 recorded connected minutes/);assert.match(event.note,/does not mean the call is active/);
 assert.match(presentHistoryEvent({kind:'voice_call',details:{seconds:null}}).note,/Duration at this report cutoff is unavailable/);
});

const enabled=!!(process.env.DATABASE_TEST_URL||process.env.ADMIN_TEST_PGLITE_MODULE);
test('PostgreSQL unified history isolates accounts, paginates, deduplicates saves and separates storage from generation',{skip:!enabled},async()=>{
 let db,close;
 if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);db=new PGlite();close=()=>db.close();}
 else{const {Client}=await import('pg');db=new Client({connectionString:process.env.DATABASE_TEST_URL});await db.connect();close=()=>db.end();}
 const schema=`admin_history_${crypto.randomUUID().replaceAll('-','')}`,id=crypto.randomUUID(),other=crypto.randomUUID(),visit=crypto.randomUUID();
 try{
  await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);await db.query("SET TIME ZONE 'UTC'");
  for(const sql of [
   'CREATE TABLE origen_accounts(id uuid,created_at timestamptz,onboarding_started_at timestamptz,onboarding_completed_at timestamptz)',
   'CREATE TABLE origen_login_activity(id uuid,account_id uuid,created_at timestamptz)',
   'CREATE TABLE origen_onboarding_attempts(id uuid,account_id uuid,started_at timestamptz,saved_at timestamptz,resumed boolean)',
   'CREATE TABLE origen_onboarding_events(account_id uuid,attempt_id uuid,producer text,sequence integer,name text,occurred_at timestamptz,received_at timestamptz,metadata jsonb)',
   'CREATE TABLE origen_voice_activity(id uuid,account_id uuid,topic text,started_at timestamptz,last_seen_at timestamptz,ended_at timestamptz,seconds double precision)',
   'CREATE TABLE origen_voice_quality_events(account_id uuid,attempt_id uuid,sequence integer,event text,received_at timestamptz,code text)',
   'CREATE TABLE origen_conversation_summaries(id text,account_id uuid,mode text,created_at timestamptz,summary text)',
   'CREATE TABLE origen_ai_executions(id uuid,account_id uuid,operation text,status text,finished_at timestamptz,error_code text)',
   'CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)'
  ])await db.query(sql);
  await db.query("INSERT INTO origen_schema_migrations VALUES('027_onboarding_events.sql','2026-10-01')");
  await db.query('INSERT INTO origen_accounts VALUES($1,$3,$4,$5),($2,$3,$4,$5)',[id,other,'2026-10-01','2026-10-02','2026-10-04']);
  await db.query('INSERT INTO origen_onboarding_attempts VALUES($1,$2,$4,$5,false),($1,$3,$4,$5,false)',[visit,id,other,'2026-10-02','2026-10-04']);
  const event=async(owner,seq,name,received='2026-10-05',producer='client')=>db.query('INSERT INTO origen_onboarding_events VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[owner,visit,producer,seq,name,'2026-10-01',received,{transcript:'PRIVATE',email:'PRIVATE'}]);
  await event(id,1,'save_failed');await event(id,2,'home_reached');await event(id,3,'tracking_delivery_gap');await event(id,4,'user_speech_started');await event(id,1,'profile_saved','2026-10-04','server');
  await event(other,1,'microphone_denied');await event(other,2,'home_reached');
  await db.query('INSERT INTO origen_voice_activity VALUES($1,$2,$3,$4,$5,NULL,90)',[crypto.randomUUID(),id,'planning','2026-10-06','2026-10-06']);
  await db.query('INSERT INTO origen_voice_quality_events VALUES($1,$2,1,$3,$4,$5)',[id,crypto.randomUUID(),'connection_failure','2026-10-06','PRIVATE']);
  await db.query('INSERT INTO origen_conversation_summaries VALUES($1,$2,$3,$4,$5),($1,$6,$3,$4,$5)', ['PRIVATE-id',id,'planning','2026-10-07','PRIVATE summary',other]);
  await db.query('INSERT INTO origen_ai_executions VALUES($1,$2,$3,$4,$5,$6),($7,$8,$3,$4,$5,$6)',[crypto.randomUUID(),id,'summary','failed','2026-10-06','PRIVATE',crypto.randomUUID(),other]);
  const first=await adminUserHistory(db,{id,days:30},now);
  assert.equal(first.counts.visits,1);assert.equal(first.counts.summaries,1);assert.equal(first.counts.summary_failures,1);assert.equal(first.counts.problems,3);assert.equal(first.counts.calls,1);assert.equal(first.counts.home_arrivals,1);assert.equal(first.counts.gaps,1);
  assert.equal(first.events.filter(e=>e.kind==='profile_saved').length,1);assert.equal(first.events.filter(e=>e.kind==='onboarding_visit').length,1);assert.ok(!first.events.some(e=>['user_speech_started','microphone_denied'].includes(e.kind)));
  assert.doesNotMatch(JSON.stringify(first),/PRIVATE|transcript|error_code|metadata|auth0/);
  assert.equal(first.recap.title,'Profile save confirmed');assert.equal(first.coverage.guidanceEnabled,false);
  assert.equal(first.events.find(e=>e.kind==='home_reached').recordedAt.toISOString(),'2026-10-05T00:00:00.000Z');assert.equal(first.events.find(e=>e.kind==='home_reached').occurredAt.toISOString(),'2026-10-01T00:00:00.000Z');
  const problems=await adminUserHistory(db,{id,category:'problems'},now);assert.equal(problems.events.length,3);assert.ok(problems.events.every(e=>e.problem));assert.deepEqual(problems.recap,first.recap);
  const summaries=await adminUserHistory(db,{id,category:'summaries'},now);assert.equal(summaries.events.length,2);assert.ok(summaries.events.some(e=>e.kind==='summary_stored'));
  const seven=await adminUserHistory(db,{id,days:7},now);assert.ok(!seven.events.some(e=>e.kind==='registered'));assert.equal(seven.recap.title,'Profile save confirmed');
  // 32 identical timestamps force stable paging; newer receipts cannot shift it.
  for(let i=0;i<32;i++)await db.query('INSERT INTO origen_login_activity VALUES($1,$2,$3)',[crypto.randomUUID(),id,'2026-10-09T21:00:00Z']);
  const page1=await adminUserHistory(db,{id},now);
  await db.query('INSERT INTO origen_login_activity VALUES($1,$2,$3)',[crypto.randomUUID(),id,'2026-10-09T22:10:00Z']);
  const page2=await adminUserHistory(db,{id,page:2,asOf:page1.window.end},new Date('2026-10-09T22:20:00Z'));
  assert.equal(page1.total,page2.total);assert.equal(new Set([...page1.events,...page2.events].map(e=>e.id)).size,page1.total);
  assert.equal((await adminUserHistory(db,{id},new Date('2026-10-09T22:20:00Z'))).total,page1.total+1);
  // Even if the browser event claims a much older time, the cutoff uses receipt.
  await event(id,99,'home_reached','2026-10-10');assert.equal((await adminUserHistory(db,{id},now)).counts.home_arrivals,1);
  await db.query('DELETE FROM origen_onboarding_attempts WHERE account_id=$1',[id]);
  const fallback=await adminUserHistory(db,{id,category:'onboarding'},now);assert.equal(fallback.events.filter(e=>e.kind==='profile_saved').length,1);assert.ok(fallback.events.some(e=>e.kind==='onboarding_started'));
  await db.query('DELETE FROM origen_accounts WHERE id=$1',[id]);await assert.rejects(adminUserHistory(db,{id},now),{status:404});
 }finally{await db.query('SET search_path TO public');await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await close();}
});

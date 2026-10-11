import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {adminUserConversations,conversationFilters} from './admin-user-conversations.mjs';
import {createAuditedAdminHandler as createAdminHandler,staffTestIdentity} from './staff-test-fixture.mjs';
const now=new Date('2026-10-09T22:00:00Z');

test('conversation readers validate ownership references, filters and cutoffs before querying',async()=>{
 const id=crypto.randomUUID(),db={query:()=>assert.fail('invalid query executed')};
 for(const input of [{id:'invalid'},{id,sessionId:'bad'},{id,days:12},{id,page:0},{id,topic:'injected'},{id,language:'fr'},{id,status:'failed'},{id,eventPage:0},{id,eventPage:10001},{id,asOf:42},{id,asOf:'2026-10-10'},{id,asOf:'2026-10-01'}])await assert.rejects(adminUserConversations(db,input,now),{status:400});
 assert.equal(conversationFilters({id},now).window.end,now.toISOString());
 await assert.rejects(adminUserConversations({query:async()=>({rows:[]})},{id},now),{status:404});
 let calls=0;const unavailable=await adminUserConversations({query:async()=>({rows:++calls===1?[{id}]:[]})},{id},now);
 assert.equal(unavailable.coverage.available,false);assert.equal(calls,2);assert.equal(unavailable.counts,undefined);
});

test('conversation reporting denies ordinary accounts and suppresses database details',async()=>{
 for(const authorized of [false,true]){
  const req=Object.assign(Readable.from([JSON.stringify({action:'user-conversations',id:crypto.randomUUID()})]),{url:'/api/admin',method:'POST',origenAuthorized:authorized,origenIdentity:{sub:'auth0|ordinary'}});let status;
  await createAdminHandler({query:()=>assert.fail('unauthorized read')},{})(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,authorized?403:401);
 }
 const req=Object.assign(Readable.from([JSON.stringify({action:'user-conversations',id:crypto.randomUUID()})]),{url:'/api/admin',method:'POST',origenAuthorized:true,origenIdentity:staffTestIdentity('auth0|admin')});let status,payload;
 await createAdminHandler({query:()=>{throw new Error('password private connection');}},{})(req,{writeHead:s=>status=s,end:v=>payload=JSON.parse(v)},()=>{});
 assert.equal(status,503);assert.deepEqual(payload,{error:'conversations_unavailable'});
});

const enabled=!!(process.env.DATABASE_TEST_URL||process.env.ADMIN_TEST_PGLITE_MODULE);
test('PostgreSQL conversation records bind accounts, preserve evidence and paginate without fabricated joins',{skip:!enabled},async()=>{
 let db,close;if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);db=new PGlite();close=()=>db.close();}else{const {Client}=await import('pg');db=new Client({connectionString:process.env.DATABASE_TEST_URL});await db.connect();close=()=>db.end();}
 const schema=`admin_conversations_${crypto.randomUUID().replaceAll('-','')}`,id=crypto.randomUUID(),other=crypto.randomUUID(),sessionId=crypto.randomUUID(),segment=crypto.randomUUID(),second=crypto.randomUUID(),third=crypto.randomUUID();
 try{
  await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);await db.query("SET TIME ZONE 'UTC'");
  for(const sql of [
   'CREATE TABLE origen_accounts(id uuid)',
   'CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)',
   'CREATE TABLE origen_guidance_sessions(account_id uuid,id uuid,initial_language text,started_at timestamptz,ended_at timestamptz,end_reason text)',
   'CREATE TABLE origen_guidance_segments(account_id uuid,session_id uuid,id uuid,ordinal integer,topic text,started_at timestamptz)',
   'CREATE TABLE origen_guidance_events(account_id uuid,session_id uuid,segment_id uuid,id uuid,producer text,name text,received_at timestamptz,payload jsonb)',
   'CREATE TABLE origen_ai_executions(account_id uuid,session_id uuid,segment_id uuid,id uuid,operation text,status text,started_at timestamptz,finished_at timestamptz,duration_ms integer)',
   'CREATE TABLE origen_voice_quality_events(account_id uuid,session_id uuid,attempt_id uuid,sequence integer,event text,received_at timestamptz,language text,mode text,connection_state text)',
   'CREATE TABLE origen_conversation_summaries(account_id uuid,id text,created_at timestamptz,summary text)',
   'CREATE TABLE origen_summary_segments(account_id uuid,summary_id text,segment_id uuid,language text)',
   'CREATE TABLE origen_tool_calls(account_id uuid,execution_id uuid,source_count integer,sources jsonb)'
  ])await db.query(sql);
  await db.query('INSERT INTO origen_accounts VALUES($1),($2)',[id,other]);await db.query("INSERT INTO origen_schema_migrations VALUES('015_guidance_history.sql','2026-10-01'),('019_voice_quality.sql','2026-10-01')");
  const session=async(account,key,start='2026-10-08T12:00Z',end=null,reason=null)=>db.query("INSERT INTO origen_guidance_sessions VALUES($1,$2,'en',$3,$4,$5)",[account,key,start,end,reason]);
  const seg=async(account,session,key,ordinal,topic,start='2026-10-08T12:00Z')=>db.query('INSERT INTO origen_guidance_segments VALUES($1,$2,$3,$4,$5,$6)',[account,session,key,ordinal,topic,start]);
  const event=async(account,session,segment,name,payload={},received='2026-10-08T12:02Z',producer='browser')=>db.query('INSERT INTO origen_guidance_events VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[account,session,segment,crypto.randomUUID(),producer,name,received,JSON.stringify(payload)]);
  const execute=async(account,session,seg,operation,status,finish='2026-10-08T12:03Z',start='2026-10-08T12:01Z')=>{const key=crypto.randomUUID();await db.query('INSERT INTO origen_ai_executions VALUES($1,$2,$3,$4,$5,$6,$7,$8,2000)',[account,session,seg,key,operation,status,start,finish]);return key;};
  const summary=async(account,summaryId,seg,lang='es')=>{await db.query("INSERT INTO origen_conversation_summaries VALUES($1,$2,'2026-10-08T12:04Z','PRIVATE SUMMARY MUST NEVER BE READ')",[account,summaryId]);await db.query('INSERT INTO origen_summary_segments VALUES($1,$2,$3,$4)',[account,summaryId,seg,lang]);};
  const quality=async(account,session,kind,sequence,time='2026-10-08T12:03Z',lang='es')=>db.query("INSERT INTO origen_voice_quality_events VALUES($1,$2,$3,$4,$5,$6,$7,'finance',NULL)",[account,session,session,sequence,kind,time,lang]);
  await session(id,sessionId,undefined,'2026-10-08T12:08Z','completed');await seg(id,sessionId,segment,0,'planning');await seg(id,sessionId,second,1,'finance');await seg(id,sessionId,third,2,'loans');
  await event(id,sessionId,segment,'voice.connected');await event(id,sessionId,second,'guidance.configuration_applied');await event(id,sessionId,second,'guidance.language_changed',{language:'es'});await event(id,sessionId,second,'response.finished',{status:'cancelled'});
  await execute(id,sessionId,segment,'voice','completed');await execute(id,sessionId,second,'summary','failed');await execute(id,sessionId,second,'summary','completed');
  const lookup=await execute(id,sessionId,second,'lookup_financial_aid','completed');await db.query("INSERT INTO origen_tool_calls VALUES($1,$2,2,'[{\"url\":\"https://secret.example/private\"}]')",[id,lookup]);
  await summary(id,'one-display-summary',segment);await db.query("INSERT INTO origen_summary_segments VALUES($1,'one-display-summary',$2,'es')",[id,second]);await event(id,sessionId,second,'summary.saved',{summaryId:'one-display-summary'},'2026-10-08T12:05Z','server');
  await quality(id,sessionId,'session_start',1);await quality(id,sessionId,'guide_update_failed',2);await quality(id,sessionId,'response_cancelled',3);
  // Same IDs and summary IDs in another account must never join.
  await session(other,sessionId);await seg(other,sessionId,segment,0,'admissions');await summary(other,'one-display-summary',segment,'en');await event(other,sessionId,segment,'summary.saved',{summaryId:'one-display-summary'},undefined,'server');await quality(other,sessionId,'lookup_failure',1);await execute(other,sessionId,segment,'summary','failed');
  const otherOnly=crypto.randomUUID();await session(other,otherOnly);
  const report=await adminUserConversations(db,{id},now,{});const row=report.sessions[0];
  assert.equal(report.total,1);assert.equal(row.summaries,1);assert.equal(row.generation_failures,1);assert.equal(row.signals,2);assert.equal(row.lookups,1);assert.equal(row.browser_attempts,1);assert.equal(row.connected,true);assert.deepEqual(row.languages,['en','es']);assert.deepEqual(row.guides.map(g=>g.applied),[true,true,false]);assert.equal(report.coverage.enabled,false);
  const detail=await adminUserConversations(db,{id,sessionId},now);assert.equal(detail.summaries.length,1);assert.deepEqual(detail.summaries[0].segments,[0,1]);assert.deepEqual(detail.summaries[0].languages,['es']);assert.equal(detail.operations.length,4);assert.equal(detail.operations.find(o=>o.operation==='Financial aid source lookup').source_count,2);assert.equal(detail.events.filter(e=>e.problem).length,1);assert.equal(detail.events.find(e=>e.title==='Reply interrupted').problem,false);
  assert.doesNotMatch(JSON.stringify(detail),/PRIVATE|secret\.example|one-display-summary|student_id|account_id|auth0|sources|payload/);
  await assert.rejects(adminUserConversations(db,{id,sessionId:otherOnly},now),{status:404});await assert.rejects(adminUserConversations(db,{id,sessionId,topic:'admissions'},now),{status:404});
  assert.equal((await adminUserConversations(db,{id,topic:'finance',language:'es',status:'saved'},now)).total,1);
  assert.equal((await adminUserConversations(db,{id,topic:'admissions'},now)).total,0);
  // A generated summary with no saved attribution remains unconfirmed. A future
  // save receipt cannot retroactively confirm storage at an older cutoff.
  const generated=crypto.randomUUID(),generatedSeg=crypto.randomUUID();await session(id,generated,'2026-10-09T10:00Z');await seg(id,generated,generatedSeg,0,'profile','2026-10-09T10:00Z');await execute(id,generated,generatedSeg,'summary','completed','2026-10-09T10:02Z','2026-10-09T10:01Z');await summary(id,'deferred',generatedSeg);await event(id,generated,generatedSeg,'summary.saved',{summaryId:'deferred'},'2026-10-09T23:00Z','server');
  let unconfirmed=await adminUserConversations(db,{id,status:'unconfirmed'},now);assert.equal(unconfirmed.total,1);assert.equal(unconfirmed.sessions[0].generated,1);assert.equal(unconfirmed.sessions[0].summaries,0);
  await event(id,generated,generatedSeg,'guidance.configuration_applied',{},'2026-10-09T23:00Z');await event(id,generated,generatedSeg,'guidance.language_changed',{language:'es'},'2026-10-09T23:00Z');await execute(id,generated,generatedSeg,'voice','failed','2026-10-09T23:00Z','2026-10-09T10:00Z');
  let recent=await adminUserConversations(db,{id,sessionId:generated},now);assert.equal(recent.session.guides[0].applied,false);assert.deepEqual(recent.session.languages,['en']);assert.equal(recent.operations.find(x=>x.operation==='Voice connection negotiation').status,'started');assert.equal(recent.operations.find(x=>x.operation==='Voice connection negotiation').duration_ms,null);assert.equal(recent.session.signals,0);
  // Language capture in the technical stream still matches the explicit session.
  await quality(id,generated,'spoken_language_changed',1,'2026-10-09T10:03Z');assert.equal((await adminUserConversations(db,{id,sessionId:generated,language:'es'},now)).session.languages.length,2);
  // Reader ordering and cutoff remain stable while paging; receipt ties use IDs.
  for(let i=0;i<36;i++)await quality(id,sessionId,'guide_update_complete',10+i);
  const first=await adminUserConversations(db,{id,sessionId},now),next=await adminUserConversations(db,{id,sessionId,eventPage:2,asOf:first.window.end},new Date(+now+1000));assert.equal(first.events.length,30);assert.equal(next.events.length,first.eventTotal-30);assert.equal(new Set([...first.events,...next.events].map(e=>e.id)).size,first.eventTotal);
  for(let i=0;i<7;i++)await session(id,crypto.randomUUID(),'2026-10-07T12:00Z',i===0?'2026-10-08T12:00Z':null,i===0?'abandoned':null);
  const page1=await adminUserConversations(db,{id},now),page2=await adminUserConversations(db,{id,page:2,asOf:page1.window.end},new Date(+now+1000));assert.equal(page1.sessions.length,5);assert.equal(page2.sessions.length,4);assert.equal(new Set([...page1.sessions,...page2.sessions].map(s=>s.id)).size,9);
  assert.equal((await adminUserConversations(db,{id,status:'signals'},now)).total,1);
  // Even if retained orphan links/events exist, absent current storage is unknown.
  await db.query("DELETE FROM origen_conversation_summaries WHERE account_id=$1 AND id='one-display-summary'",[id]);assert.equal((await adminUserConversations(db,{id,sessionId},now)).session.summaries,0);
  await db.query("UPDATE origen_schema_migrations SET applied_at='2026-01-01' WHERE name='015_guidance_history.sql'");await session(id,crypto.randomUUID(),'2026-07-01');assert.equal((await adminUserConversations(db,{id,days:90},now)).total,9);
 }finally{await db.query('SET search_path TO public');await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await close();}
});

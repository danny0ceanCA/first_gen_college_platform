import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {adminWindow} from './admin-overview.mjs';
import {adminOnboardingMetrics,onboardingCohortReport,onboardingCohortSQL} from './admin-onboarding-metrics.mjs';
import {createAdminHandler} from './admin.mjs';

const now=new Date('2026-10-09T20:00:00Z'),window=adminWindow(7,now);
const visit=(overrides={})=>({account_id:'one',id:crypto.randomUUID(),started_at:'2026-10-07T20:00:00Z',saved_at:null,resumed:false,language:'en',method:'voice',phase3:true,voice_starts:1,connections:1,first_audio_ms:1000,...overrides});
test('cohorts deduplicate users while preserving retry visits, maturity and return outcomes',()=>{
 const rows=[
  visit({save_failed:2,first_save_failure:'2026-10-07T20:01:00Z',saved_at:'2026-10-07T20:02:00Z',home:1}),
  visit({started_at:'2026-10-08T20:00:00Z',resumed:true,saved_at:'2026-10-08T20:04:00Z',language:'es',method:'manual',voice_starts:0,setup_changes:3}),
  visit({account_id:'two',started_at:'2026-10-09T19:00:00Z',saved_at:'2026-10-09T19:02:00Z',microphone_denied:3,playback_blocked:1,first_audio_ms:null,connections:0}),
  visit({account_id:'three',saved_at:'2026-10-09T19:00:00Z',voice_starts:0,language:'bad',method:'bad',native_ack:1}),
  visit({account_id:'out',started_at:window.start.replace('20:','19:')}),visit({account_id:'future',started_at:window.end})
 ];
 const r=onboardingCohortReport(rows,window);
 assert.equal(r.totals.attempts,4);assert.equal(r.totals.users,3);assert.equal(r.totals.savedUsers,3);
 assert.equal(r.totals.returningUsers,1);assert.equal(r.totals.returningSavedUsers,1);
 assert.equal(r.totals.mature,3);assert.equal(r.totals.savedWithin24h,2);
 assert.equal(r.totals.saveRecoveryVisits,1);assert.equal(r.totals.issues,2);
 assert.equal(r.issues.save_failed,1);assert.equal(r.issues.microphone_denied,1);assert.equal(r.issues.playback_blocked,1);
 assert.equal(r.totals.voiceVisits,2);assert.equal(r.totals.connectedVisits,1);assert.equal(r.totals.firstAudioVisits,1);
 assert.equal(r.timings.audioSamples,1);assert.equal(r.timings.medianFirstAudioMs,1000);
 assert.equal(r.totals.nativeAcknowledged,1);assert.equal(r.totals.home,1);assert.equal(r.totals.setupChangeVisits,1);
 assert.ok(r.segments.some(s=>s.language==='unknown'&&s.method==='unknown'));
 assert.equal(r.series.reduce((n,row)=>n+row.attempts,0),4);
 assert.doesNotMatch(JSON.stringify(r),/account_id|"one"|"two"|"id"/);
});
test('server cutoff, null latency and capture coverage never masquerade as successful zero-time outcomes',()=>{
 const r=onboardingCohortReport([
  visit({saved_at:window.end,first_audio_ms:null}),
  visit({account_id:'two',saved_at:'2026-10-07T19:59:00Z',first_audio_ms:2000,phase3:false}),
  visit({account_id:'three',first_audio_ms:0}),
  visit({account_id:'four',first_audio_ms:'private'}),
  visit({account_id:'five',saved_at:'2026-10-07T20:01:00Z',first_save_failure:'2026-10-07T20:02:00Z'})
 ],window);
 assert.equal(r.totals.saved,1);assert.equal(r.totals.saveRecoveryVisits,0);assert.equal(r.totals.firstAudioVisits,2);
 assert.equal(r.timings.medianFirstAudioMs,500);assert.equal(r.timings.medianSaveMs,60000);
 const empty=onboardingCohortReport([],window);assert.equal(empty.timings.medianFirstAudioMs,null);assert.equal(empty.timings.medianSaveMs,null);assert.equal(empty.totals.mature,0);
 const partial=onboardingCohortReport([],window,'2026-10-07T12:00:00Z');assert.equal(partial.series.find(s=>s.date==='2026-10-06').tracked,false);assert.equal(partial.series.find(s=>s.date==='2026-10-07').tracked,true);
});
test('metric reads validate periods, report unavailable capture and safely retain query failures',async()=>{
 await assert.rejects(adminOnboardingMetrics({query:()=>assert.fail('queried')},{days:365}),{status:400});
 const calls=[];
 const unavailable=await adminOnboardingMetrics({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}},{days:7},now);
 assert.equal(unavailable.coverage.available,false);assert.equal(calls.length,1);
 await assert.rejects(adminOnboardingMetrics({query:async()=>{throw new Error('offline');}},{},now),/offline/);
 const report=await adminOnboardingMetrics({query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('schema_migrations')?[{applied_at:'2026-10-01'}]:[visit({saved_at:'2026-10-07T20:01:00Z'})]};}},{days:7},now);
 assert.equal(report.totals.saved,1);assert.deepEqual(calls.at(-1).args,[window.start,window.end]);assert.equal(report.coverage.retentionDays,90);
 // Receipt cutoff applies to signals, openings and first audio; each join scopes both keys.
 assert.equal((onboardingCohortSQL.match(/e.received_at < \$2/g)||[]).length,3);
 assert.equal((onboardingCohortSQL.match(/v.account_id=e.account_id AND v.id=e.attempt_id/g)||[]).length,3);
 assert.match(onboardingCohortSQL,/started_at >= \$1 AND started_at < \$2/);
 assert.match(onboardingCohortSQL,/DISTINCT ON\(e.account_id,e.attempt_id\)/);
 assert.doesNotMatch(onboardingCohortSQL,/auth0_subject|first_name|email|transcript\b|summary|e\.metadata[,\s]/);
});
test('metrics endpoint enforces admin access, bounds periods and hides database error text',async()=>{
 const invoke=async(identity,authorized,db,body)=>{let status,payload;const req=Object.assign(Readable.from([JSON.stringify({action:'onboarding-metrics',...body})]),{url:'/api/admin',origenAuthorized:authorized,origenIdentity:identity});await createAdminHandler(db,{})(req,{writeHead:s=>status=s,end:value=>payload=JSON.parse(value)},()=>{});return {status,payload};};
 for(const [authorized,status] of [[false,401],[true,403]])assert.equal((await invoke({sub:'auth0|user'},authorized,{query:()=>assert.fail('protected data read')},{})).status,status);
 const admin={sub:'auth0|admin',permissions:['read:activity']};
 assert.equal((await invoke(admin,true,{query:()=>assert.fail('invalid filter queried')},{days:'7'})).status,400);
 const broken=await invoke(admin,true,{query:async()=>{throw new Error('private SQL details');}},{});assert.equal(broken.status,503);assert.deepEqual(broken.payload,{error:'onboarding_metrics_unavailable'});
 assert.equal((await invoke(admin,true,{query:async()=>({rows:[]})},{days:30})).status,200);
});

test('stored visit rollups keep account boundaries, earliest audio and initial language',async()=>{
 const memory=newDb();memory.public.registerFunction({name:'now',returns:DataType.timestamptz,impure:true,implementation:()=>now});
 memory.public.registerOperator({operator:'~',left:DataType.text,right:DataType.text,returns:DataType.bool,implementation:(value,pattern)=>new RegExp(pattern).test(value)});
 memory.public.none('CREATE TABLE origen_accounts(id uuid PRIMARY KEY)');memory.public.none(await readFile(new URL('./migrations/027_onboarding_events.sql',import.meta.url),'utf8'));
 memory.public.none(await readFile(new URL('./migrations/028_onboarding_cohorts.sql',import.meta.url),'utf8'));
 const {Pool}=memory.adapters.createPg(),pool=new Pool(),owner=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID();
 try{
  await pool.query('INSERT INTO origen_accounts VALUES($1),($2)',[owner,other]);
  await pool.query('INSERT INTO origen_onboarding_attempts(account_id,id,started_at,saved_at) VALUES($1,$2,$3,$4),($5,$2,$3,NULL)',[owner,id,'2026-10-07T20:00:00Z','2026-10-07T20:03:00Z',other]);
  const add=(account,sequence,name,metadata,received='2026-10-07T20:01:00Z')=>pool.query("INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at,received_at,metadata) VALUES($1,$2,'client',$3,$4,$5,$5,$6)",[account,id,sequence,name,received,metadata]);
  await add(owner,1,'onboarding_opened',{method:'voice',language:'es',captureVersion:3});await add(owner,2,'first_agent_audio',{durationMs:4000});await add(owner,3,'first_agent_audio',{durationMs:100});await add(owner,4,'save_failed',{});await add(owner,5,'home_reached',{},window.end);await add(other,1,'onboarding_opened',{method:'manual',language:'en'});
  const rows=(await pool.query(onboardingCohortSQL,[window.start,window.end])).rows;
  assert.equal(rows.length,2);const a=rows.find(r=>r.account_id===owner),b=rows.find(r=>r.account_id===other);
  assert.equal(a.first_audio_ms,4000);assert.equal(a.language,'es');assert.equal(Number(a.save_failed),1);assert.equal(Number(a.home),0);assert.equal(b.saved_at,null);assert.equal(b.method,'manual');
 }finally{await pool.end();}
});

// Execute the full PostgreSQL query when a dedicated local test database exists.
// Never use DATABASE_URL: it can refer to the production account store.
test('PostgreSQL cohort query selects first audio, initial choices and receipt-scoped saves',{skip:!process.env.ORIGEN_TEST_DATABASE_URL},async()=>{
 const {Client}=await import('pg');const client=new Client({connectionString:process.env.ORIGEN_TEST_DATABASE_URL});await client.connect();
 try{await client.query('BEGIN');await client.query('CREATE TEMP TABLE origen_accounts(id uuid PRIMARY KEY)');
  await client.query((await readFile(new URL('./migrations/027_onboarding_events.sql',import.meta.url),'utf8')).replaceAll('CREATE TABLE','CREATE TEMP TABLE'));
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID();
  await client.query('INSERT INTO origen_accounts VALUES($1),($2)',[owner,other]);
  await client.query('INSERT INTO origen_onboarding_attempts(account_id,id,started_at,saved_at) VALUES($1,$2,$3,$4),($5,$2,$3,NULL)',[owner,id,'2026-10-07T20:00:00Z','2026-10-07T20:03:00Z',other]);
  const add=(account,sequence,name,metadata,received='2026-10-07T20:01:00Z')=>client.query("INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at,received_at,metadata) VALUES($1,$2,'client',$3,$4,$5,$5,$6)",[account,id,sequence,name,received,metadata]);
  await add(owner,1,'onboarding_opened',{method:'voice',language:'es',captureVersion:3});await add(owner,2,'first_agent_audio',{durationMs:4000});await add(owner,3,'first_agent_audio',{durationMs:100});await add(owner,4,'save_failed',{});await add(owner,5,'home_reached',{},window.end);await add(other,1,'onboarding_opened',{method:'manual',language:'en'});
  const rows=(await client.query(onboardingCohortSQL,[window.start,window.end])).rows;
  assert.equal(rows.length,2);const a=rows.find(r=>r.account_id===owner),b=rows.find(r=>r.account_id===other);
  assert.equal(a.first_audio_ms,4000);assert.equal(a.language,'es');assert.equal(Number(a.save_failed),1);assert.equal(Number(a.home),0);assert.equal(b.saved_at,null);assert.equal(b.method,'manual');
 }finally{await client.query('ROLLBACK');await client.end();}
});

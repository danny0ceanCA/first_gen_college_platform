import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {adminEngagement,engagementFilters,engagementRate} from './admin-engagement.mjs';
import {createAuditedAdminHandler as createAdminHandler,staffTestIdentity} from './staff-test-fixture.mjs';

test('engagement validates filters and distinguishes no denominator from zero observed success',async()=>{
 const db={query:()=>assert.fail('invalid filter reached database')};
 for(const input of [{days:1},{days:'30'},{role:'admin'},{role:'student OR 1=1'}])await assert.rejects(adminEngagement(db,input),{status:400});
 assert.deepEqual(engagementFilters(),{days:30,role:'all'});
 assert.deepEqual(engagementRate(0,0),{numerator:0,denominator:0,percent:null});assert.equal(engagementRate(0,3).percent,0);assert.equal(engagementRate(1,3).percent,33.3);
});

test('missing tracking does not report zero engagement; reads and failures are admin protected',async()=>{
 let calls=0;const missing=await adminEngagement({query:async()=>{calls++;return {rows:[]};}});
 assert.equal(calls,1);assert.equal(missing.coverage.available,false);assert.equal(missing.metrics,undefined);
 for(const authorized of [false,true]){
  const req=Object.assign(Readable.from([JSON.stringify({action:'engagement'})]),{url:'/api/admin',method:'POST',origenAuthorized:authorized,origenIdentity:{sub:'auth0|ordinary'}});let status;
  await createAdminHandler({query:()=>assert.fail('unauthorized read')},{})(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,authorized?403:401);
 }
 let status,payload;const req=Object.assign(Readable.from([JSON.stringify({action:'engagement'})]),{url:'/api/admin',method:'POST',origenAuthorized:true,origenIdentity:staffTestIdentity('auth0|admin')});
 await createAdminHandler({query:()=>{throw new Error('database credential');}},{})(req,{writeHead:s=>status=s,end:v=>payload=JSON.parse(v)},()=>{});
 assert.equal(status,503);assert.deepEqual(payload,{error:'engagement_unavailable'});
});

test('admin cohort exclusions only use backend configuration and verified request identity',async()=>{
 const params=[],counts={cohort_date:null,registered:0,saved:0,home_eligible:0,home:0,activated:0,mature_registrations:0,saved_within_7d:0,activated_within_7d:0,mature_activations:0,returned_within_7d:0};
 const db={query:async(sql,p)=>{if(p)params.push(p);return {rows:sql.includes('FROM origen_schema_migrations')?[{name:'017_admin_activity.sql',applied_at:'2026-01-01'},{name:'018_onboarding_milestones.sql',applied_at:'2026-01-01'}]:[counts]};}};
 const req=Object.assign(Readable.from([JSON.stringify({action:'engagement',adminSubjects:['auth0|forged']})]),{url:'/api/admin',method:'POST',origenAuthorized:true,origenIdentity:staffTestIdentity('auth0|operator')});
 await createAdminHandler(db,{ADMIN_SUBJECTS:'auth0|configured'})(req,{writeHead:s=>assert.equal(s,200),end:()=>{}},()=>{});
 for(const p of params)assert.deepEqual(p.at(-1),['auth0|configured','auth0|operator']);
});

const enabled=!!(process.env.DATABASE_TEST_URL||process.env.ADMIN_TEST_PGLITE_MODULE);
test('PostgreSQL cohorts mature fairly, deduplicate accounts and capture guidance without sign-ins',{skip:!enabled},async()=>{
 let db,close;
 if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);db=new PGlite();close=()=>db.close();}
 else{const {Client}=await import('pg');db=new Client({connectionString:process.env.DATABASE_TEST_URL});await db.connect();close=()=>db.end();}
 const schema=`engagement_${crypto.randomUUID().replaceAll('-','')}`;
 try{
  await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);await db.query("SET TIME ZONE 'UTC'");
  for(const sql of [
   'CREATE TABLE origen_accounts(id uuid,auth0_subject text,role text,created_at timestamptz,onboarding_completed_at timestamptz)',
   'CREATE TABLE origen_voice_activity(id uuid,account_id uuid,topic text,started_at timestamptz,last_seen_at timestamptz,seconds double precision)',
   'CREATE TABLE origen_login_activity(account_id uuid,created_at timestamptz)',
   'CREATE TABLE origen_onboarding_events(account_id uuid,producer text,name text,received_at timestamptz)',
   'CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)'
  ])await db.query(sql);
  await db.query("INSERT INTO origen_schema_migrations VALUES('017_admin_activity.sql','2026-09-01'),('018_onboarding_milestones.sql','2026-10-01'),('027_onboarding_events.sql','2026-10-02')");
  const ids={};
  async function account(key,created='2026-10-03T10:00Z',saved='2026-10-03T11:00Z',role='student'){
   ids[key]=crypto.randomUUID();await db.query('INSERT INTO origen_accounts VALUES($1,$2,$3,$4,$5)',[ids[key],`auth0|${key}`,role,created,saved]);
  }
  const call=async(key,start,topic='planning',seconds=60,last=start)=>db.query('INSERT INTO origen_voice_activity VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),ids[key],topic,start,last,seconds]);
  const home=async(key,time,name='home_reached')=>db.query("INSERT INTO origen_onboarding_events VALUES($1,'client',$2,$3)",[ids[key],name,time]);
  await account('returned',undefined,undefined,'parent');await call('returned','2026-10-04T08:00Z');await call('returned','2026-10-04T09:00Z');await call('returned','2026-10-05T09:00Z');await home('returned','2026-10-04');await home('returned','2026-10-05');
  await account('sameDay');await call('sameDay','2026-10-04T08:00Z');await call('sameDay','2026-10-04T09:00Z');await home('sameDay','2026-10-04','native_handoff_acknowledged');
  await account('midnight');await call('midnight','2026-10-04T23:59Z','finance',120,'2026-10-05T00:03Z');
  await account('recent','2026-10-18T08:00Z','2026-10-18T09:00Z');await call('recent','2026-10-18T12:00Z');await call('recent','2026-10-19T12:00Z');await home('recent','2026-10-19');
  await account('late',undefined,'2026-10-12','parent');await call('late','2026-10-13T11:00Z');await call('late','2026-10-20T11:00Z');await home('late','2026-10-04'); // Pre-save home report cannot qualify.
  await account('noUse',undefined,null,null);
  await account('zero',undefined,'2026-10-04');await call('zero','2026-10-05','profile',60);await call('zero','2026-10-05','planning',0);await call('zero','2026-10-03T12:00Z');
  await account('boundary','2026-10-13T12:00Z','2026-10-20T11:00Z');await call('boundary','2026-10-20T11:30Z');
  await account('admin');await call('admin','2026-10-04');
  await account('old','2026-09-25','2026-09-26','parent');await call('old','2026-10-05');
  await account('future','2026-10-21','2026-10-21');await call('future','2026-10-21');
  await db.query('INSERT INTO origen_login_activity VALUES($1,$3),($2,$3)',[ids.sameDay,ids.noUse,'2026-10-05']);
  const now=new Date('2026-10-20T12:00Z'),report=await adminEngagement(db,{},now,{},['auth0|admin']),t=report.cohort.totals;
  assert.deepEqual(report.scope,{registered:10,known_admins:1,before_tracking:1});assert.equal(t.registered,8);assert.equal(t.saved,7);assert.equal(t.home,2);assert.equal(t.home_eligible,8);assert.equal(t.activated,6);
  assert.equal(t.mature_registrations,7);assert.equal(t.saved_within_7d,5);assert.equal(t.activated_within_7d,4);assert.equal(t.mature_activations,4);assert.equal(t.returned_within_7d,2);assert.equal(report.metrics.returnWithin7d.percent,50);
  assert.deepEqual(report.usage,{active_accounts:7,calls:12,active_account_days:10,active_without_signin:6});
  assert.equal(report.cohort.days.reduce((sum,row)=>sum+row.registered,0),t.registered);assert.equal(report.cohort.days.reduce((sum,row)=>sum+row.returned_within_7d,0),t.returned_within_7d);
  assert.doesNotMatch(JSON.stringify(report),/auth0\||account_id|email|transcript|student_name/);
  const short=await adminEngagement(db,{days:7},now,{},['auth0|admin']);assert.equal(short.cohort.totals.registered,2);assert.equal(short.cohort.totals.mature_registrations,1);assert.equal(short.metrics.setupWithin7d.percent,100);assert.equal(short.metrics.returnWithin7d.percent,null);
  const recentHome=await adminEngagement(db,{},now,{ONBOARDING_RETENTION_DAYS:'7'},['auth0|admin']);assert.equal(recentHome.cohort.totals.home_eligible,2);assert.equal(recentHome.cohort.totals.home,1);
  const parents=await adminEngagement(db,{role:'parent'},now,{},['auth0|admin']);assert.equal(parents.cohort.totals.registered,2);assert.equal(parents.usage.active_accounts,3);
  const unknown=await adminEngagement(db,{role:'unknown',days:7},now);assert.equal(unknown.cohort.totals.registered,0);assert.equal(unknown.metrics.setupWithin7d.percent,null);
  // A return just outside the exact 168-hour window must not count.
  await db.query('UPDATE origen_voice_activity SET started_at=$1,last_seen_at=$1 WHERE account_id=$2 AND started_at=$3',['2026-10-20T11:00:01Z',ids.late,'2026-10-20T11:00Z']);
  assert.equal((await adminEngagement(db,{},now,{},['auth0|admin'])).cohort.totals.returned_within_7d,1);
  // Future receipts/updates do not borrow information beyond the report cutoff.
  await home('zero','2026-10-21');await call('zero','2026-10-19','loans',120,'2026-10-21');
  assert.equal((await adminEngagement(db,{},now,{},['auth0|admin'])).cohort.totals.activated,6);
  // Observation windows are elapsed hours even across DST in a non-UTC database.
  await db.query("SET TIME ZONE 'America/Los_Angeles'");await account('dst','2026-11-01T08:30Z','2026-11-08T09:00Z',null);
  const dst=await adminEngagement(db,{role:'unknown'},new Date('2026-11-08T10:00Z'));assert.equal(dst.cohort.totals.mature_registrations,1);assert.equal(dst.cohort.totals.saved_within_7d,0);
  await db.query("DELETE FROM origen_schema_migrations WHERE name='027_onboarding_events.sql'");
  assert.equal((await adminEngagement(db,{},now)).cohort.totals.home_eligible,0);
 }finally{await db.query('SET search_path TO public');await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await close();}
});

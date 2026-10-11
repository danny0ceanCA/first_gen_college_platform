import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {adminUsers,adminUserDetail} from './admin-users.mjs';

// Run against a dedicated test database or an explicitly supplied temporary
// PGlite runtime. Never fall back to the application's DATABASE_URL.
const enabled=!!(process.env.DATABASE_TEST_URL||process.env.ADMIN_TEST_PGLITE_MODULE);
test('PostgreSQL directory stages, activity, filters and access evidence agree with account details',{skip:!enabled},async()=>{
 let database,close;
 if(process.env.ADMIN_TEST_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ADMIN_TEST_PGLITE_MODULE).href);database=new PGlite();close=()=>database.close();}
 else{const {Client}=await import('pg');database=new Client({connectionString:process.env.DATABASE_TEST_URL});await database.connect();close=()=>database.end();}
 const schema=`admin_journey_${crypto.randomUUID().replaceAll('-','')}`;
 try{
  await database.query(`CREATE SCHEMA ${schema}`);await database.query(`SET search_path TO ${schema}`);await database.query("SET TIME ZONE 'UTC'");
  for(const sql of [
   'CREATE TABLE origen_accounts(id uuid PRIMARY KEY,auth0_subject text,first_name text NOT NULL,role text,created_at timestamptz,onboarding_started_at timestamptz,onboarding_completed_at timestamptz)',
   'CREATE TABLE origen_students(account_id uuid,id text,created_at timestamptz)',
   'CREATE TABLE origen_login_activity(id uuid,account_id uuid,created_at timestamptz)',
   'CREATE TABLE origen_voice_activity(id uuid,account_id uuid,topic text,started_at timestamptz,last_seen_at timestamptz,seconds double precision)',
   'CREATE TABLE origen_onboarding_attempts(account_id uuid,id uuid,started_at timestamptz,last_received_at timestamptz)',
   'CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)'
  ])await database.query(sql);
  await database.query("INSERT INTO origen_schema_migrations VALUES('018_onboarding_milestones.sql','2026-10-01')");
  const ids=Object.fromEntries(['registered','started','legacy','saved','guided','profileOnly','admin'].map(key=>[key,crypto.randomUUID()]));
  const account=async(key,name,role,created='2026-10-03',started=null,saved=null)=>database.query('INSERT INTO origen_accounts VALUES($1,$2,$3,$4,$5,$6,$7)',[ids[key],`auth0|${key}`,name,role,created,started,saved]);
  await account('registered','',null);await account('started','',null);await account('legacy','50%_\\ sample','parent','2026-09-01');
  // A confirmed save must count even without an opening event or current name.
  await account('saved','',null,'2026-10-03',null,'2026-10-04');
  await account('guided','Guided','parent','2026-09-01','2026-09-02','2026-09-03');
  await account('profileOnly','Profile only','student','2026-10-03','2026-10-03','2026-10-04');await account('admin','',null);
  const voice=async(key,topic,start,last,seconds)=>database.query('INSERT INTO origen_voice_activity VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),ids[key],topic,start,last,seconds]);
  await voice('guided','planning','2026-09-04','2026-09-04',120);
  await voice('guided','finance','2026-10-07','2026-10-08',60);
  await voice('profileOnly','profile','2026-10-05','2026-10-05',90);
  await voice('saved','planning','2026-10-05','2026-10-05',0); // Failed/zero-time connection is not guidance use.
  await voice('saved','planning','2026-10-03','2026-10-03',60); // Before saving is not post-setup use.
  await database.query('INSERT INTO origen_login_activity VALUES($1,$2,$3),($4,$2,$5)',[crypto.randomUUID(),ids.guided,'2026-09-04',crypto.randomUUID(),'2026-10-04']);
  await database.query('INSERT INTO origen_onboarding_attempts VALUES($1,$2,$3,$4),($1,$5,$6,$7)',[ids.started,crypto.randomUUID(),'2026-10-03','2026-10-08T16:00:00Z',crypto.randomUUID(),'2026-10-05','2026-10-08T17:00:00Z']);
  await database.query('INSERT INTO origen_students VALUES($1,$2,$3),($1,$4,$3)',[ids.guided,'one','2026-10-03','two']);
  const now=new Date('2026-10-09T20:00:00Z'),report=await adminUsers(database,{days:7},now,['auth0|admin']);
  const rows=Object.fromEntries(report.users.map(row=>[row.id,row]));
  assert.equal(report.total,7);assert.equal(rows[ids.registered].journey_stage,'registered');
  assert.equal(rows[ids.started].journey_stage,'onboarding_started');assert.equal(new Date(rows[ids.started].last_activity_at).toISOString(),'2026-10-08T17:00:00.000Z');assert.equal(rows[ids.started].last_activity_kind,'onboarding_receipt');
  assert.equal(rows[ids.legacy].journey_stage,'save_unconfirmed');assert.equal(rows[ids.legacy].profile_complete,false);
  assert.equal(rows[ids.saved].journey_stage,'profile_saved');assert.equal(rows[ids.profileOnly].journey_stage,'profile_saved');
  assert.equal(rows[ids.guided].journey_stage,'guidance_used');assert.equal(Number(rows[ids.guided].student_profiles),2);assert.equal(Number(rows[ids.guided].logins),1);assert.equal(Number(rows[ids.guided].calls),1);assert.equal(Number(rows[ids.guided].voice_minutes),1);
  assert.equal(new Date(rows[ids.guided].first_guidance_at).toISOString(),'2026-09-04T00:00:00.000Z');assert.equal(rows[ids.guided].last_activity_kind,'voice_activity');assert.ok(new Date(rows[ids.guided].last_activity_at)>new Date(rows[ids.guided].last_login));
  assert.equal(rows[ids.admin].admin_access,'confirmed');assert.equal(rows[ids.guided].admin_access,'not_verified');assert.equal(rows[ids.admin].role,null);
  assert.equal(Number(report.funnel.completed),2);assert.equal(Number(report.funnel.started),1);assert.equal(Number(report.funnel.first_conversation),0);
  assert.equal((await adminUsers(database,{search:'50%_\\'},now)).total,1);
  assert.equal((await adminUsers(database,{search:'50%_x'},now)).total,0);
  assert.equal((await adminUsers(database,{journey:'save_unconfirmed',role:'parent'},now)).users[0].id,ids.legacy);
  assert.equal((await adminUsers(database,{status:'complete'},now)).total,3);assert.equal((await adminUsers(database,{status:'unknown'},now)).total,1);
  const sorted=await adminUsers(database,{sort:'last_activity'},now);assert.equal(sorted.users[0].id,ids.started);
  const detail=await adminUserDetail(database,{id:ids.guided,days:7},now);assert.deepEqual(detail.user,rows[ids.guided]);
  const longer=await adminUserDetail(database,{id:ids.guided,days:30},now);assert.equal(longer.user.journey_stage,'guidance_used');assert.equal(longer.user.last_activity_at.toISOString(),detail.user.last_activity_at.toISOString());
  assert.doesNotMatch(JSON.stringify(report),/auth0\||auth0_subject|email|transcript/);
  const future=crypto.randomUUID();await database.query('INSERT INTO origen_login_activity VALUES($1,$2,$3)',[future,ids.guided,'2026-10-10']);
  assert.equal((await adminUserDetail(database,{id:ids.guided},now)).user.last_login.toISOString(),'2026-10-04T00:00:00.000Z');
  // Equal dates use the stable account-ID tie breaker across page boundaries.
  for(let i=0;i<22;i++)await database.query('INSERT INTO origen_accounts VALUES($1,$2,$3,NULL,$4,NULL,NULL)',[crypto.randomUUID(),`auth0|extra-${i}`,'','2026-10-03']);
  const page1=await adminUsers(database,{sort:'registered',page:1},now),page2=await adminUsers(database,{sort:'registered',page:2},now);
  assert.equal(page1.total,29);assert.equal(page1.users.length,25);assert.equal(page2.users.length,4);assert.equal(new Set([...page1.users,...page2.users].map(row=>row.id)).size,29);
 }finally{await database.query('SET search_path TO public');await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createJobRunner} from './observability/jobs.mjs';
import {maintenanceBatch} from './observability/maintenance-batches.mjs';
import {createMaintenanceDatabase,grantMaintenanceAccess,assertMaintenanceAccess} from './maintenance-database.mjs';
import {migrateDatabase} from './database.mjs';
import {purgePermissionData} from './guardian-permission.mjs';
import {purgeDiagnosticOperations} from './observability/operations.mjs';
import {purgeMetrics} from './institution-metrics.mjs';
import {purgePrivateSummaries} from './privacy-controls.mjs';
import {purgePrivacyEvents,privacyAlertReport} from './privacy-monitor.mjs';
import {purgeInstitutionInquiries} from './institution-inquiries.mjs';
import {purgeInstitutionOutreach} from './institution-outreach-data.mjs';
import {purgeGuidanceHistory} from './guidance-history.mjs';
import {purgeProgressHistory} from './progress-history.mjs';
import {purgeAdminReportSnapshots} from './admin-report-snapshots.mjs';
import {purgeConversationQuality} from './conversation-quality-store.mjs';
import {purgeOnboardingEvents} from './onboarding-events.mjs';
import {purgeAdminReviews} from './admin-review-queue.mjs';
import {purgeExpiredInvites} from './account-lifecycle.mjs';
import {sweepPermissionCalls} from './permission-execution.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';

test('maintenance pool requires a distinct identity and has one connection',()=>{
 assert.throws(()=>createMaintenanceDatabase({DATABASE_URL:'postgres://api@localhost/app'}));
 assert.throws(()=>createMaintenanceDatabase({DATABASE_URL:'postgres://api@localhost/app',MAINTENANCE_DATABASE_URL:'postgres://api@localhost/app'}));
 let config;class Pool{constructor(c){config=c;}on(){}}
 createMaintenanceDatabase({DATABASE_URL:'postgres://api@localhost/app',MAINTENANCE_DATABASE_URL:'postgres://maintenance@localhost/app'},Pool);assert.equal(config.max,1);
 assert.match(maintenanceBatch('DELETE FROM origen_privacy_events WHERE occurred_at<$1'),/LIMIT 250/);
 assert.equal(maintenanceBatch('SELECT PRIVATE'),'SELECT PRIVATE');
});
test('lease loss, per-task failure, serialization and shutdown cannot leave a job running under another scope',async()=>{
 const events=[];let release=0;const client=Object.assign(new EventEmitter(),{query:async sql=>({rows:sql.includes('pg_try_advisory_lock')?[{locked:true}]:[],rowCount:0}),release(){release++;}});
 const runner=createJobRunner({connect:async()=>client},{log:event=>events.push(event)});
 assert.equal((await runner.run('metrics',async db=>{client.emit('error',Error('PRIVATE'));await db.query('SELECT 1');})).outcome,'failed');
 assert.equal(release,1);assert.equal(events.filter(e=>e.event==='job.finished').length,1);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 await runner.stop();assert.equal((await runner.run('metrics',()=>assert.fail('stopped'))).outcome,'cancelled');
});
test('real PostgreSQL maintenance grants, batches, independent-process locks and cleanup jobs',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`jobs_${suffix}`,role=`job_user_${suffix}`;
 const owner=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});let pool,child;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);await migrateDatabase(owner);await grantMaintenanceAccess(owner,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=role;url.password='';pool=new pg.Pool({connectionString:url.href,max:1,options:`-c search_path=${schema}`});await assertMaintenanceAccess(pool,{schema});
  const rights=(await pool.query("SELECT has_table_privilege(current_user,'origen_conversation_summaries','INSERT') AS insert,has_table_privilege(current_user,'origen_privileged_access_audit','DELETE') AS audit")).rows[0];assert.equal(rights.insert,false);assert.equal(rights.audit,false);
  await owner.query(`GRANT INSERT ON origen_conversation_summaries TO ${role}`);await assert.rejects(assertMaintenanceAccess(pool,{schema}));await owner.query(`REVOKE INSERT ON origen_conversation_summaries FROM ${role}`);await assertMaintenanceAccess(pool,{schema});
  const events=[],runner=createJobRunner(pool,{schema,log:event=>events.push(event)});
  const tasks=[['permission-data',purgePermissionData],['diagnostic-maps',purgeDiagnosticOperations],['metrics',purgeMetrics],['invites',purgeExpiredInvites],['private-summaries',purgePrivateSummaries],['privacy-events',purgePrivacyEvents],['inquiries',purgeInstitutionInquiries],['outreach',purgeInstitutionOutreach],['guidance',purgeGuidanceHistory],['progress',purgeProgressHistory],['report-snapshots',purgeAdminReportSnapshots],['quality',purgeConversationQuality],['onboarding',purgeOnboardingEvents],['admin-reviews',purgeAdminReviews],['privacy-alerts',privacyAlertReport],['permission-supervisor',db=>sweepPermissionCalls(db,{},async()=>{throw Error('unexpected provider call');},Date.now(),()=>{})]];
  for(const [name,work] of tasks){const result=await runner.run(name,work);assert.equal(result.outcome,'completed',`${name}: ${JSON.stringify(events.at(-1))}`);}
  await owner.query("INSERT INTO origen_privacy_events(id,actor_hash,kind,area,occurred_at) SELECT gen_random_uuid(),repeat('a',64),'access_denied','account',now()-interval '100 days' FROM generate_series(1,300)");
  assert.equal((await runner.run('privacy-events',purgePrivacyEvents)).outcome,'completed');assert.equal(Number((await owner.query('SELECT count(*) FROM origen_privacy_events')).rows[0].count),50);
  const account=(await owner.query("INSERT INTO origen_accounts(auth0_subject) VALUES('synthetic-retention') RETURNING id")).rows[0].id;
  await owner.query('INSERT INTO origen_privacy_preferences(account_id,summary_days) VALUES($1,30)',[account]);
  await owner.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at,created_at) VALUES($1,'synthetic-old',NULL,'finance','SYNTHETIC PRIVATE CONTENT',now()-interval '40 days',now()-interval '40 days')",[account]);
  assert.equal((await runner.run('private-summaries',purgePrivateSummaries)).outcome,'completed');assert.equal(Number((await owner.query('SELECT count(*) FROM origen_conversation_summaries')).rows[0].count),0);assert.ok(!JSON.stringify(events).includes('SYNTHETIC PRIVATE CONTENT'));
  await owner.query("INSERT INTO origen_permission_calls(call_id,subject_hash,revision,expires_at) VALUES('synthetic-call',repeat('b',64),1,now()-interval '1 minute')");
  assert.equal((await runner.run('permission-supervisor',db=>sweepPermissionCalls(db,{},async()=>({ok:false,status:500}),Date.now(),event=>events.push(event)))).outcome,'completed');
  assert.equal((await owner.query('SELECT hangup_attempts FROM origen_permission_calls')).rows[0].hangup_attempts,1);assert.equal(events.findLast(e=>e.event==='permission.supervisor.finished').backlog,1);
  assert.equal((await runner.run('permission-supervisor',db=>sweepPermissionCalls(db,{},async()=>({ok:true}),Date.now(),event=>events.push(event)))).outcome,'completed');assert.equal(Number((await owner.query('SELECT count(*) FROM origen_permission_calls')).rows[0].count),0);assert.ok(!JSON.stringify(events).includes('synthetic-call'));
  const script=`import pg from 'pg';import {createJobRunner} from './server/observability/jobs.mjs';const pool=new pg.Pool({connectionString:process.env.JOB_TEST_URL,max:1,options:'-c search_path='+process.env.JOB_TEST_SCHEMA});const runner=createJobRunner(pool,{schema:process.env.JOB_TEST_SCHEMA,log:e=>{if(e.event==='job.started')process.send('locked');}});await runner.run('metrics',()=>new Promise(resolve=>process.once('message',resolve)));await runner.stop();await pool.end();process.send('done');`;
  child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,JOB_TEST_URL:url.href,JOB_TEST_SCHEMA:schema},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  const first=await once(child,'message',{signal:AbortSignal.timeout(10000)});assert.equal(first[0],'locked',stderr);
  assert.equal((await runner.run('metrics',()=>assert.fail('another process owns this lock'))).outcome,'skipped-lock');
  const done=once(child,'exit',{signal:AbortSignal.timeout(10000)});child.send('release');assert.equal((await done)[0],0,stderr);child=null;
  assert.equal((await runner.run('metrics',async()=>{})).outcome,'completed');await runner.stop();assert.ok(runner.lastSuccess().metrics);
 }finally{
  if(child){child.kill();await once(child,'exit').catch(()=>{});}await pool?.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`);await owner.end();
 }
});
test('actual API startup accepts the separate maintenance login and completes every startup cleanup',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const suffix=randomUUID().replaceAll('-',''),name=`start_${suffix}`,apiRole=`start_api_${suffix}`,maintenanceRole=`start_job_${suffix}`;
 const admin=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1});let owner,child;
 try{
  await admin.query(`CREATE DATABASE ${name}`);for(const role of [apiRole,maintenanceRole])await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  const url=new URL(process.env.DATABASE_TEST_URL);url.pathname=`/${name}`;owner=new pg.Pool({connectionString:url.href,max:1});await migrateDatabase(owner);await grantRuntimeAccess(owner,apiRole);await grantMaintenanceAccess(owner,maintenanceRole);
  url.username=apiRole;url.password='';const apiUrl=url.href;url.username=maintenanceRole;
  child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:apiUrl,MAINTENANCE_DATABASE_URL:url.href,AUTH0_DOMAIN:'synthetic.example',AUTH0_AUDIENCE:'synthetic',ALLOWED_ORIGINS:'https://synthetic.example',PORT:'0'},stdio:['ignore','pipe','pipe']});
  const events=[];let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timed out')),10000);let lines='';child.stdout.on('data',data=>{lines+=data;const parts=lines.split('\n');lines=parts.pop();for(const line of parts)try{const event=JSON.parse(line);events.push(event);if(event.event==='service.started'){clearTimeout(timer);resolve();}}catch{}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`startup exited ${code}: ${JSON.stringify(events)} ${stderr}`));});});
  assert.equal(events.filter(e=>e.event==='job.finished'&&e.outcome==='completed').length,15);assert.ok(events.some(e=>e.event==='job.finished'&&e.job==='coordinator-lifecycle'&&e.outcome==='completed'));assert.ok(!events.some(e=>e.outcome==='failed'));
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}await owner?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);for(const role of [apiRole,maintenanceRole])await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();
 }
});

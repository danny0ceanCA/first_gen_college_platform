import {studentFollowUpFixture as fixture} from './fixtures/student-follow-up.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {validateStudentFollowUp,studentFollowUpEnabled,assertStudentFollowUpReady,createStudentFollowUpRepository} from './student-follow-up.mjs';
import {validateFollowUpReport,validateFollowUpSchedule} from '../src/studentFollowUp.mjs';
import {coordinatorConfigurationIssues,coordinatorFlags,reviewRequestFlags} from './binder-sharing-policy.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
import {progressReport} from './progress-report.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const tables=['origen_student_follow_ups','origen_student_follow_up_previews','origen_student_follow_up_receipts','origen_student_follow_up_presentations','origen_student_follow_up_reports','origen_student_follow_up_stops'];
const schedule={onOrAfter:null,timeZone:'America/Chicago'};
test('follow-up contracts reject authority and report inference; definitions separate action, outcome and missingness',()=>{
 const base={action:'prepare',studentId:'alex',target:{planId:randomUUID(),stepId:'one'},operationId:randomUUID(),revision:0,planVersion:1,schedule,language:'es'};
 assert.deepEqual(validateStudentFollowUp(base),base);
 for(const extra of [{enabled:true},{actor:'staff'},{source:{requestId:randomUUID()}},{confirmed:true},{action:'present'},{action:'report'},{action:'export'},{revision:null},{planVersion:1.5},{studentId:null},{target:{...base.target,studentId:'sam'}},{schedule:{...schedule,notify:true}}])assert.throws(()=>validateStudentFollowUp({...base,...extra}),{status:400});
 for(const date of [undefined,'2027-02-30','tomorrow','2027-01-01T00:00:00Z'])assert.throws(()=>validateFollowUpSchedule({...schedule,onOrAfter:date}),{status:400});
 assert.throws(()=>validateFollowUpSchedule({...schedule,timeZone:'Invalid/Place'}),{status:400});
 const report={responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:'I called; I am waiting.',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'};
 assert.equal(validateFollowUpReport(report).provenance,'student_reported');assert.equal(validateFollowUpReport(report).reportedOutcome,'pending');
 for(const extra of [{verified:true},{provenance:'institution_verified'},{responseState:'declined'},{reportedOutcome:'successful'},{reportedAction:null}])assert.throws(()=>validateFollowUpReport({...report,...extra}),{status:400});
 assert.equal(validateFollowUpReport({...report,responseState:'declined',reportedAction:null,reportedOutcome:null,detail:''}).reportedOutcome,null);
 const all=Object.fromEntries([...coordinatorFlags,...reviewRequestFlags].map(k=>[k,'true']));assert.deepEqual(coordinatorConfigurationIssues(all),[]);
 for(const value of ['yes','1',true])assert.ok(coordinatorConfigurationIssues({...all,ORIGEN_STUDENT_FOLLOW_UP:value}).length);
 assert.ok(coordinatorConfigurationIssues({...all,ORIGEN_REVIEW_RESPONSE_CONTEXT:'false'}).length);assert.equal(studentFollowUpEnabled({}),false);
});

test('existing actions and dates confer no consent; exact preview and approval enroll once without sharing',enabled,async t=>{
 const f=await fixture(t);
 const deferred=await f.httpRequest('other','/api/review-response-choices',{action:'defer',studentId:'alex',source:f.source,revision:0,operationId:randomUUID(),reviewOn:'2099-01-01'});assert.equal(deferred.status,200);
 assert.equal((await f.load()).state,'off');assert.equal((await f.load()).canEnroll,false);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_student_follow_ups')).rows[0].n,0);
 await assert.rejects(f.prepare(),{status:503});
 f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 const before=await f.staff({action:'read',id:f.request.id}),outbox=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n;
 const operationId=randomUUID(),p=await f.prepare({operationId,language:'es',schedule:{onOrAfter:'2099-01-02',timeZone:'America/Chicago'}});
 assert.deepEqual(await f.prepare({operationId,language:'es',schedule:{onOrAfter:'2099-01-02',timeZone:'America/Chicago'}}),p);
 assert.equal((await f.load()).revision,0);assert.equal(p.selection.oneCheckIn,true);assert.equal(p.selection.sharedWithCoordinator,false);assert.deepEqual(p.selection.source,f.source);assert.equal(p.selection.action.content,f.plan.steps[0].action);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_RESPONSE_NOT_COPIED/);
 const approval=f.confirmInput(p);await assert.rejects(f.call({...approval,digest:'a'.repeat(64)}),{status:409});await assert.rejects(f.call({...approval,confirmed:false}),{status:400});
 const saved=await f.call(approval);assert.equal(saved.state,'scheduled');assert.equal(saved.revision,1);assert.deepEqual(saved.schedule,{onOrAfter:'2099-01-02',timeZone:'America/Chicago'});assert.equal((await f.call(approval)).revision,1);
 assert.deepEqual(await f.staff({action:'read',id:f.request.id}),before);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n,outbox);
 assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');assert.deepEqual(saved.reports,[]);assert.deepEqual(saved.presentations,[]);
 const stop={action:'stop',operationId:randomUUID(),revision:1};assert.equal((await f.call(stop)).state,'off');assert.equal((await f.call(stop)).revision,2);
 assert.equal((await f.call(approval)).state,'off','A replayed approval must not reactivate stopped consent.');assert.equal((await f.load()).revision,2);
 await assert.rejects(f.call({...stop,action:'pause'}),{status:409});
});

test('confirmation races, expiry and changed preview versions cannot broaden consent',enabled,async t=>{
 const f=await fixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';const p=await f.prepare(),approval=f.confirmInput(p);
 const duplicate=await Promise.all([f.call(approval),f.call(approval)]);assert.ok(duplicate.every(x=>x.revision===1));
 const p2=await f.prepare(),other=await f.prepare();const race=await Promise.allSettled([f.call(f.confirmInput(p2)),f.call(f.confirmInput(other))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
 const expired=await f.prepare();await f.owner.query("UPDATE origen_student_follow_up_previews SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);await assert.rejects(f.call(f.confirmInput(expired)),{status:409});
 await assert.rejects(f.prepare({schedule:{onOrAfter:'2000-01-01',timeZone:'Pacific/Kiritimati'}}),{status:409});
 const edit=await f.prepare();await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='accepted'?{...s,action:'A different action.'}:s)}));await assert.rejects(f.call(f.confirmInput(edit)),{status:409});assert.equal((await f.load()).state,'paused');
});

test('material action changes pause permanently; sibling edits preserve consent and step deletion prunes private links',enabled,async t=>{
 const f=await fixture(t);await f.enroll();
 await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='sibling'?{...s,notes:'Changed a different step.'}:s)}));assert.equal((await f.load()).state,'scheduled');
 await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='accepted'?{...s,status:'complete'}:s)}));assert.equal((await f.load()).state,'paused');
 await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='accepted'?{...s,status:'not-started'}:s)}));assert.equal((await f.load()).state,'paused');
 await f.enroll();await f.edit(p=>({...p,status:'archived'}));assert.equal((await f.load()).state,'paused');await f.edit(p=>({...p,status:'active'}));assert.equal((await f.load()).state,'paused');
 await f.enroll();await f.seedReport();await f.edit(p=>({...p,steps:p.steps.filter(s=>s.id!=='accepted')}));
 for(const table of tables)assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=$1`,[f.account])).rows[0].n,0,table);
 await assert.rejects(f.load(),{status:404});assert.equal((await f.plans()).plans[0].steps.length,1);
});

test('response edits, withdrawal and permission loss invalidate consent and pending approvals without deleting actions',enabled,async t=>{
 for(const change of ['edit','withdraw','connection','permission','role','delete'])await t.test(change,async t=>{
  const f=await fixture(t);await f.enroll();const p=await f.prepare();
  if(change==='edit')await f.reply(1);
  if(change==='withdraw')await f.student({action:'withdraw',id:f.request.id,version:2});
  if(change==='connection')await f.owner.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=$1",[f.connection]);
  if(change==='permission')await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[createHash('sha256').update('other').digest('hex')]);
  if(change==='role')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);
  if(change==='delete')await f.student({action:'remove',id:f.request.id,version:2});
  assert.equal((await f.load()).state,'paused');await assert.rejects(f.call(f.confirmInput(p)),e=>[404,409].includes(e.status));assert.equal((await f.plans()).plans[0].steps[0].action,f.plan.steps[0].action);
  f.env.ORIGEN_STUDENT_FOLLOW_UP='false';const stopped=await f.call({action:'stop',operationId:randomUUID(),revision:(await f.load()).revision});assert.equal(stopped.state,'off');assert.equal(stopped.enabled,false);
 });
});

test('scope and runtime permissions prevent forged enrollment, reports, presentation and operator aggregation',enabled,async t=>{
 const f=await fixture(t);await f.enroll();await f.seedReport();
 await assert.rejects(f.owner.query('UPDATE origen_student_follow_ups SET accepted_plan_version=NULL WHERE account_id=$1',[f.account]),{code:'23514'});
 await assert.rejects(f.owner.query("UPDATE origen_student_follow_ups SET action_hash='' WHERE account_id=$1",[f.account]),{code:'23514'});
 for(const actor of ['reader','staff','colleague'])await assert.rejects(f.call({action:'load'},actor),e=>[403,404].includes(e.status));
 await assert.rejects(f.call({action:'load',studentId:'sam'}),{status:404});
 await assert.rejects(f.call({action:'load',target:{planId:f.plan.id,stepId:'sibling'}}),{status:404});
 for(const table of tables)await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
 for(const signature of ['origen_student_follow_up_after_restore()','origen_student_follow_up_target(uuid,uuid,text)'])assert.equal((await f.owner.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[f.role,signature])).rows[0].allowed,false);
 assert.equal((await f.runtime.query('SELECT origen_student_follow_up_command($1::jsonb) AS result',[JSON.stringify({action:'export'})])).rows[0].result.error,'student_follow_up_denied');
 for(const action of ['present','report','share','set-state'])await assert.rejects(f.call({action}),{status:400});
 assert.equal((await progressReport(f.owner)).feedbackSubmissions,0);assert.deepEqual((await progressReport(f.owner)).reportedMilestones,[]);
 const coordinator=JSON.stringify(await f.staff({action:'read',id:f.request.id}));assert.doesNotMatch(coordinator,/PRIVATE_REPORT_SENTINEL|PRIVATE_PLAN_NOT_SHARED|consentedAt|reported_action/);
});

test('private reports distinguish action from result, export privately, and remain deletable while paused',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const id=await f.seedReport(),data=await f.load();
 assert.equal(data.reports[0].reported_action,'completed');assert.equal(data.reports[0].reported_outcome,'pending');assert.equal(data.reports[0].provenance,'student_reported');assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 await assert.rejects(f.owner.query("UPDATE origen_student_follow_up_reports SET provenance='institution_verified' WHERE id=$1",[id]),{code:'23514'});
 await assert.rejects(f.owner.query("UPDATE origen_student_follow_up_reports SET response_state='declined' WHERE id=$1",[id]),{code:'23514'});
 await assert.rejects(f.owner.query("UPDATE origen_student_follow_up_reports SET occurred_on='2999-01-01' WHERE id=$1",[id]),{code:'23514'});
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.equal(exported.studentFollowUp.reports.length,1);assert.equal(exported.studentFollowUp.enrollments.length,1);assert.doesNotMatch(JSON.stringify(exported.studentFollowUp.enrollments),/action_hash|operation_hash/);
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';const deletion={action:'delete-report',operationId:randomUUID(),reportId:id,revision:1};await f.call(deletion);await f.call(deletion);assert.deepEqual((await f.load()).reports,[]);assert.equal((await f.load()).canEnroll,false);
});

test('expiry remains a consent boundary even if access is extended later, and reactivation needs fresh approval',enabled,async t=>{
 const f=await fixture(t);await f.enroll();
 await f.owner.query("UPDATE origen_student_follow_ups SET valid_until=now()-interval '1 second' WHERE account_id=$1",[f.account]);
 const expired=await f.load();assert.equal(expired.state,'paused');
 assert.equal((await f.load()).state,'paused');
 const renewed=await f.enroll();assert.equal(renewed.state,'scheduled');assert.ok(renewed.revision>expired.revision);
});

test('restore erases stale reports and playback receipts and never restores scheduled consent',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const retained=await f.seedReport(),deleted=await f.seedReport(),corrected=await f.seedReport();
 const old=(await f.owner.query('SELECT * FROM origen_student_follow_up_reports WHERE id=$1',[deleted])).rows[0];
 await f.call({action:'delete-report',operationId:randomUUID(),reportId:deleted,revision:1});await f.owner.query('UPDATE origen_student_follow_up_reports SET version=2,detail=\'Corrected privately\' WHERE id=$1',[corrected]);
 const manifest=await exportDeletionManifest(f.owner);assert.doesNotMatch(JSON.stringify(manifest),/PRIVATE_REPORT_SENTINEL|Corrected privately/);
 await f.owner.query('INSERT INTO origen_student_follow_up_reports SELECT * FROM jsonb_populate_record(NULL::origen_student_follow_up_reports,$1::jsonb)',[JSON.stringify(old)]);
 await f.owner.query('UPDATE origen_student_follow_up_reports SET version=1,detail=\'STALE_REPORT\' WHERE id=$1',[corrected]);
 await f.owner.query('INSERT INTO origen_student_follow_up_presentations(account_id,plan_id,step_id,enrollment_revision,conversation_id) VALUES($1,$2,\'accepted\',1,$3)',[f.account,f.plan.id,randomUUID()]);
 await f.prepare();await replayDeletionManifest(f.owner,manifest);
 const result=await f.load();assert.equal(result.state,'paused');assert.equal(result.pauseReason,'restored');assert.deepEqual(result.reports.map(r=>r.id),[retained]);assert.deepEqual(result.presentations,[]);assert.equal(result.source,null);assert.equal(result.canEnroll,false);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_student_follow_up_previews')).rows[0].n,0);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_student_follow_up_receipts')).rows[0].n,0);
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));for(const table of tables)assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=$1`,[f.account])).rows[0].n,0,table);
});

test('student deletion cascades enrollment and reports independently of the feature flag',enabled,async t=>{
 const f=await fixture(t);await f.enroll();await f.seedReport();f.env.ORIGEN_STUDENT_FOLLOW_UP='false';await f.family('other',{action:'delete-student',id:'alex'});
 for(const table of tables)assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=$1`,[f.account])).rows[0].n,0,table);
});

test('startup and readiness require migrations 104–108 and the scoped commands while checks are read-only',enabled,async t=>{
 const f=await fixture(t);await assertStudentFollowUpReady(f.runtime,{});f.env.ORIGEN_STUDENT_FOLLOW_UP='true';await assertStudentFollowUpReady(f.runtime,f.env);
 for(const migration of ['104_student_follow_up_foundation.sql','105_student_follow_up_controls.sql','106_student_follow_up_selection.sql','107_student_follow_up_conversations.sql','108_student_shared_updates.sql']){
 const missing=(await f.owner.query('DELETE FROM origen_schema_migrations WHERE name=$1 RETURNING *',[migration])).rows[0];
 try{await assert.rejects(assertStudentFollowUpReady(f.runtime,f.env),/migration_required/);}finally{await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[missing.name,missing.checksum]);}
 }
 await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_student_follow_up_command(jsonb) FROM ${f.role}`);
 try{await assert.rejects(assertStudentFollowUpReady(f.runtime,f.env),/migration_required/);const r=await checkCoordinatorDatabase(f.runtime,f.maintenance,{schema:f.schema,env:{}});assert.equal(r.checks.find(c=>c.id==='student-follow-up').passed,false);assert.equal(r.changesApplied,false);assert.equal(r.flags.ORIGEN_STUDENT_FOLLOW_UP,false);}
 finally{await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_student_follow_up_command(jsonb) TO ${f.role}`);}
});

test('pausing during approval rolls back enrollment; concurrent response edits serialize then suspend it',enabled,async t=>{
 const f=await fixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';let p=await f.prepare();let paused=false;
 const pausedDb={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,args)=>{const r=await c.query(sql,args);if(!paused&&sql.includes('origen_student_follow_up_command')&&JSON.parse(args[0]).action==='confirm'){paused=true;f.env.ORIGEN_STUDENT_FOLLOW_UP='false';}return r;}};}};
 await assert.rejects(f.as('other',()=>createStudentFollowUpRepository(pausedDb,f.env)('other',{studentId:'alex',target:f.target,...f.confirmInput(p)})),{status:503});assert.equal((await f.load()).state,'off');
 f.env.ORIGEN_STUDENT_FOLLOW_UP='true';p=await f.prepare();let edit,changed=false,intercepted=false;
 const racingDb={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,args)=>{const r=await c.query(sql,args);if(!intercepted&&sql.includes('origen_student_follow_up_command')&&JSON.parse(args[0]).action==='confirm'){intercepted=true;edit=f.reply(1).then(()=>{changed=true;});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(changed,false);}return r;}};}};
 await f.as('other',()=>createStudentFollowUpRepository(racingDb,f.env)('other',{studentId:'alex',target:f.target,...f.confirmInput(p)}));await edit;assert.equal((await f.load()).state,'paused');
});

test('binder overview is scoped and minimal; stopping all cancels plans and pending approvals while disabled',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const report=await f.seedReport(),pending=await f.prepare();
 const second=(await f.plans({action:'create',requestId:randomUUID(),fromResponse:{source:f.source,stepId:'second',confirmed:true},plan:{studentId:'alex',title:'Another private plan',goal:'',category:'financial',status:'active',summaryIds:[],steps:[{...f.plan.steps[0],id:'second'}]}})).plans.find(p=>p.id!==f.plan.id);
 const otherTarget={planId:second.id,stepId:'second'},p=(await f.call({action:'prepare',target:otherTarget,operationId:randomUUID(),revision:0,planVersion:1,schedule,language:'es'})).preview;
 const secondApproval={...f.confirmInput(p),target:otherTarget};await f.call(secondApproval);
 const controls=(input,subject='other')=>f.httpCall(subject,'/api/student-follow-up',{studentId:'alex',...input});
 const before=await f.staff({action:'read',id:f.request.id}),outbox=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n;
 const view=await controls({action:'overview'});assert.equal(view.items.length,2);assert.equal(view.remaining,2);assert.equal(view.pending,1);assert.ok(view.items.every(i=>i.canEnroll));
 assert.doesNotMatch(JSON.stringify(view),/PRIVATE_|actionHash|digest|consentedAt|account_id/);
 await assert.rejects(controls({action:'overview'},'staff'),{status:403});await assert.rejects(controls({action:'overview',studentId:'missing'}),{status:404});
 for(const input of [{action:'overview',target:f.target},{action:'stop-all'},{action:'stop-all',operationId:randomUUID(),enabled:true},{action:'overview',studentId:null}])assert.throws(()=>validateStudentFollowUp({studentId:'alex',...input}),{status:400});
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';const stop={action:'stop-all',operationId:randomUUID()};const stopped=await controls(stop);
 assert.equal(stopped.remaining,0);assert.equal(stopped.pending,0);assert.equal(stopped.enabled,false);assert.ok(stopped.items.every(i=>i.state==='off'&&!i.canEnroll));
 assert.deepEqual(await controls(stop),stopped);assert.equal((await f.load()).reports[0].id,report);
 f.env.ORIGEN_STUDENT_FOLLOW_UP='true';await assert.rejects(f.call(f.confirmInput(pending)),{status:409});assert.equal((await f.call(secondApproval)).state,'off');
 await f.enroll();assert.equal((await controls(stop)).remaining,1,'A delayed retry must not stop consent granted after the original stop.');
 await controls({action:'stop-all',operationId:randomUUID()});assert.equal((await f.load()).state,'off');
 assert.deepEqual(await f.staff({action:'read',id:f.request.id}),before);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n,outbox);
 assert.equal((await f.plans()).plans.find(p=>p.id===f.plan.id).steps[0].dueDate,'2099-01-01');
 await assert.rejects(f.as('other',()=>f.db.query('SELECT * FROM origen_student_follow_up_stops')),{code:'42501'});
 await f.family('other',{action:'delete-student',id:'alex'});assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_student_follow_up_stops WHERE account_id=$1',[f.account])).rows[0].n,0);
});

test('stop-all serializes against confirmation and cannot cancel another account',enabled,async t=>{
 const f=await fixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';const preview=await f.prepare();
 const stop={action:'stop-all',studentId:'alex',operationId:randomUUID()};
 await assert.rejects(f.httpCall('staff','/api/student-follow-up',stop),{status:403});
 const outcomes=await Promise.allSettled([f.call(f.confirmInput(preview)),f.httpCall('other','/api/student-follow-up',stop)]);
 assert.equal(outcomes[1].status,'fulfilled');assert.equal((await f.load()).state,'off');assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_student_follow_up_previews')).rows[0].n,0);
 const unauthorized=await f.runtime.query('SELECT origen_student_follow_up_controls($1::jsonb) AS result',[JSON.stringify({action:'overview',studentId:'alex'})]);assert.equal(unauthorized.rows[0].result.error,'student_follow_up_denied');
 await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_student_follow_up_controls(jsonb) FROM ${f.role}`);
 try{await assert.rejects(assertStudentFollowUpReady(f.runtime,f.env),/migration_required/);}finally{await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_student_follow_up_controls(jsonb) TO ${f.role}`);}
});

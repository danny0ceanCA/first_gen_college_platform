import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsCoordinatorActor,runRetentionJob,isolateDatabase} from './account-isolation.mjs';
import {grantMaintenanceAccess,assertMaintenanceAccess} from './maintenance-database.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';
import {runSharingCommand,validateSharingInput} from './binder-sharing.mjs';
import {runFeedbackCommand} from './coordinator-feedback.mjs';
import {maintainCoordinators,runNotificationCommand,validateNotificationInput,assertCoordinatorLifecycleReady,createCoordinatorNotificationsHandler} from './coordinator-notifications.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {createServer} from 'node:http';
import {MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const env={ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true',ORIGEN_COORDINATOR_BINDER_VIEWING:'true',ORIGEN_COORDINATOR_FEEDBACK:'true'};
const hash=s=>createHash('sha256').update(s).digest('hex');
async function setup(t){
 const f=await retrievalFixture();t.after(()=>f.close());
 const org=randomUUID(),account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 for(const sub of ['owner','staff','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Synthetic Community'}]);
 for(const [sub,role] of [['owner','owner'],['staff','outreach']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[org,sub,role]);
 const provision=(sub,action,extra={},administrator=false)=>f.as(sub,()=>runAsCoordinatorActor(sub,{administrator},()=>runCoordinatorCommand(f.db,{action,id:org,...extra})));
 await provision('reviewer','approve-organization',{},true);await provision('owner','enable-member',{subject:'staff'});
 await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[hash('other')]);
 await f.owner.query("INSERT INTO origen_coordinator_student_pilots(account_id,student_id,permission_revision,approved_by) VALUES($1,'alex',1,'synthetic')",[account]);
 const connection=randomUUID();await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,display_name) SELECT $1,$2,'alex',id,'requested',$3,now()+interval '7 days','Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),org]);
 const note=randomUUID();await f.note({action:'create',studentId:'alex',id:note,note:{topic:'options',kind:'note',content:'PRIVATE_PUBLICATION_SENTINEL',language:'en'}},'other');
 const share=(action,extra={})=>f.as('other',()=>runSharingCommand(f.db,{...validateSharingInput({action,studentId:'alex',...extra}),enabled:true}));
 const accept=()=>f.owner.query("UPDATE origen_binder_connections SET status='accepted',accepted_at=now(),revision=revision+1 WHERE id=$1",[connection]);
 const publish=async()=>{await accept();const p=await share('preview',{connectionId:connection,topics:['options'],entryIds:[note]});return share('publish',{previewId:p.previewId,confirmed:true});};
 const staff=(input)=>f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},()=>runNotificationCommand(f.db,{audience:'staff',organizationId:org,...input})));
 const student=(input,sub='other')=>f.as(sub,()=>runNotificationCommand(f.db,{audience:'student',studentId:'alex',...input}));
 const operator=(input)=>f.as('reviewer',()=>runAsCoordinatorActor('reviewer',{administrator:true,issuedAt:Math.floor(Date.now()/1000)},()=>runNotificationCommand(f.db,input)));
 const maintenanceRole=`maint_${randomUUID().replaceAll('-','')}`;await createTestLogin(f.owner,maintenanceRole);await grantMaintenanceAccess(f.owner,maintenanceRole,{schema:f.schema});
 const url=new URL(process.env.DATABASE_TEST_URL);useTestLogin(url,maintenanceRole);const maintenance=new pg.Pool({connectionString:url.href,options:`-c search_path=${f.schema}`,max:1});
 // Close this role before the fixture drops its schema and owner connection.
 const close=f.close;f.close=async()=>{await maintenance.end();await f.owner.query(`DROP OWNED BY ${maintenanceRole}`);await f.owner.query(`DROP ROLE ${maintenanceRole}`);await close();};
 const sweep=()=>runRetentionJob(()=>maintainCoordinators(isolateDatabase(maintenance,{schema:f.schema})));
 const feedback=async(grant,pub)=>f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},()=>runFeedbackCommand(f.db,{action:'staff-create',organizationId:org,grantId:grant,publicationId:pub,topic:'options',kind:'guidance',body:'PRIVATE_GUIDANCE_SENTINEL',requestId:randomUUID(),enabled:true})));
 return {...f,org,account,connection,note,provision,share,publish,accept,staff,student,operator,sweep,maintenance,feedback};
}
test('notification validation allows only bounded routing fields',()=>{
 assert.deepEqual(validateNotificationInput({action:'list',audience:'student',studentId:'alex',recipient:'attacker',administrator:true}),{action:'list',audience:'student',studentId:'alex'});
 for(const v of [{action:'deliver'},{action:'open',audience:'student',studentId:'alex',id:'bad'},{action:'list',audience:'staff',organizationId:'bad'},{action:'resolve-report',id:randomUUID(),resolution:'read-private-conversation'}])assert.throws(()=>validateNotificationInput(v),{status:400});
});
test('transactional delivery, isolation, reauthorization and student receipts',enabled,async t=>{
 const f=await setup(t);await assertMaintenanceAccess(f.maintenance,{schema:f.schema});await assertCoordinatorLifecycleReady(f.runtime,env,f.maintenance);
 await assert.rejects(f.as('other',()=>maintainCoordinators(f.db)),{code:'42501'});
 for(const table of ['origen_coordinator_outbox','origen_coordinator_notifications','origen_coordinator_operations'])await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
 await f.sweep();let requested=(await f.staff({action:'list'})).notifications;assert.equal(requested.length,1);assert.equal(requested[0].kind,'requested');
 await f.sweep();assert.equal((await f.staff({action:'list'})).notifications.length,1);
 await assert.rejects(f.student({action:'open',id:requested[0].id}),{status:404});
 await f.staff({action:'read',id:requested[0].id});await f.staff({action:'read',id:requested[0].id});assert.equal((await f.staff({action:'list'})).notifications[0].read,true);
 const publication=await f.publish(),grant=(await f.share('status')).grants[0].id;await f.sweep();
 assert.deepEqual((await f.staff({action:'list'})).notifications.map(n=>n.kind),['published']);
 const fid=(await f.feedback(grant,publication.publicationId)).id;
 await f.as('other',()=>runFeedbackCommand(f.db,{action:'student-reply',studentId:'alex',feedbackId:fid,version:1,requestId:randomUUID(),body:'PRIVATE_REPLY_SENTINEL',enabled:true}));await f.sweep();
 const messages=await f.student({action:'list'});assert.ok(messages.notifications.some(n=>n.kind==='feedback'));assert.ok(!JSON.stringify(messages).includes('PRIVATE_'));assert.deepEqual((await f.student({action:'list'},'reader')).notifications,[]);
 const staffMessages=(await f.staff({action:'list'})).notifications;assert.ok(staffMessages.some(n=>n.kind==='reply'));
 const link=await f.staff({action:'open',id:staffMessages[0].id});assert.equal(link.grantId,grant);
 const serialized=JSON.stringify((await f.owner.query('SELECT * FROM origen_coordinator_outbox')).rows);assert.ok(!serialized.includes('PRIVATE_'));
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.match(JSON.stringify(exported.coordinatorSharing),/PRIVATE_GUIDANCE_SENTINEL/);assert.ok(!JSON.stringify(exported.coordinatorSharing).includes('author_subject'));
 const staffExport=await f.as('staff',()=>createLifecycleRepository(f.db)('staff',{action:'export'}));assert.ok(!JSON.stringify(staffExport).includes('PRIVATE_'));
 await f.share('revoke',{grantId:grant});await assert.rejects(f.staff({action:'open',id:staffMessages[0].id}),{status:404});await f.sweep();
 assert.deepEqual((await f.staff({action:'list'})).notifications,[]);const ended=await f.student({action:'list'});assert.ok(ended.notifications.some(n=>n.kind==='revoked'));assert.ok(ended.notifications.some(n=>n.kind==='feedback'));
 assert.equal((await f.owner.query("SELECT count(*) FROM origen_binder_publication_items WHERE content<>''")).rows[0].count,'0');
});
test('failed deliveries retry idempotently and expired metadata is physically purged',enabled,async t=>{
 const f=await setup(t);
 await f.owner.query("CREATE FUNCTION fail_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delivery failure'; END $$; CREATE TRIGGER fail_delivery BEFORE INSERT ON origen_coordinator_notifications FOR EACH ROW EXECUTE FUNCTION fail_delivery()");
 await f.sweep();assert.equal((await f.owner.query('SELECT attempts FROM origen_coordinator_outbox')).rows[0].attempts,1);let ops=await f.operator({action:'operations'});assert.equal(ops.events24h.delivery_failed,1);assert.equal(ops.pending,1);
 for(let i=0;i<4;i++){await f.owner.query('UPDATE origen_coordinator_outbox SET available_at=now()');await f.sweep();}assert.equal((await f.operator({action:'operations'})).failed,1);
 await f.owner.query('DROP TRIGGER fail_delivery ON origen_coordinator_notifications');await f.operator({action:'retry-deliveries'});await f.operator({action:'retry-deliveries'});await f.sweep();await f.sweep();assert.equal((await f.staff({action:'list'})).notifications.length,1);
 await f.owner.query("UPDATE origen_coordinator_notifications SET created_at=now()-interval '32 days',expires_at=now()-interval '1 day'; UPDATE origen_coordinator_outbox SET expires_at=now()-interval '1 day'; UPDATE origen_coordinator_operation_events SET occurred_at=now()-interval '181 days'");
 await f.sweep();assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_notifications')).rows[0].count,'0');assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_outbox')).rows[0].count,'0');assert.deepEqual((await f.operator({action:'operations'})).events24h,{});
});
test('staff departure, eligibility withdrawal, source deletion and expiry suppress queued jobs',enabled,async t=>{
 for(const cause of ['departure','eligibility','source','expiry','suspension'])await t.test(cause,async t=>{
  const f=await setup(t);await f.publish();const grant=(await f.share('status')).grants[0].id;
  if(cause==='departure')await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);
  if(cause==='eligibility')await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[hash('other')]);
  if(cause==='source')await f.as('other',()=>f.db.query('DELETE FROM origen_topic_notes WHERE id=$1',[f.note]));
  if(cause==='expiry')await f.owner.query("UPDATE origen_binder_share_grants SET created_at=now()-interval '91 days',expires_at=now()-interval '1 second' WHERE id=$1",[grant]);
  if(cause==='suspension')await f.provision('reviewer','suspend-organization',{},true);
  await f.sweep();const messages=(await f.staff({action:'list'})).notifications;
  // Empty publications have no source content; publication metadata can remain.
  if(cause!=='source')assert.deepEqual(messages,[]);
  assert.equal((await f.owner.query("SELECT count(*) FROM origen_binder_publication_items WHERE content<>''")).rows[0].count,'0');
 });
});
test('expiry warnings, request/code/preview retention and feedback erasure evidence',enabled,async t=>{
 const f=await setup(t),pub=await f.publish(),grant=(await f.share('status')).grants[0].id;
 await f.owner.query("UPDATE origen_binder_share_grants SET expires_at=now()+interval '6 days' WHERE id=$1",[grant]);await f.sweep();await f.sweep();assert.equal((await f.student({action:'list'})).notifications.filter(n=>n.kind==='expiring').length,1);
 const fid=(await f.feedback(grant,pub.publicationId)).id;const oldCreate=(await f.owner.query('SELECT request_id FROM origen_coordinator_feedback WHERE id=$1',[fid])).rows[0].request_id;await f.as('other',()=>runFeedbackCommand(f.db,{action:'student-remove',studentId:'alex',feedbackId:fid,version:1,requestId:randomUUID()}));
 assert.equal((await f.owner.query("SELECT count(*) FROM origen_deletion_journal WHERE kind='coordinator-feedback' AND record_id=$1",[fid])).rows[0].count,'1');await f.sweep();
 assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_feedback')).rows[0].count,'0');await assert.rejects(f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},()=>runFeedbackCommand(f.db,{action:'staff-create',organizationId:f.org,grantId:grant,publicationId:pub.publicationId,topic:'options',kind:'guidance',body:'PRIVATE_GUIDANCE_SENTINEL',requestId:oldCreate,enabled:true}))),{status:404});assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_feedback_revisions')).rows[0].count,'0');
 await f.share('preview',{connectionId:f.connection,topics:['options'],entryIds:[f.note]});await f.owner.query("UPDATE origen_binder_previews SET expires_at=now()-interval '14 minutes'");
 await f.provision('staff','rotate-code');await f.owner.query("UPDATE origen_coordinator_codes SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day'");await f.sweep();
 assert.equal((await f.owner.query('SELECT count(*) FROM origen_binder_previews')).rows[0].count,'0');assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_codes WHERE revoked_at IS NULL')).rows[0].count,'0');
});
test('abuse operations never expose content and require independent operator capability',enabled,async t=>{
 const f=await setup(t),pub=await f.publish(),grant=(await f.share('status')).grants[0].id,id=(await f.feedback(grant,pub.publicationId)).id;
 await f.as('other',()=>runFeedbackCommand(f.db,{action:'student-report',studentId:'alex',feedbackId:id,version:1,requestId:randomUUID(),reason:'abuse'}));
 await assert.rejects(f.student({action:'operations'}),{status:403});await assert.rejects(f.staff({action:'operations'}),{status:403});
 const ops=await f.operator({action:'operations'});assert.equal(ops.reports.length,1);assert.ok(!JSON.stringify(ops).includes('PRIVATE_'));
 await f.operator({action:'resolve-report',id,resolution:'coordinator-disabled'});await f.operator({action:'resolve-report',id,resolution:'coordinator-disabled'});
 assert.equal((await f.owner.query("SELECT status FROM origen_coordinator_profiles WHERE auth0_subject='staff'")).rows[0].status,'disabled');assert.equal((await f.operator({action:'operations'})).reports.length,0);
});
test('backup replay cannot revive sharing or removed guidance and account deletion cascades',enabled,async t=>{
 const f=await setup(t),pub=await f.publish(),grant=(await f.share('status')).grants[0].id,id=(await f.feedback(grant,pub.publicationId)).id;
 await f.sweep();const manifest=await exportDeletionManifest(f.owner);assert.ok(!JSON.stringify(manifest).includes('PRIVATE_'));
 await replayDeletionManifest(f.owner,manifest);await replayDeletionManifest(f.owner,manifest);
 assert.equal((await f.owner.query("SELECT count(*) FROM origen_binder_share_grants WHERE status='active'")).rows[0].count,'0');assert.equal((await f.owner.query("SELECT count(*) FROM origen_binder_publication_items WHERE content<>''")).rows[0].count,'0');assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_outbox')).rows[0].count,'0');
 // A later protected erasure manifest replay deletes a restored student receipt.
 await f.as('other',()=>runFeedbackCommand(f.db,{action:'student-remove',studentId:'alex',feedbackId:id,version:1,requestId:randomUUID()}));const removed=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,removed);assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_feedback')).rows[0].count,'0');
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
 for(const table of ['origen_binder_connections','origen_coordinator_outbox','origen_coordinator_notifications','origen_coordinator_feedback'])assert.equal((await f.owner.query(`SELECT count(*) FROM ${table} WHERE account_id=$1`,[f.account])).rows[0].count,'0');
});
test('HTTP requires staff MFA, verified email, operator permission and server flag',enabled,async t=>{
 const f=await setup(t);await f.sweep();const now=Math.floor(Date.now()/1000);let identity={sub:'staff',iat:now,[MFA_TIME_CLAIM]:now,[AUTH_TIME_CLAIM]:now},verified=true;
 const handler=createCoordinatorNotificationsHandler(f.db,{...env,AUTH0_DOMAIN:'synthetic.auth0.com'},async()=>({ok:true,json:async()=>({sub:identity.sub,email:'staff@example.test',email_verified:verified})}));
 const server=createServer((req,res)=>{req.origenAuthorized=true;req.origenIdentity=identity;f.as(identity.sub,()=>handler(req,res,()=>{res.writeHead(404);res.end();}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const send=input=>fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-notifications`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify(input)});
 const input={action:'list',audience:'staff',organizationId:f.org};let response=await send(input);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 identity={...identity,[MFA_TIME_CLAIM]:undefined};assert.equal((await send(input)).status,403);identity={...identity,[MFA_TIME_CLAIM]:now};verified=false;assert.equal((await send(input)).status,403);verified=true;
 assert.equal((await send({action:'operations',administrator:true})).status,403);
});
test('opening an old link waits for revocation and cannot return a stale destination',enabled,async t=>{
 const f=await setup(t);await f.publish();await f.sweep();const message=(await f.staff({action:'list'})).notifications.find(n=>n.kind==='published');const grant=(await f.share('status')).grants[0].id;
 const c=await f.owner.connect();try{
  await c.query('BEGIN');await c.query("UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1 WHERE id=$1",[grant]);
  const pending=assert.rejects(f.staff({action:'open',id:message.id}),{status:404});await new Promise(r=>setTimeout(r,50));await c.query('COMMIT');await pending;
 }finally{await c.query('ROLLBACK');c.release();}
});
test('a restored old guidance row is erased by the separately preserved journal',enabled,async t=>{
 const f=await setup(t),pub=await f.publish(),grant=(await f.share('status')).grants[0].id,id=(await f.feedback(grant,pub.publicationId)).id;
 const original=(await f.owner.query('SELECT to_jsonb(f) AS row FROM origen_coordinator_feedback f WHERE id=$1',[id])).rows[0].row;
 await f.as('other',()=>runFeedbackCommand(f.db,{action:'student-remove',studentId:'alex',feedbackId:id,version:1,requestId:randomUUID()}));await f.sweep();const currentEvidence=await exportDeletionManifest(f.owner);
 // Only the synthetic backup fixture is rewound. This models an old database
 // whose local erasure journal and retry receipts predate the removal.
 await f.owner.query("DELETE FROM origen_deletion_journal WHERE account_id=$1 AND kind='coordinator-feedback'",[f.account]);await f.owner.query('DELETE FROM origen_coordinator_feedback_tombstones WHERE account_id=$1',[f.account]);
 await f.owner.query('INSERT INTO origen_coordinator_feedback SELECT * FROM jsonb_populate_record(NULL::origen_coordinator_feedback,$1::jsonb)',[JSON.stringify(original)]);assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_feedback')).rows[0].count,'1');
 await replayDeletionManifest(f.owner,currentEvidence);assert.equal((await f.owner.query('SELECT count(*) FROM origen_coordinator_feedback')).rows[0].count,'0');
 assert.equal((await f.owner.query('SELECT deleted FROM origen_coordinator_feedback_tombstones WHERE request_id=$1',[original.request_id])).rows[0].deleted,true);
});

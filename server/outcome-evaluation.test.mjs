import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {outcomeEvaluationFixture} from './fixtures/outcome-evaluation.mjs';
import {assertOutcomeEvaluationReady} from './outcome-evaluation.mjs';
import {validateEvaluationCommand} from '../src/outcomeEvaluation.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('evaluation commands reject authority, extra context, arbitrary periods and alternate purposes',()=>{
 const request={action:'report',organizationId:randomUUID(),definitionId:'document_submitted',purpose:'service_quality',contractVersion:1};
 assert.deepEqual(validateEvaluationCommand(request,true),request);
 for(const patch of [{purpose:'training'},{contractVersion:2},{cutoff:'2026-01-01'},{period:'2026-10'},{accountId:randomUUID()},{enabled:true},{term:'private'},{definitionId:'generic_success'}])assert.throws(()=>validateEvaluationCommand({...request,...patch},true));
});
test('saving and sharing never imply evaluation; exact unchecked preview and approval are separate',db,async t=>{
 const f=await outcomeEvaluationFixture(t),before=await f.plans(),context=await f.context();
 const initial=await f.command({action:'load'});assert.equal(initial.eligible,true);assert.equal(initial.permission,null);
 const p=await f.prepareEvaluation();assert.equal((await f.command({action:'load'})).permission,null);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_EVALUATION_SENTINEL/);
 await assert.rejects(f.command({action:'confirm',previewId:p.id,digest:p.digest,confirmed:false}),{status:400});
 const saved=await f.confirmEvaluation(p);assert.equal(saved.status,'included');assert.equal(saved.permission.version,1);assert.deepEqual(await f.confirmEvaluation(p),saved);
 assert.deepEqual(await f.plans(),before);assert.equal((await f.verify(context.guard)).status,'current');
 await f.command({action:'withdraw',version:1,confirmed:true});assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');assert.deepEqual(await f.plans(),before);
 await assert.rejects(f.confirmEvaluation(p),{status:409});
});
test('decline and paused withdrawal preserve ordinary guidance and export only own permission',db,async t=>{
 const f=await outcomeEvaluationFixture(t);await f.command({action:'decline',version:0,confirmed:true});assert.equal((await f.command({action:'load'})).permission.status,'declined');
 const p=await f.prepareEvaluation();await f.confirmEvaluation(p);f.env.ORIGEN_OUTCOME_EVALUATION='false';
 assert.equal((await f.command({action:'load'})).enabled,false);await assert.rejects(f.prepareEvaluation(),{status:503});
 await f.command({action:'withdraw',version:2,confirmed:true});assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');
 assert.equal((await f.outcomes({action:'load',target:f.target})).evidence.length,1);
 const exported=await f.as('other',()=>f.db.query("SELECT origen_student_outcome_evaluation_command('{\"action\":\"export\"}') AS r"));assert.equal(exported.rows[0].r.permissions[0].permission.status,'withdrawn');
});
test('each purpose and recipient requires its own grant; private inputs never reach group output',db,async t=>{
 const f=await outcomeEvaluationFixture(t,{historical:true});await f.grant();await assert.rejects(f.qualityReport(),{status:403});
 await f.grantEvaluation(true);assert.equal((await f.qualityBundle()).items.length,0);
 await f.confirmEvaluation(await f.prepareEvaluation());const bundle=await f.qualityBundle();assert.equal(bundle.items.length,1);
 assert.doesNotMatch(JSON.stringify(bundle),/PRIVATE_EVALUATION_SENTINEL|Example University|Insurance documents|student_id|account_id|statement/);
 const report=await f.qualityReport();assert.equal(report.status,'suppressed');assert.equal(report.episodes,null);assert.ok(Object.values(report.metrics).every(m=>m.count===null&&m.denominator===null&&m.rate===null));
 assert.doesNotMatch(JSON.stringify(report),new RegExp(`${f.account}|${f.saved.episodeId}|PRIVATE_EVALUATION_SENTINEL|episodeKey|participantKey`));
 await assert.rejects(f.qualityReport({organizationId:randomUUID()}),{status:403});await assert.rejects(f.qualityReport({},'other'),{status:403});
 await f.grantEvaluation(false);await assert.rejects(f.qualityReport(),{status:403});
});
test('corrections invalidate contributions and approval, and do not fabricate historical correction counts',db,async t=>{
 const f=await outcomeEvaluationFixture(t,{historical:true});await f.grantEvaluation(true);const old=await f.prepareEvaluation();await f.confirmEvaluation(old);
 const evidence=(await f.outcomes({action:'load',target:f.target})).evidence[0];
 await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='Corrected private text' WHERE id=$1",[evidence.report_id]);
 const state=(await f.command({action:'load'})).permission;assert.equal(state.status,'needs_review');assert.equal(state.corrections,1);assert.equal((await f.qualityBundle()).items.length,0);await assert.rejects(f.confirmEvaluation(old),{status:404});
 await f.record({reportId:evidence.report_id,status:'pending'});await f.confirmEvaluation(await f.prepareEvaluation());
 const renewed=(await f.qualityBundle()).items;assert.equal(renewed.length,1);assert.equal(renewed[0].corrections,1);assert.equal(renewed[0].evidence[0].report_version,2);
 await f.command({action:'withdraw',version:(await f.command({action:'load'})).permission.version,confirmed:true});const withdrawn=(await f.command({action:'load'})).permission;assert.equal(withdrawn.corrections,0);assert.equal(withdrawn.trackingSince,null);
});
test('changed private source, eligibility, owner, expiry and restore cannot reuse an approval',db,async t=>{
 for(const change of ['report','role','age','expiry','restore'])await t.test(change,async t=>{
  const f=await outcomeEvaluationFixture(t,{historical:true}),p=await f.prepareEvaluation();
  if(change==='report')await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='Changed' WHERE account_id=$1",[f.account]);
  if(change==='role')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);
  if(change==='age')await f.owner.query("UPDATE origen_eligibility SET age_band='13to17',status='pending' WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");
  if(change==='expiry')await f.owner.query("UPDATE origen_outcome_evaluation_previews SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[p.id]);
  if(change==='restore')await f.owner.query('SELECT origen_outcome_evaluation_after_restore()');
  await assert.rejects(f.confirmEvaluation(p));
 });
 const f=await outcomeEvaluationFixture(t);await assert.rejects(f.command({action:'load'},'reader'),e=>[403,404].includes(e.status));await assert.rejects(f.command({action:'load',studentId:'someone-else'}),{status:404});
});
test('permission withdrawal, expiry, restore and episode deletion remove all future contributions',db,async t=>{
 const f=await outcomeEvaluationFixture(t,{historical:true});await f.grantEvaluation(true);await f.confirmEvaluation(await f.prepareEvaluation());assert.equal((await f.qualityBundle()).items.length,1);
 await f.command({action:'withdraw',version:1,confirmed:true});assert.equal((await f.qualityBundle()).items.length,0);
 await f.confirmEvaluation(await f.prepareEvaluation());await f.owner.query("UPDATE origen_outcome_evaluation_permissions SET expires_at=clock_timestamp()-interval '1 second' WHERE episode_id=$1",[f.saved.episodeId]);assert.equal((await f.qualityBundle()).items.length,0);
 await f.confirmEvaluation(await f.prepareEvaluation());await f.owner.query('SELECT origen_outcome_evaluation_after_restore()');assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');await assert.rejects(f.qualityReport(),{status:403});
 await f.confirmEvaluation(await f.prepareEvaluation());const e=(await f.outcomes({action:'load',target:f.target})).episodes[0];await f.outcomes({action:'delete-episode',target:f.target,id:e.id,version:e.version});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_evaluation_permissions')).rows[0].n,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_evaluation_previews')).rows[0].n,0);
});
test('runtime roles cannot read raw evaluation data, grant access or call privileged helpers',db,async t=>{
 const f=await outcomeEvaluationFixture(t);await assertOutcomeEvaluationReady(f.db,f.env);
 for(const table of ['origen_outcome_evaluation_permissions','origen_outcome_evaluation_capabilities','origen_outcome_evaluation_previews'])await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
 for(const query of ["SELECT origen_outcome_evaluation_after_restore()",`SELECT origen_outcome_evaluation_fingerprint('${f.account}','${f.saved.episodeId}')`,`SELECT origen_outcome_evaluation_grant('${f.org}','${f.coordinator}',NULL)`])await assert.rejects(f.as('other',()=>f.db.query(query)),{code:'42501'});
});
test('report access requires fresh MFA, verified email and current membership and tokens',db,async t=>{
 const {Readable}=await import('node:stream'),{createOutcomeEvaluationHandler}=await import('./outcome-evaluation.mjs'),{MFA_TIME_CLAIM}=await import('./staff-access.mjs'),{AUTH_TIME_CLAIM}=await import('./recent-auth.mjs');
 const f=await outcomeEvaluationFixture(t);await f.grantEvaluation(true);const seconds=Math.floor(Date.now()/1000),input={action:'report',organizationId:f.org,definitionId:'document_submitted',purpose:'service_quality',contractVersion:1};
 const identity={sub:'staff',iat:seconds,[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds};
 async function check(who,verified=true){
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:'/api/outcome-evaluation-report',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer staff'},origenAuthorized:true,origenIdentity:who});
  let status,body;const res={writeHead:s=>{status=s;},end:value=>{body=JSON.parse(value);}};
  const handler=createOutcomeEvaluationHandler(f.db,f.env,async()=>new Response(JSON.stringify({sub:'staff',email:'staff@example.test',email_verified:verified}),{status:200}));await f.as('staff',()=>handler(req,res,()=>assert.fail('route fell through')));return {status,body};
 }
 assert.equal((await check({...identity,[MFA_TIME_CLAIM]:undefined})).body.error,'staff_mfa_required');assert.equal((await check({...identity,[AUTH_TIME_CLAIM]:seconds-86400})).body.error,'reauthentication_required');assert.equal((await check(identity,false)).status,403);
 await f.owner.query("INSERT INTO origen_staff_access_controls(subject_hash,token_valid_after) VALUES(encode(sha256(convert_to('staff','UTF8')),'hex'),clock_timestamp()+interval '1 minute')");assert.equal((await check(identity)).body.error,'staff_access_revoked');
 await f.owner.query('DELETE FROM origen_staff_access_controls');await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);await assert.rejects(f.qualityReport(),{status:403});
});
test('a withdrawal between aggregation and final verification discards the entire result',db,async t=>{
 const {createOutcomeEvaluationRepository}=await import('./outcome-evaluation.mjs'),{runAsCoordinatorActor}=await import('./account-isolation.mjs');
 const f=await outcomeEvaluationFixture(t,{historical:true});await f.grantEvaluation(true);await f.confirmEvaluation(await f.prepareEvaluation());let changed=false;
 const database={connect:async()=>{const c=await f.db.connect();return {query:async(sql,args)=>{
  if(sql.includes('origen_service_quality_command')&&JSON.parse(args[0]).action==='verify'){await f.command({action:'withdraw',version:1,confirmed:true});changed=true;}
  return c.query(sql,args);
 },release:()=>c.release()};}};
 const run=createOutcomeEvaluationRepository(database,f.env);
 await assert.rejects(f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},()=>run('staff',{action:'report',organizationId:f.org,definitionId:'document_submitted',purpose:'service_quality',contractVersion:1},true))),{status:409});assert.equal(changed,true);assert.equal((await f.qualityBundle()).items.length,0);
});
test('backup export is read-only, restore revokes evaluation and account erasure removes permissions',db,async t=>{
 const {exportDeletionManifest,replayDeletionManifest}=await import('../ops/privacy-recovery.mjs'),{createLifecycleRepository}=await import('./account-lifecycle.mjs');
 const f=await outcomeEvaluationFixture(t);await f.grantEvaluation(true);await f.confirmEvaluation(await f.prepareEvaluation());
 const exportOwn=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.equal(exportOwn.outcomeEvaluationPermissions[0].permission.status,'granted');
 const manifest=await exportDeletionManifest(f.owner);assert.equal((await f.command({action:'load'})).permission.status,'granted');
 await replayDeletionManifest(f.owner,manifest);assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_evaluation_permissions WHERE account_id=$1',[f.account])).rows[0].n,0);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_evaluation_previews WHERE account_id=$1',[f.account])).rows[0].n,0);
});

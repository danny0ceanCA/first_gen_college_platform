import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {studentFollowUpFixture} from './fixtures/student-follow-up.mjs';
import {outcomeEvidenceCases} from './fixtures/outcome-evidence-cases.mjs';
import {outcomeDefinitions,outcomeEvidenceContract,phase3OutcomeCompatibility,validateOutcomeEpisode,validateOutcomeReportLink,validateOutcomeEventDate} from '../src/outcomeEvidence.mjs';
import {outcomeEvidenceEnabled,validateOutcomeEvidence,assertOutcomeEvidenceReady} from './outcome-evidence.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {runOperatorReport} from './account-isolation.mjs';
import {progressReport} from './progress-report.mjs';
import {exportDeletionManifest,replayDeletionManifest,validateDeletionManifest} from '../ops/privacy-recovery.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const episode=(definitionId='document_submitted')=>({definitionId,definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle:'aid-documents-1'},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'}});
const proposal=()=>({episode:episode(),report:{id:randomUUID(),version:1},responseState:'answered',claimStatus:'occurred',decision:null});
async function fixture(t){
 const f=await studentFollowUpFixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 const call=(input,subject='other')=>f.httpCall(subject,'/api/outcome-evidence',{action:'load',studentId:'alex',target:f.target,...input});
 const catalog=()=>f.httpCall('other','/api/outcome-evidence',{action:'definitions'});
 const seedEpisode=async(definition='document_submitted',extra={})=>{
  const body={account_id:f.account,student_id:'alex',plan_id:f.plan.id,step_id:'accepted',definition_id:definition,definition_version:1,institution:'Example University',term:'2026–2027',cycle:randomUUID(),window_start:'2026-01-01',window_end:'2026-12-31',time_zone:'America/Chicago',consented_at:new Date().toISOString(),...extra};
  const keys=Object.keys(body);return (await f.owner.query(`INSERT INTO origen_outcome_episodes(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(body))).rows[0];
 };
 const seedEvidence=async(e,extra={})=>{
  const report=extra.report_id||await f.seedReport();
  const body={account_id:f.account,episode_id:e.id,report_id:report,report_version:1,response_state:'answered',claim_status:'occurred',decision:e.definition_id==='decision_received'?'denied':null,event_on:null,date_precision:'unknown',time_zone:'America/Chicago',approved_at:new Date().toISOString(),...extra};
  const keys=Object.keys(body);return (await f.owner.query(`INSERT INTO origen_outcome_evidence(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(body))).rows[0];
 };
 const seed=async()=>{await f.enroll();const e=await seedEpisode();const r=await seedEvidence(e);return {e,r};};
 return {...f,outcome:call,catalog,seedEpisode,seedEvidence,seed};
}

test('versioned claims separate submission, acceptance, decisions, approval and helpfulness',()=>{
 assert.equal(outcomeDefinitions.length,5);assert.ok(Object.isFrozen(outcomeDefinitions[0].bases));
 assert.ok(outcomeDefinitions.find(d=>d.id==='document_submitted').doesNotEstablish.includes('waiver_approved'));
 assert.match(phase3OutcomeCompatibility.reportedOutcome,/do not infer/);assert.match(phase3OutcomeCompatibility.helpfulness,/separate/);
 assert.equal(outcomeEvidenceContract.institutionVerified,false);assert.equal(outcomeEvidenceContract.evaluationAllowed,false);
 assert.deepEqual(new Set(outcomeEvidenceCases.map(c=>c.definition)),new Set(outcomeDefinitions.map(d=>d.id)));
 for(const c of outcomeEvidenceCases){assert.ok(c.en&&c.es);const p=validateOutcomeReportLink({...proposal(),episode:episode(c.definition),claimStatus:c.status,decision:c.decision});assert.equal(p.decision,c.decision);assert.ok(!('institutionVerified'in p));}
 assert.throws(()=>validateOutcomeReportLink({...proposal(),decision:'denied'}),{status:400});
 for(const responseState of ['declined','unknown']){
  assert.equal(validateOutcomeReportLink({...proposal(),responseState,claimStatus:null}).claimStatus,null);
  assert.throws(()=>validateOutcomeReportLink({...proposal(),responseState}),{status:400});
 }
});
test('contracts reject forged authority, inference, unsupported definitions and invalid windows',()=>{
 for(const extra of [{accountId:randomUUID()},{studentId:'someone-else'},{provenance:'institution_verified'},{confirmed:true},{assessment:'supports'},{evaluationAllowed:true},{occurredOn:'2026-01-01'}])assert.throws(()=>validateOutcomeReportLink({...proposal(),...extra}),{status:400});
 for(const change of [{definitionId:'aid_awarded'},{definitionVersion:2},{scope:{institution:'Campus',term:'',cycle:'x'}},{window:{start:'2026-02-30',end:'2026-03-02',timeZone:'UTC'}},{window:{start:'2026-01-01',end:'2027-01-02',timeZone:'UTC'}},{window:{start:'2026-01-02',end:'2026-01-01',timeZone:'UTC'}},{window:{start:'2026-01-01',end:'2026-01-02',timeZone:'Invalid/Zone'}}])assert.throws(()=>validateOutcomeEpisode({...episode(),...change}),{status:400});
 for(const action of ['create','prepare','confirm','verify','assess','export'])assert.throws(()=>validateOutcomeEvidence({action}),{status:400});
 assert.throws(()=>validateOutcomeEvidence({action:'definitions',allowed:true}),{status:400});
});
test('event dates remain explicit or unknown, with future-day checks in the saved time zone',()=>{
 const now=new Date('2026-11-02T01:00:00Z');
 assert.deepEqual(validateOutcomeEventDate({on:null,precision:'unknown',timeZone:'UTC'},now),{on:null,precision:'unknown',timeZone:'UTC'});
 assert.equal(validateOutcomeEventDate({on:'2026-11-02',precision:'day',timeZone:'Pacific/Kiritimati'},now).on,'2026-11-02');
 for(const value of [{on:'2026-11-02',precision:'day',timeZone:'America/Los_Angeles'},{on:'2026-02-30',precision:'day',timeZone:'UTC'},{on:null,precision:'day',timeZone:'UTC'},{on:'2026-11-01',precision:'unknown',timeZone:'UTC'}])assert.throws(()=>validateOutcomeEventDate(value,now),{status:400});
});
test('feature defaults off, dependencies are explicit and the foundation advertises no writer',()=>{
 assert.equal(outcomeEvidenceEnabled({},'student'),false);assert.equal(outcomeEvidenceEnabled({ORIGEN_OUTCOME_EVIDENCE:'true'},'student'),false);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_OUTCOME_EVIDENCE:'true'}).some(x=>x.includes('requires student follow-up')));
 assert.ok(coordinatorConfigurationIssues({ORIGEN_OUTCOME_EVIDENCE:'yes'}).some(x=>x.includes('use true or false')));
});
test('catalog matches the migration; existing acceptance, reports and sharing confer no evidence consent',db,async t=>{
 const f=await fixture(t);await f.enroll();await f.seedReport();
 const expected=[...outcomeDefinitions].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual((await f.catalog()).definitions,expected);
 const before=await f.staff({action:'read',id:f.request.id});const load=await f.outcome({});
 assert.deepEqual(load.episodes,[]);assert.deepEqual(load.evidence,[]);assert.equal(load.enabled,false);assert.equal(load.canRecord,false);assert.equal(load.canAssess,false);
 f.env.ORIGEN_OUTCOME_EVIDENCE='true';assert.equal((await f.outcome({})).enabled,true);
 for(const action of ['create','confirm','verify','assess'])await assert.rejects(f.outcome({action}),{status:400});
 assert.deepEqual(await f.staff({action:'read',id:f.request.id}),{...before,outcomeReviewEnabled:true});
});
test('scoped history and raw-table/helper permissions reject other accounts and operator aggregation',db,async t=>{
 const f=await fixture(t);const {e,r}=await f.seed();const result=await f.outcome({});
 assert.equal(result.episodes[0].id,e.id);assert.equal(result.evidence[0].id,r.id);assert.ok(!('account_id'in result.episodes[0]));assert.ok(!('action_hash'in result.episodes[0]));
 for(const actor of ['reader','staff','colleague'])await assert.rejects(f.outcome({},actor),e=>[403,404].includes(e.status));
 await assert.rejects(f.outcome({studentId:'sam'}),{status:404});
 for(const table of ['origen_outcome_definitions','origen_outcome_episodes','origen_outcome_evidence'])await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
 for(const fn of ['origen_outcome_evidence_after_restore()','origen_outcome_reconcile(null,null)'])await assert.rejects(f.as('other',()=>f.db.query('SELECT '+fn)),{code:'42501'});
 const direct=await f.as('other',()=>f.db.query("SELECT origen_outcome_evidence_command('{\"action\":\"verify\",\"verified\":true}') AS result"));assert.equal(direct.rows[0].result.error,'invalid_outcome_evidence');
 const operator=await runOperatorReport(()=>f.db.query("SELECT origen_outcome_evidence_command('{\"action\":\"export\"}') AS result"));assert.equal(operator.rows[0].result.error,'outcome_evidence_denied');
 const progress=await runOperatorReport(()=>progressReport(f.db));assert.doesNotMatch(JSON.stringify(progress),new RegExp(e.id+'|'+r.id+'|Example University'));
});
test('database guards reject mismatched owner/report/version, invented verification and invalid dates',db,async t=>{
 const f=await fixture(t);await f.enroll();const e=await f.seedEpisode(),report=await f.seedReport();
 for(const extra of [{student_id:'sam'},{definition_version:2},{time_zone:'Invalid/Zone'},{window_end:'2025-01-01'},{consented_at:'2099-01-01'},{institution:' Campus '}])await assert.rejects(f.seedEpisode('document_submitted',extra),e=>['23514','23503'].includes(e.code));
 for(const extra of [{report_version:2},{account_id:randomUUID()},{origin:'institution_verified'},{basis:'declared_record_review'},{assessment:'supports'},{institution_verified:true},{evaluation_allowed:true},{purpose:'training'},{event_on:'2099-01-01',date_precision:'day'},{decision:'approved'},{response_state:'declined',claim_status:null}])await assert.rejects(f.seedEvidence(e,{report_id:report,...extra}),{code:'23514'});
 const saved=await f.seedEvidence(e,{report_id:report});assert.equal(saved.event_on,null);assert.equal(saved.assessment,'not_assessed');assert.equal(saved.institution_verified,false);
 await assert.rejects(f.seedEvidence(e,{report_id:report}),{code:'23505'});
 await assert.rejects(f.seedEpisode('document_submitted',{cycle:e.cycle}),{code:'23505'});
 // The old report date check uses its recorded date; the new evidence guard
 // additionally checks the actual current date, even for a malformed fixture.
 const futureEpisode=await f.seedEpisode('document_submitted',{window_start:'2099-01-01',window_end:'2099-12-31'});
 const future=await f.seedReport();await f.owner.query("UPDATE origen_student_follow_up_reports SET recorded_at='2099-01-01T12:00:00Z',occurred_on='2099-01-01' WHERE id=$1",[future]);
 await assert.rejects(f.seedEvidence(futureEpisode,{report_id:future,event_on:'2099-01-01',date_precision:'day'}),{code:'23514'});
});
test('a received denial remains distinct from waiver approval and unknown/declined claims stay empty',db,async t=>{
 const f=await fixture(t);await f.enroll();const e=await f.seedEpisode('decision_received');const r=await f.seedEvidence(e);assert.equal(r.claim_status,'occurred');assert.equal(r.decision,'denied');assert.equal(r.institution_verified,false);
 const other=await f.seedEpisode('waiver_approved');await assert.rejects(f.seedEvidence(other,{decision:'denied'}),{code:'23514'});
 for(const state of ['unknown','declined']){
  const report=await f.seedReport();await f.owner.query("UPDATE origen_student_follow_up_reports SET response_state=$2,reported_action=NULL,reported_outcome=NULL,detail='',helpfulness=NULL WHERE id=$1",[report,state]);
  const row=await f.seedEvidence(other,{report_id:report,response_state:state,claim_status:null});assert.equal(row.claim_status,null);assert.equal(row.event_on,null);
 }
 assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
});
test('report correction invalidates private evidence without changing an approved coordinator copy',db,async t=>{
 const f=await fixture(t);const {e,r}=await f.seed();const shared=await f.staff({action:'read',id:f.request.id});
 await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='CORRECTED_PRIVATE' WHERE id=$1",[r.report_id]);
 assert.equal((await f.load()).reports.find(x=>x.id===r.report_id).detail,'CORRECTED_PRIVATE');
 const result=await f.outcome({});assert.equal(result.episodes[0].invalidation_reason,'report_changed');assert.deepEqual(result.evidence,[]);
 await assert.rejects(f.seedEvidence(e,{report_id:r.report_id}),{code:'23514'});
 assert.deepEqual(await f.staff({action:'read',id:f.request.id}),shared);
 await f.call({action:'delete-report',operationId:randomUUID(),reportId:r.report_id,revision:2});assert.equal((await f.load()).reports.length,0);
});
test('selected action edits invalidate permanently, sibling edits preserve evidence and deletion removes links',db,async t=>{
 const f=await fixture(t);await f.seed();await f.edit(p=>{p.steps[1].notes='Sibling only';return p;});assert.equal((await f.outcome({})).episodes[0].state,'current');
 await f.edit(p=>{p.steps[0].action='A different action';return p;});assert.equal((await f.outcome({})).episodes[0].invalidation_reason,'action_changed');
 await f.edit(p=>{p.steps[0].action=f.plan.steps[0].action;return p;});assert.equal((await f.outcome({})).episodes[0].state,'needs_review');
 await f.edit(p=>{p.steps=p.steps.filter(s=>s.id!=='accepted');return p;});assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_episodes')).rows[0].n,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_evidence')).rows[0].n,0);
});
test('source edits and revoked permission cannot become current after a later restoration of access',db,async t=>{
 for(const change of ['source','permission'])await t.test(change,async t=>{
  const f=await fixture(t);await f.seed();
  if(change==='source')await f.reply(1);
  else{await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[f.account]);}
  assert.equal((await f.outcome({})).episodes[0].state,'needs_review');
 });
});
test('export and idempotent erasure remain available while paused, without deleting reports or actions',db,async t=>{
 const f=await fixture(t);const {e,r}=await f.seed();f.env.ORIGEN_OUTCOME_EVIDENCE='false';f.env.ORIGEN_STUDENT_FOLLOW_UP='false';
 const data=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.equal(data.outcomeEvidence.episodes[0].id,e.id);assert.equal(data.outcomeEvidence.evidence[0].id,r.id);
 const del={action:'delete-episode',id:e.id,version:1};await assert.rejects(f.outcome({...del,version:2}),{status:409});assert.equal((await f.outcome(del)).status,'deleted');assert.equal((await f.outcome(del)).status,'deleted');
 assert.deepEqual((await f.outcome({})).episodes,[]);assert.equal((await f.load()).reports.length,1);assert.equal((await f.plans()).plans.length,1);
});
test('extending source access cannot extend an earlier evidence approval beyond its original expiry',db,async t=>{
 const f=await fixture(t);await f.enroll();
 await f.owner.query("UPDATE origen_review_request_publications SET expires_at=clock_timestamp()+interval '2 seconds' WHERE request_id=$1 AND invalidated_at IS NULL",[f.request.id]);
 const e=await f.seedEpisode();await f.seedEvidence(e);
 await f.owner.query("UPDATE origen_review_request_publications SET expires_at=clock_timestamp()+interval '7 days' WHERE request_id=$1 AND invalidated_at IS NULL",[f.request.id]);
 await new Promise(resolve=>setTimeout(resolve,2100));
 const current=await f.outcome({});assert.equal(current.episodes[0].state,'needs_review');assert.equal(current.episodes[0].invalidation_reason,'source_changed');
});
test('restore fences remove deleted evidence and legacy manifests cannot reactivate evidence consent',db,async t=>{
 const f=await fixture(t);const {e,r}=await f.seed();const kept=await f.seedEpisode('office_contacted');await f.seedEvidence(kept);
 await f.outcome({action:'delete-episode',id:e.id,version:1});const manifest=await exportDeletionManifest(f.owner);assert.doesNotMatch(JSON.stringify(manifest),/Example University|PRIVATE_REPORT|document_submitted/);
 const reinsert=await f.seedEpisode('document_submitted',{id:e.id,cycle:e.cycle});await f.seedEvidence(reinsert,{id:r.id,report_id:r.report_id});
 await replayDeletionManifest(f.owner,manifest);const result=await f.outcome({});assert.deepEqual(result.episodes.map(x=>x.id),[kept.id]);assert.equal(result.episodes[0].invalidation_reason,'restored');
 await replayDeletionManifest(f.owner,manifest);assert.equal((await f.outcome({})).episodes.length,1);
 const {checksum,outcomeEpisodeFences,outcomeEvidenceFences,...legacy}=manifest;const older={...legacy,checksum:createHash('sha256').update(JSON.stringify(legacy)).digest('hex')};await replayDeletionManifest(f.owner,older);assert.deepEqual((await f.outcome({})).episodes,[]);
 const bad={...legacy,outcomeEvidenceFences:[{account_id:'bad',id:r.id,version:1}]};assert.throws(()=>validateDeletionManifest({...bad,checksum:createHash('sha256').update(JSON.stringify(bad)).digest('hex')}),/invalid_deletion_manifest/);
});
test('student and account deletion remove all private outcome records',db,async t=>{
 for(const kind of ['student','account'])await t.test(kind,async t=>{
  const f=await fixture(t);await f.seed();
  if(kind==='student')await f.family('other',{action:'delete-student',id:'alex'});else await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
  for(const table of ['origen_outcome_episodes','origen_outcome_evidence'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 });
});
test('startup and read-only readiness require migration, scoped execution and denied helper/raw access',db,async t=>{
 const f=await fixture(t);await assertOutcomeEvidenceReady(null,{});f.env.ORIGEN_OUTCOME_EVIDENCE='true';await assertOutcomeEvidenceReady(f.runtime,f.env);
 const migration=(await f.owner.query("DELETE FROM origen_schema_migrations WHERE name='109_outcome_evidence_foundation.sql' RETURNING *")).rows[0];
 await assert.rejects(assertOutcomeEvidenceReady(f.runtime,f.env),/migration_required/);await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[migration.name,migration.checksum]);
 await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_outcome_evidence_command(jsonb) FROM ${f.role}`);await assert.rejects(assertOutcomeEvidenceReady(f.runtime,f.env),/migration_required/);
 const readiness=await checkCoordinatorDatabase(f.runtime,f.maintenance,{schema:f.schema,env:{}});assert.equal(readiness.checks.find(c=>c.id==='outcome-evidence').passed,false);assert.equal(readiness.changesApplied,false);
 await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_outcome_evidence_command(jsonb) TO ${f.role}`);
 await f.owner.query(`GRANT SELECT ON origen_outcome_evidence TO ${f.role}`);await assert.rejects(assertOutcomeEvidenceReady(f.runtime,f.env),/runtime_isolation/);await f.owner.query(`REVOKE SELECT ON origen_outcome_evidence FROM ${f.role}`);
 await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_outcome_evidence_after_restore() TO ${f.role}`);await assert.rejects(assertOutcomeEvidenceReady(f.runtime,f.env),/runtime_isolation/);await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_outcome_evidence_after_restore() FROM ${f.role}`);
 await assertOutcomeEvidenceReady(f.runtime,f.env);
});

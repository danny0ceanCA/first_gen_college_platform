import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {outcomeEvaluationFixture} from './fixtures/outcome-evaluation.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('pause stops new outcome use while private correction, history and evaluation withdrawal remain available',db,async t=>{
 const f=await outcomeEvaluationFixture(t);await f.grant();await f.observationConfirm(await f.observationPrepare());await f.confirmEvaluation(await f.prepareEvaluation());
 const before=await f.observe({action:'load'}),ctx=await f.context(),plans=await f.plans(),report=(await f.load()).reports[0];
 f.env.ORIGEN_OUTCOME_EVIDENCE='false';f.env.ORIGEN_OUTCOME_EVALUATION='false';
 const paused=await f.outcomes({action:'load',target:f.target});assert.equal(paused.enabled,false);assert.equal(paused.evidence.length,1);assert.equal(paused.assessments,undefined);assert.equal((await f.context()).outcomeAssessment,undefined);assert.equal((await f.verify(ctx.guard)).status,'changed');
 await assert.rejects(f.record(),{status:503});await assert.rejects(f.observationPrepare(),{status:503});
 await f.command({action:'withdraw',version:1,confirmed:true});assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');
 const p=(await f.httpCall('other','/api/student-follow-up-report',{action:'prepare',studentId:'alex',target:f.target,operationId:randomUUID(),planVersion:plans.plans[0].version,language:'en',payload:{reportId:report.id,reportVersion:report.version,report:{responseState:'answered',reportedAction:report.reported_action,reportedOutcome:'pending',detail:'PRIVATE_PAUSED_CORRECTION',helpfulness:null,occurredOn:null,timeZone:report.time_zone},planStatus:null}})).preview;
 await f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:p.id,digest:p.digest,confirmed:true});
 assert.equal((await f.outcomes({action:'load',target:f.target})).evidence.length,0);assert.deepEqual(await f.plans(),plans);
 const after=await f.observe({action:'load'});assert.equal(after.enabled,false);assert.deepEqual(after.observations,before.observations.map(({assessment,...r})=>r));assert.doesNotMatch(JSON.stringify(after),/PRIVATE_PAUSED_CORRECTION/);
 f.env.ORIGEN_OUTCOME_EVIDENCE='true';f.env.ORIGEN_OUTCOME_EVALUATION='true';assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');assert.equal((await f.outcomes({action:'load',target:f.target})).assessments[0].state,'unavailable');
});
test('the complete permitted student/coordinator journey stays excluded from evaluation and notification payloads',db,async t=>{
 const f=await outcomeEvaluationFixture(t,{historical:true});await f.grant();await f.observationConfirm(await f.observationPrepare());await f.sweep();await f.grantEvaluation(true);
 const ctx=await f.context();assert.equal(ctx.outcomeAssessment.privateEpisodes.length,1);assert.equal(ctx.outcomeAssessment.sharedObservations.length,1);assert.equal((await f.qualityBundle()).items.length,0);
 const notices=(await f.owner.query('SELECT to_jsonb(n) AS row FROM origen_coordinator_notifications n')).rows;
 assert.doesNotMatch(JSON.stringify(notices),new RegExp('PRIVATE_EVALUATION_SENTINEL|'+f.saved.episodeId+'|'+f.saved.evidenceId+'|partly_helpful'));
 await f.command({action:'decline',version:0,confirmed:true});assert.equal((await f.qualityBundle()).items.length,0);assert.equal((await f.verify(ctx.guard)).status,'current');
 const restored=await f.qualityReport();assert.equal(restored.status,'suppressed');assert.equal(restored.episodes,null);
});
test('readiness checks all outcome migrations and isolated grants even with both release flags off',db,async t=>{
 const f=await outcomeEvaluationFixture(t);const result=await checkCoordinatorDatabase(f.runtime,f.maintenance,{schema:f.schema,env:{ORIGEN_OUTCOME_EVIDENCE:'false',ORIGEN_OUTCOME_EVALUATION:'false'}});
 assert.equal(result.passed,true,JSON.stringify(result.checks));assert.ok(result.checks.some(c=>c.id==='outcome-evidence'&&c.passed));assert.ok(result.checks.some(c=>c.id==='outcome-evaluation'&&c.passed));assert.equal(result.flags.ORIGEN_OUTCOME_EVALUATION,false);assert.equal(result.changesApplied,false);
});

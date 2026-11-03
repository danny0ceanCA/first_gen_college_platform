import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recommendationEvaluationFixture} from './fixtures/recommendation-evaluation.mjs';
import {assertRecommendationEvaluationReady} from './recommendation-evaluation.mjs';
import {validateRecommendationEvaluation} from '../src/recommendationEvaluation.mjs';
import {recommendationEvaluationRows} from './recommendation-evaluation-quality.mjs';
import {createLiveMemoryRepository} from './live-memory.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('recommendation evaluation has a distinct closed purpose and report contract',()=>{
 const input={action:'load',studentId:'alex',purpose:'recommendation_evaluation',contractVersion:1};assert.deepEqual(validateRecommendationEvaluation(input),input);
 for(const extra of [{purpose:'service_quality'},{contractVersion:2},{accepted:true}])assert.throws(()=>validateRecommendationEvaluation({...input,...extra}));
 assert.throws(()=>validateRecommendationEvaluation({action:'report',purpose:'recommendation_evaluation',contractVersion:1,organizationId:randomUUID(),studentId:'alex'},true));
});
test('only explicit separate consent records future checks, display and acceptance',db,async t=>{
 const f=await recommendationEvaluationFixture(t);const old=await f.choose();assert.equal(old.status,'recommended');assert.equal((await f.receipts()).length,0);
 const preview=await f.prepareEvaluation();await assert.rejects(f.command({action:'confirm',previewId:preview.id,digest:preview.digest,confirmed:false}),{status:400});assert.equal((await f.receipts()).length,0);
 assert.equal((await f.confirmEvaluation(preview)).status,'included');assert.equal((await f.confirmEvaluation(preview)).status,'included');
 await f.deliver({action:'display',id:old.id});assert.equal((await f.receipts()).length,0,'no backfilled displays');
 const fresh=await f.choose();let receipts=await f.receipts();assert.equal(receipts.length,1);assert.equal(receipts[0].displayed_at,null);assert.equal(receipts[0].accepted_at,null);
 await f.deliver({action:'display',id:fresh.id});await f.deliver({action:'display',id:fresh.id});await f.deliver({action:'confirm',id:fresh.id,confirmed:true});
 receipts=await f.receipts();assert.equal(receipts.length,1);assert.ok(receipts[0].displayed_at);assert.ok(receipts[0].accepted_at);assert.equal(receipts[0].played_at,null);assert.equal(receipts[0].recommendation_id,fresh.id);assert.doesNotMatch(JSON.stringify(receipts),/PRIVATE_|Ask the|transcript|statement/);
});
test('withdrawal and decline delete contributions while recommendations remain available',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();const g=(await f.command({action:'load'})).permission;
 f.env.ORIGEN_RECOMMENDATION_EVALUATION='false';assert.equal((await f.command({action:'withdraw',version:g.version,confirmed:true})).status,'excluded');assert.equal((await f.receipts()).length,0);assert.equal((await f.choose()).status,'recommended');
 await assert.rejects(f.prepareEvaluation(),{status:503});f.env.ORIGEN_RECOMMENDATION_EVALUATION='true';await f.consent();assert.equal((await f.receipts()).length,0,'new consent does not revive old traces');
 await f.choose();await f.command({action:'decline',version:(await f.command({action:'load'})).permission.version,confirmed:true});assert.equal((await f.receipts()).length,0);
});
test('expiry, scope changes and wrong owners invalidate approval',db,async t=>{
 const f=await recommendationEvaluationFixture(t),p=await f.prepareEvaluation();await assert.rejects(f.command({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true},'reader'),{status:409});
 await f.owner.query("UPDATE origen_recommendation_evaluation_previews SET expires_at=clock_timestamp()-interval '1 second'");await assert.rejects(f.confirmEvaluation(p),{status:409});
 const other=await f.prepareEvaluation();await f.owner.query("UPDATE origen_binder_connections SET status='revoked' WHERE account_id=$1",[f.account]);await assert.rejects(f.confirmEvaluation(other),{status:409});
});
test('scoped reviewer capability, suppression, no row output and daily report budget',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();await f.previousMonth();await assert.rejects(f.report(),{status:403});await f.reviewer();
 const raw=await f.bundle();assert.equal(raw.items.length,1);assert.doesNotMatch(JSON.stringify(raw),/PRIVATE_|Ask the|Synthetic Community Center/);
 await assert.rejects(f.report({organizationId:randomUUID()}),{status:403});await assert.rejects(f.report({},'colleague'),{status:403});
 const report=await f.report();assert.equal(report.status,'suppressed');assert.equal(report.participants,null);assert.equal(report.selections,null);assert.equal(report.purpose,'recommendation_evaluation');assert.ok(Object.values(report.metrics).every(v=>v.count===null&&v.denominator===null));assert.doesNotMatch(JSON.stringify(report),/participantKey|sourceKey|episodeKey|"items"|PRIVATE_/);
 await assert.rejects(f.report(),{status:429});
});
test('source revocation removes included receipts and restore revokes permission and reviewer access',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();await f.previousMonth();await f.reviewer();assert.equal((await f.bundle()).items.length,1);
 await f.admin({action:'revoke',id:f.template.id,revision:2});assert.equal((await f.bundle()).items.length,0);
 await f.owner.query('SELECT origen_recommendation_evaluation_after_restore()');assert.equal((await f.receipts()).length,0);assert.equal((await f.command({action:'load'})).permission.status,'withdrawn');await assert.rejects(f.report(),{status:403});
});
test('readiness denies raw tables and privileged helpers',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await assertRecommendationEvaluationReady(f.runtime,f.env);
 for(const table of ['permissions','previews','receipts','capabilities','report_budget'])await assert.rejects(f.runtime.query('SELECT * FROM origen_recommendation_evaluation_'+table),/permission denied/);
 await assert.rejects(f.runtime.query('SELECT origen_recommendation_evaluation_after_restore()'),/permission denied/);
 await f.owner.query('GRANT EXECUTE ON FUNCTION origen_recommendation_evaluation_receipt_current(uuid,uuid) TO PUBLIC');await assert.rejects(assertRecommendationEvaluationReady(f.runtime,f.env),/isolation_required/);
});
test('maintenance preserves valid contributions, excludes expiry and deletes expired receipts',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();await f.maintenance.query('SELECT origen_recommendation_evaluation_purge()');assert.equal((await f.receipts()).length,1);
 await f.owner.query("UPDATE origen_recommendation_evaluation_permissions SET expires_at=clock_timestamp()-interval '1 second'");await f.maintenance.query('SELECT origen_recommendation_evaluation_purge()');assert.equal((await f.receipts()).length,0);
 assert.equal((await f.command({action:'load'})).permission.status,'needs_review');
});
test('minor eligibility, parent role and stale connection revisions cannot collect',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();
 await f.owner.query("UPDATE origen_eligibility SET age_band='13to17' WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");
 assert.equal((await f.command({action:'load'})).organizations.length,0);assert.equal((await f.receipts()).length,0);await assert.rejects(f.prepareEvaluation(),{status:403});
 await f.owner.query("UPDATE origen_eligibility SET age_band='18plus' WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);assert.equal((await f.command({action:'load'})).organizations.length,0);
 await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[f.account]);assert.equal((await f.command({action:'load'})).organizations.length,0,'restoring a role does not revive a revoked organization connection');
 const current=await recommendationEvaluationFixture(t);await current.consent();await current.choose();await current.owner.query('UPDATE origen_binder_connections SET revision=revision+1 WHERE account_id=$1',[current.account]);assert.equal((await current.command({action:'load'})).permission.status,'needs_review');assert.equal((await current.receipts()).length,0);
});
test('permission withdrawal between report reads prevents returning a stale aggregate',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();await f.previousMonth();await f.reviewer();let changed=false;
 const database={connect:async()=>{const c=await f.db.connect();return {release:()=>c.release(),query:async(sql,args)=>{const result=await c.query(sql,args);if(!changed&&sql.includes('SELECT origen_recommendation_evaluation_report(')){changed=true;await f.owner.query("UPDATE origen_recommendation_evaluation_permissions SET status='withdrawn',version=version+1");}return result;}};}};
 const {createRecommendationEvaluationRepository}=await import('./recommendation-evaluation.mjs'),{runAsCoordinatorActor}=await import('./account-isolation.mjs');
 await assert.rejects(f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},()=>createRecommendationEvaluationRepository(database,f.env)('staff',{action:'report',purpose:'recommendation_evaluation',contractVersion:1,organizationId:f.org},true))),{status:409});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_report_budget')).rows[0].n,0);
});
test('owner export includes only that account and student deletion cascades evaluation data',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.choose();
 const own=await f.as('other',async()=>(await f.db.query("SELECT origen_student_recommendation_evaluation('{\"action\":\"export\"}') AS result")).rows[0].result),other=await f.as('reader',async()=>(await f.db.query("SELECT origen_student_recommendation_evaluation('{\"action\":\"export\"}') AS result")).rows[0].result);
 assert.equal(own.receipts.length,1);assert.equal(own.permissions.length,1);assert.equal(other.receipts.length,0);assert.equal(other.permissions.length,0);
 await f.owner.query("DELETE FROM origen_students WHERE account_id=$1 AND id='alex'",[f.account]);assert.equal((await f.receipts()).length,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_permissions')).rows[0].n,0);
});
test('voice receipt distinguishes partial playback, complete readback and acceptance',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();
 const memory=input=>f.as('other',()=>createLiveMemoryRepository(f.db,f.env)('other',input));
 const {createRecommendationDeliveryRepository}=await import('./recommendation-delivery.mjs');
 const voice=input=>f.as('other',()=>createRecommendationDeliveryRepository(f.db,f.env)('other',input,true));
 const session=await memory({action:'open',studentId:'alex',revision:(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0]?.revision||0});
 const turn=async(sequence,transcript)=>{const e={sessionId:session.id,sequence,turnId:randomUUID(),transcript};await memory({action:'turn',...e,language:'en'});return e;};
 await voice({...await turn(1,'What next step should I take to contact the office?'),action:'select',timeZone:'America/Chicago'});
 const second=await turn(2,'Save this step.'),preview=await voice({...second,action:'prepare'});
 await voice({...second,action:'present',presentation:preview.readback.slice(0,50)});assert.equal((await f.receipts())[0].played_at,null);
 await voice({...second,action:'present',presentation:preview.readback});assert.ok((await f.receipts())[0].played_at);assert.equal((await f.receipts())[0].accepted_at,null);
 await voice({...await turn(3,'Yes, save it.'),action:'confirm'});assert.ok((await f.receipts())[0].accepted_at);assert.equal((await f.receipts())[0].displayed_at,null);
});
test('only exact approved outcome links contribute; ambiguity and corrections remove the old outcome',db,async t=>{
 const f=await recommendationEvaluationFixture(t);await f.consent();await f.owner.query('DELETE FROM origen_review_response_plan_links WHERE account_id=$1',[f.account]);
 const p=await f.deliver({action:'select',request:{language:'en',intent:'revisit_action',goal:'understand_requirement',process:'office_contact',focus:f.source,episodes:[],timeZone:'America/Chicago'},answers:{document_requested:'unknown',document_prepared:'unknown',submission_reported:'unknown',decision_pending:'unknown'}}),saved=await f.deliver({action:'confirm',id:p.id,confirmed:true}),target=saved.target;
 const rp=(await f.httpCall('other','/api/student-follow-up-report',{action:'prepare',studentId:'alex',target,operationId:randomUUID(),planVersion:1,language:'en',payload:{report:{responseState:'answered',reportedAction:'attempted',reportedOutcome:'pending',detail:'PRIVATE_OUTCOME_PROSE: I asked the office.',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'},planStatus:null}})).preview;
 const report=await f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:rp.id,digest:rp.digest,confirmed:true});
 async function record(cycle,link=true){const preview=(await f.httpCall('other','/api/outcome-evidence',{action:'prepare',studentId:'alex',target,operationId:randomUUID(),planVersion:1,language:'en',...(link?{recommendationProtocol:'recommendation-provenance-v1'}:{}),payload:{link:{episode:{definitionId:'document_submitted',definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'}},report:{id:report.reportId,version:1},responseState:'answered',claimStatus:'pending',decision:null},correction:null,replaces:null}})).preview;return f.httpCall('other','/api/outcome-evidence',{action:'confirm',studentId:'alex',previewId:preview.id,digest:preview.digest,confirmed:true});}
 await record('Unlinked result',false);await f.previousMonth();await f.reviewer();assert.equal((await f.bundle()).items[0].outcomes.length,0);
 const one=await record('Explicitly linked result');let bundle=await f.bundle();assert.equal(bundle.items[0].outcomes.length,1);assert.doesNotMatch(JSON.stringify(bundle),/PRIVATE_|Example University|2026–2027|Explicitly linked/);
 let row=recommendationEvaluationRows(bundle)[0];assert.equal(row.pending,true);assert.equal(row.reportedAttempt,true);assert.equal(row.supportedOutcome,false);
 const second=await record('Another explicit result');bundle=await f.bundle();row=recommendationEvaluationRows(bundle)[0];assert.equal(row.outcome,'ambiguous');assert.equal(row.episodeKey,null);
 await f.owner.query("UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='report_changed' WHERE id=ANY($1::uuid[])",[[one.episodeId,second.episodeId]]);assert.equal((await f.bundle()).items[0].outcomes.length,0);
});

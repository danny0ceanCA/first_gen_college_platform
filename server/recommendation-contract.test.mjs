import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recommendationContract,RECOMMENDATION_POLICY_VERSION,validateRecommendationSource,validateRecommendationScope,validateRecommendationCandidate,validateRecommendationDecision,validateRecommendationActionLink,validateRecommendationCommand} from '../src/recommendationContract.mjs';
import {recommendationsEnabled,assertRecommendationContractReady} from './recommendation-contract.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {recommendationFixture,syntheticRecommendationCandidate} from './fixtures/recommendation-contract.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
import {runOperatorReport} from './account-isolation.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('candidate contracts preserve bilingual guidance and reject inferred authority and sensitive ranking features',()=>{
 const c=syntheticRecommendationCandidate();assert.deepEqual(validateRecommendationCandidate(c),c);
 assert.ok(Object.isFrozen(recommendationContract.permissions));assert.equal(recommendationContract.authority.canRecommend,false);
 for(const extra of [{successProbability:0.9},{ethnicity:'Latino'},{health_details:'private'},{approved:true},{evaluationAllowed:true},{accountId:randomUUID()}])assert.throws(()=>validateRecommendationCandidate({...c,...extra}),{status:400});
 for(const change of [{source:{kind:'conversation',id:randomUUID()}},{action:{en:'An action'}},{goal:'award_aid'},{prerequisites:['immigration_status']},{exclusions:['coordinator_popularity']},{prerequisites:['current_official_requirement']},{expiresAt:c.reviewedAt},{reviewedAt:'2026-02-30T00:00:00.000Z'},{support:Array(9).fill({kind:'official-policy',id:randomUUID(),version:1})}])assert.throws(()=>validateRecommendationCandidate({...c,...change}),{status:400});
 const ref={kind:'official-policy',id:randomUUID(),version:1};assert.throws(()=>validateRecommendationCandidate({...c,support:[ref,ref]}),{status:400});
 const valid=validateRecommendationCandidate({...c,prerequisites:['current_official_requirement'],support:[ref]});assert.equal(valid.support.length,1);
});
test('scope distinguishes unknown campus/term from organization and rejects claimed confirmation fields',()=>{
 const scope=syntheticRecommendationCandidate().scope;
 assert.deepEqual(validateRecommendationScope({...scope,organizationId:randomUUID()}).campus,{state:'unknown',id:null});
 for(const change of [{campus:{state:'unknown',id:randomUUID()}},{campus:{state:'confirmed',id:null}},{campus:{state:'confirmed',id:'Example University'}},{term:{state:'confirmed',value:''}},{term:{state:'unknown',value:'2026'}},{verified:true}])assert.throws(()=>validateRecommendationScope({...scope,...change}),{status:400});
 for(const source of [{kind:'accepted-action',planId:randomUUID(),stepId:'step',planVersion:1},{kind:'review-response',requestId:randomUUID(),responseVersion:1,organizationId:randomUUID()},syntheticRecommendationCandidate().source]){
  assert.deepEqual(validateRecommendationSource(source),source);assert.throws(()=>validateRecommendationSource({...source,approved:true}),{status:400});
 }
});
test('decision and action-link proposals cannot supply consent or reinterpret unavailable evidence as success',()=>{
 const candidate=syntheticRecommendationCandidate(),base={contractVersion:1,policyVersion:RECOMMENDATION_POLICY_VERSION,status:'recommended',candidate,reason:'current_goal',sourceRevision:'a'.repeat(64)};
 assert.deepEqual(validateRecommendationDecision(base),base);
 for(const change of [{confidence:0.8},{policyVersion:'learned-v1'},{status:'recommended',candidate:null},{status:'unavailable',reason:'lookup_failed'},{reason:'successful_for_similar_students'}])assert.throws(()=>validateRecommendationDecision({...base,...change}),{status:400});
 assert.equal(validateRecommendationDecision({...base,status:'unavailable',reason:'lookup_failed',candidate:null,sourceRevision:null}).status,'unavailable');
 const link={contractVersion:1,policyVersion:RECOMMENDATION_POLICY_VERSION,source:candidate.source,sourceRevision:'a'.repeat(64),target:{planId:randomUUID(),stepId:'step',planVersion:1}};
 assert.deepEqual(validateRecommendationActionLink(link),link);
 for(const extra of [{confirmed:true},{share:true},{outcome:'successful'},{purpose:'service_quality'}])assert.throws(()=>validateRecommendationActionLink({...link,...extra}),{status:400});
});
test('both switches default off and recommendation evaluation requires its own readiness and capability',async()=>{
 assert.equal(recommendationsEnabled({},'student'),false);assert.equal(recommendationsEnabled({ORIGEN_RECOMMENDATIONS:'true'},'student'),false);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_RECOMMENDATIONS:'true'}).some(x=>x.includes('requires student follow-up')));
 for(const key of ['ORIGEN_RECOMMENDATIONS','ORIGEN_RECOMMENDATION_EVALUATION'])assert.ok(coordinatorConfigurationIssues({[key]:'yes'}).some(x=>x.includes(key)));
 assert.ok(coordinatorConfigurationIssues({ORIGEN_OUTCOME_EVALUATION:'true',ORIGEN_RECOMMENDATION_EVALUATION:'true'}).some(x=>x.includes('requires outcome evidence')));
 await assertRecommendationContractReady(null,{});
 await assert.rejects(assertRecommendationContractReady(null,{ORIGEN_RECOMMENDATIONS:'true'}),/migration_required/);
 await assert.rejects(assertRecommendationContractReady(null,{ORIGEN_RECOMMENDATION_EVALUATION:'true'}),/migration_required/);
});
test('scoped source resolution uses existing records without copying prose, recording events or changing actions',db,async t=>{
 const f=await recommendationFixture(t),before=await f.plans(),staffBefore=await f.staff({action:'read',id:f.request.id});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_receipts')).rows[0].n,0);
 const action=await f.resolve(),response=await f.resolve(f.responseSource);
 for(const r of [action,response]){assert.equal(r.status,'current');assert.equal(r.contractVersion,1);assert.equal(r.policyVersion,RECOMMENDATION_POLICY_VERSION);assert.match(r.sourceRevision,/^[a-f0-9]{64}$/);assert.deepEqual(r.authority,recommendationContract.authority);assert.deepEqual(r.scope.campus,{state:'unknown',id:null});assert.equal(r.scope.term.value,null);}
 assert.equal(action.scope.organizationId,null);assert.equal(response.scope.organizationId,f.org);
 assert.doesNotMatch(JSON.stringify([action,response]),/PRIVATE_|Ask the insurance|Check with the campus/);
 assert.deepEqual(await f.plans(),before);assert.deepEqual(await f.staff({action:'read',id:f.request.id}),staffBefore);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_previews')).rows[0].n,0,'source reads do not create temporary approval previews');
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_plan_recommendations')).rows[0].n,0,'source reads do not create accepted provenance');
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_receipts')).rows[0].n,0,'source reads do not create evaluation receipts');
 assert.equal((await f.resolve(syntheticRecommendationCandidate().source)).status,'unavailable');
 f.env.ORIGEN_RECOMMENDATIONS='false';await assert.rejects(f.resolve(),{status:503});assert.deepEqual(await f.plans(),before);
});
test('source reads reject wrong owner, student, organization and stale versions without exposing current alternatives',db,async t=>{
 const f=await recommendationFixture(t);
 for(const actor of ['reader','staff','colleague'])assert.deepEqual(await f.resolve(f.actionSource,{},actor),{status:'unavailable'});
 for(const source of [{...f.actionSource,planId:randomUUID()},{...f.actionSource,stepId:'missing'},{...f.actionSource,planVersion:2},{...f.responseSource,responseVersion:2},{...f.responseSource,organizationId:randomUUID()}])assert.deepEqual(await f.resolve(source),{status:'unavailable'});
 assert.deepEqual(await f.resolve(f.actionSource,{studentId:'sam'}),{status:'unavailable'});
 const operator=await runOperatorReport(()=>f.db.query('SELECT origen_recommendation_source_command($1::jsonb) AS result',[JSON.stringify(f.command())]));assert.equal(operator.rows[0].result.error,'recommendation_denied');
 await assert.rejects(f.maintenance.query('SELECT origen_recommendation_source_command($1::jsonb)',[JSON.stringify(f.command())]),{code:'42501'});
});
test('SQL and application validators reject invented approval, writers, alternate purposes and unsupported source fields',db,async t=>{
 const f=await recommendationFixture(t),valid=f.command();
 for(const extra of [{confirmed:true},{action:'accept'},{action:'publish'},{action:'evaluate'},{purpose:'service_quality'},{purpose:'recommendation_evaluation'},{contractVersion:2},{source:{...f.actionSource,approved:true}},{source:{kind:'summary',id:randomUUID()}},{source:{...f.actionSource,planVersion:1.5}},{source:{...f.actionSource,planVersion:'1'}},{source:{...f.responseSource,organizationId:null}},{studentId:null}]){
  const bad={...valid,...extra};assert.throws(()=>validateRecommendationCommand(bad),{status:400});assert.equal((await f.sql(bad)).error,'invalid_recommendation_contract');
 }
 f.env.ORIGEN_OUTCOME_EVALUATION='true';assert.equal((await f.resolve()).authority.canEvaluate,false);
});
test('source edits, role changes and deletion invalidate reads while independent accepted actions survive source loss',db,async t=>{
 const f=await recommendationFixture(t),before=await f.plans();await f.reply(1);
 assert.deepEqual(await f.resolve(f.responseSource),{status:'unavailable'});assert.equal((await f.resolve()).status,'current');
 assert.equal((await f.plans()).plans[0].steps[0].action,before.plans[0].steps[0].action);
 await f.edit(plan=>({...plan,title:'A revised private action'}));assert.deepEqual(await f.resolve(),{status:'unavailable'});
 const current={...f.actionSource,planVersion:(await f.plans()).plans[0].version};assert.equal((await f.resolve(current)).status,'current');
 await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);assert.deepEqual(await f.resolve(current),{status:'unavailable'});
 await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[f.account]);
 await f.owner.query('DELETE FROM origen_plans WHERE account_id=$1 AND id=$2',[f.account,f.plan.id]);assert.deepEqual(await f.resolve(current),{status:'unavailable'});
});
test('foundation migration and execute grants are verified even with both rollout flags off',db,async t=>{
 const f=await recommendationFixture(t);await assertRecommendationContractReady(f.runtime,f.env);
 const r=await checkCoordinatorDatabase(f.runtime,f.maintenance,{schema:f.schema,env:{}});assert.equal(r.passed,true,JSON.stringify(r.checks));assert.ok(r.checks.some(c=>c.id==='recommendation-contract'&&c.passed));
 assert.equal(r.flags.ORIGEN_RECOMMENDATIONS,false);assert.equal(r.flags.ORIGEN_RECOMMENDATION_EVALUATION,false);
 await f.owner.query('GRANT EXECUTE ON FUNCTION origen_recommendation_source_command(jsonb) TO PUBLIC');
 await assert.rejects(assertRecommendationContractReady(f.runtime,f.env),/isolation_required/);
 await f.owner.query('REVOKE EXECUTE ON FUNCTION origen_recommendation_source_command(jsonb) FROM PUBLIC');
 const role=(await f.runtime.query('SELECT current_user AS role')).rows[0].role;
 await f.owner.query('REVOKE EXECUTE ON FUNCTION origen_recommendation_source_command(jsonb) FROM "'+role.replaceAll('"','""')+'"');
 await assert.rejects(assertRecommendationContractReady(f.runtime,f.env),/migration_required/);
});
test('paused SQL and restored response generations cannot reuse an old source receipt',db,async t=>{
 const f=await recommendationFixture(t);
 const paused=await f.as('other',()=>f.db.query('SELECT origen_recommendation_source_command($1::jsonb) AS result',[JSON.stringify(f.command())]));assert.equal(paused.rows[0].result.error,'recommendation_paused');
 const before=await f.resolve(f.responseSource);await f.owner.query('SELECT origen_review_response_context_after_restore()');
 const after=await f.resolve(f.responseSource);assert.equal(after.status,'current');assert.notEqual(after.sourceRevision,before.sourceRevision);assert.equal(after.authority.canAccept,false);
 await f.owner.query('DELETE FROM origen_accounts WHERE id=$1',[f.account]);await assert.rejects(f.resolve(),{status:403,message:'account_closed'});
});

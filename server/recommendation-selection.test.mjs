import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionLibraryFixture,institutionalTemplate} from './fixtures/recommendation-library.mjs';
import {outcomeAssessmentFixture} from './fixtures/outcome-assessment.mjs';
import {actionTemplateDrafts} from '../src/recommendationLibrary.mjs';
import {createRecommendationSelector,createRecommendationVerifier,assembleRecommendationContext,recommendationOutcomeFacts} from './recommendation-selection.mjs';
import {assertRecommendationContractReady} from './recommendation-contract.mjs';
import {recommendationExplanation,selectionDigest} from './recommendation-policy.mjs';
const db={skip:!process.env.DATABASE_TEST_URL};
const request=(extra={})=>({studentId:'alex',language:'en',intent:'next_action',goal:'understand_requirement',process:'office_contact',focus:null,episodes:[],timeZone:'America/Chicago',...extra});
const interaction=r=>({trigger:'student_request',role:'student',targetConfirmed:true,studentId:r.studentId,intent:r.intent,goal:r.goal,process:r.process,focus:r.focus});
const choose=(f,r=request(),extra={},actor='other')=>f.as(actor,()=>createRecommendationSelector(f.db,f.env)(actor,r,{interaction:interaction(r),...extra}));
const focus=f=>({kind:'accepted-action',planId:f.plan.id,stepId:'accepted',planVersion:f.plan.version});
async function seedCatalog(f){await f.grant();const rows=[];for(const draft of actionTemplateDrafts()){const row=await f.create(draft.content);await f.publish(row.id,1);rows.push(row);}return rows;}
async function raw(f,r=request(),actor='other'){
 const command={studentId:r.studentId,intent:r.intent,goal:r.goal,process:r.process,focus:r.focus,episodes:r.episodes};
 return f.as(actor,async()=>{const c=await f.db.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('origen.recommendations','true',true),set_config('origen.recommendation_outcomes','true',true)");const result=(await c.query('SELECT origen_recommendation_selection_inputs($1::jsonb) AS result',[JSON.stringify(command)])).rows[0].result;await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}});
}
const afterFirstRead=(database,callback,at=1)=>({connect:async()=>{const c=await database.connect();let calls=0;return new Proxy(c,{get(target,key){if(key==='query')return async(...args)=>{const r=await target.query(...args);if(args[0].startsWith('SELECT origen_recommendation_selection_inputs')&&++calls===at)await callback();return r;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});}});

test('bounded source resolver selects reviewed cold-start guidance in either language without changing student records',db,async t=>{
 const f=await actionLibraryFixture(t),rows=await seedCatalog(f),before=await f.plans(),followUp=await f.load();
 assert.equal((await raw(f)).status,'current');
 for(const language of ['en','es']){
  const result=await choose(f,request({language}));assert.equal(result.decision.status,'recommended');assert.equal(result.decision.candidate.source.teachingId,rows[0].id);assert.equal(result.decision.reason,'current_goal');assert.equal(result.guard.policyVersion,'evidence-informed-v1');assert.match(result.guard.revision,/^[a-f0-9]{64}$/);assert.equal(result.guard.requestRevision,selectionDigest(request({language})));
  assert.equal(result.decision.candidate.scope.campus.state,'unknown');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|insurance office which proof|caused_success|successProbability/);assert.ok(recommendationExplanation(result,language));
 }
 assert.deepEqual(await f.plans(),before);assert.deepEqual(await f.load(),followUp);
 assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_conversation_openings')).rows[0].n,0);
 const waiting=await choose(f,request({goal:'prepare_document',process:'aid_documents'}));assert.equal(waiting.decision.status,'clarification_required');assert.equal(waiting.clarification.code,'document_requested');
});
test('only an exact selected accepted action is revisited; completion, deferral and lost source versions invalidate use',db,async t=>{
 const f=await actionLibraryFixture(t),r=request({intent:'revisit_action',focus:focus(f)});
 assert.equal((await raw(f,r)).status,'current');
 let result=await choose(f,r);assert.equal(result.decision.status,'recommended');assert.equal(result.decision.reason,'accepted_work');assert.match(result.decision.candidate.action.en,/Ask the insurance office which proof is accepted/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PLAN_NOT_SHARED|Private unrelated action/);
 await f.staff({action:'withdraw-response',id:f.request.id,publicationId:f.request.publication.id,version:1,operationId:randomUUID()});result=await choose(f,r);assert.equal(result.decision.status,'recommended','independent accepted wording survives advice withdrawal');
 for(const status of ['deferred','complete']){
  const edited=await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='accepted'?{...s,status}:s)}));
  assert.equal((await choose(f,r)).decision.reason,'source_unavailable');r.focus.planVersion=edited.version;
  assert.equal((await choose(f,r)).decision.status,'no_applicable_candidate');
 }
});
test('coordinator suggestions remain named advice and cannot repeat an accepted or deferred suggestion',db,async t=>{
 const f=await actionLibraryFixture(t),r=request({intent:'revisit_action',focus:{...f.source,organizationId:f.org}});
 assert.equal((await choose(f,r)).decision.status,'no_applicable_candidate','the existing accepted action suppresses a fresh suggestion');
 await f.owner.query('DELETE FROM origen_review_response_plan_links WHERE account_id=$1',[f.account]);
 const result=await choose(f,r);assert.equal(result.decision.status,'recommended');assert.equal(result.decision.candidate.source.kind,'review-response');assert.match(result.decision.candidate.action.en,/suggested:/);assert.match(result.decision.candidate.explanation.en,/not an accepted action/);
 const choice=await f.httpCall('other','/api/review-response-choices',{action:'defer',studentId:'alex',source:f.source,revision:0,reviewOn:null,operationId:randomUUID()});assert.ok(choice);
 assert.notEqual((await choose(f,r)).decision.status,'recommended');
});
test('campus labels and exact policy URLs never become verified student applicability',db,async t=>{
 const f=await actionLibraryFixture(t);await f.grant();const row=await f.create(institutionalTemplate());await f.publish(row.id,1);
 const snapshot=await raw(f);assert.equal(snapshot.status,'current');assert.deepEqual(snapshot.inputs.templates,[]);assert.equal(snapshot.inputs.requiresScope,true);
 const result=await choose(f);assert.equal(result.decision.status,'clarification_required');assert.equal(result.clarification.code,'campus_confirmed');assert.doesNotMatch(JSON.stringify(result),/Fictional North Campus|example.edu/);
 await assert.rejects(choose(f,{...request(),campus:{name:'Fictional North Campus',officialHost:'example.edu'},term:'Fall 2026'}),{status:400});
 const general=await f.create();await f.publish(general.id,1);assert.equal((await choose(f)).decision.candidate.source.teachingId,general.id);
});
test('canonical duplicate action states suppress matching templates without using text as an outcome link',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);const wording=actionTemplateDrafts()[0].content.action;
 for(const [language,status] of [['en','not-started'],['es','complete'],['en','deferred']]){
  await f.edit(p=>({...p,steps:p.steps.map(s=>s.id==='sibling'?{...s,action:'  '+wording[language].toUpperCase()+'  ',status}:s)}));
  const result=await choose(f);assert.equal(result.decision.status,'no_applicable_candidate');assert.ok(result.trace.excluded.some(e=>e.reason==='existing_action'));
 }
});
test('wrong account, student, organization, invented proof and paused flags cannot resolve recommendations',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);
 assert.equal((await choose(f,request(),{},'reader')).decision.status,'unavailable');assert.equal((await choose(f,request({studentId:'not-owned'}))).decision.status,'unavailable');
 const r=request({intent:'revisit_action',focus:{...f.source,organizationId:randomUUID()}});assert.equal((await choose(f,r)).decision.status,'unavailable');
 await assert.rejects(choose(f,{...request(),facts:{document_requested:'yes'}}),{status:400});
 f.env.ORIGEN_RECOMMENDATIONS='false';assert.equal((await choose(f)).decision.reason,'paused');
 f.env.ORIGEN_RECOMMENDATIONS='true';f.env.ORIGEN_RECOMMENDATION_EVALUATION='false';f.env.ORIGEN_OUTCOME_EVALUATION='false';assert.equal((await choose(f)).decision.status,'recommended');
 await f.owner.query('GRANT EXECUTE ON FUNCTION origen_recommendation_selection_inputs(jsonb) TO PUBLIC');await assert.rejects(assertRecommendationContractReady(f.runtime,f.env),/selection_isolation_required/);
});
test('a second source read catches revocation, competing publications and source corrections before returning a decision',db,async t=>{
 const f=await actionLibraryFixture(t),rows=await seedCatalog(f),r=request();let reads=0;
 const database=afterFirstRead(f.db,async()=>{reads++;await f.admin({action:'revoke',id:rows[0].id,revision:2});});
 const result=await f.as('other',()=>createRecommendationSelector(database,f.env)('other',r,{interaction:interaction(r)}));assert.equal(reads,1);assert.equal(result.decision.reason,'source_unavailable');assert.equal(result.decision.candidate,null);assert.equal(result.trace,null);
 await f.publish(rows[0].id,3);
 const competing=afterFirstRead(f.db,async()=>{const row=await f.create({...actionTemplateDrafts()[0].content,action:{en:'Ask how to contact the office by appointment.',es:'Pregunta cómo contactar a la oficina con una cita.'}});await f.publish(row.id,1);});
 assert.equal((await f.as('other',()=>createRecommendationSelector(competing,f.env)('other',r,{interaction:interaction(r)}))).decision.reason,'source_unavailable');
 assert.equal((await choose(f)).decision.reason,'ambiguous_action');
});
test('student-approved outcome links establish only attributed claims and preserve missing prerequisites',db,async t=>{
 const base=await outcomeAssessmentFixture(t),f=await actionLibraryFixture(t,{base});await seedCatalog(f);
 await f.record({definitionId:'document_submitted',status:'occurred'});await f.record({definitionId:'decision_received',status:'pending'});
 const episodes=(await f.owner.query('SELECT id,version FROM origen_outcome_episodes WHERE account_id=$1 ORDER BY id',[f.account])).rows;
 const r=request({goal:'check_decision',process:'insurance_waiver',focus:focus(f),episodes});
 const snapshot=await raw(f,r);assert.equal(snapshot.status,'current');
 const context=assembleRecommendationContext(r,snapshot);assert.equal(context.facts.submission_reported,'yes');assert.equal(context.facts.decision_pending,'yes');assert.equal(context.facts.document_prepared,'unknown');assert.equal(context.facts.document_requested,'unknown');assert.equal(context.scope.campus.state,'unknown');assert.equal(context.scope.term.state,'unknown');
 const result=await choose(f,r);assert.equal(result.decision.status,'recommended');assert.equal(result.decision.reason,'relevant_prerequisite');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|Example University|employer letter|Insurance documents/);
 const submitted=await choose(f,{...r,goal:'submit_document',process:'aid_documents'});assert.equal(submitted.decision.status,'no_applicable_candidate');
 const prepared=await choose(f,{...r,goal:'prepare_document',process:'aid_documents'});assert.equal(prepared.clarification.code,'document_requested');
 const changed={...r,episodes:[{...episodes[0],version:999}]};assert.equal((await choose(f,changed)).decision.reason,'source_unavailable');
 f.env.ORIGEN_OUTCOME_EVIDENCE='false';assert.equal((await choose(f,r)).decision.reason,'source_unavailable');f.env.ORIGEN_OUTCOME_EVIDENCE='true';
 const old=structuredClone(snapshot.inputs.outcomes);for(const e of old.evidence)e.recorded_at=new Date(Date.now()-8*86400000).toISOString();assert.equal(recommendationOutcomeFacts(old).facts.decision_pending,'unknown');
 const corrected=afterFirstRead(f.db,()=>f.owner.query("UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='report_changed' WHERE account_id=$1",[f.account]));
 assert.equal((await f.as('other',()=>createRecommendationSelector(corrected,f.env)('other',r,{interaction:interaction(r)}))).decision.reason,'source_unavailable');
});
test('different declared outcome scopes and contradictory reports cannot be silently combined',db,async t=>{
 const base=await outcomeAssessmentFixture(t),f=await actionLibraryFixture(t,{base});await seedCatalog(f);
 await f.record({definitionId:'document_submitted',status:'occurred',cycle:'First request'});await f.record({definitionId:'decision_received',status:'pending',cycle:'Other request'});
 const episodes=(await f.owner.query('SELECT id,version FROM origen_outcome_episodes WHERE account_id=$1 ORDER BY id',[f.account])).rows;
 const r=request({goal:'check_decision',process:'insurance_waiver',focus:focus(f),episodes});assert.equal((await choose(f,r)).decision.reason,'conflicting_evidence');
});
test('candidate and duplicate limits fail closed; priority checks perform no database query',db,async t=>{
 const f=await actionLibraryFixture(t);await f.grant();const row=await f.create();await f.publish(row.id,1);
 await f.owner.query(`WITH ids AS (SELECT gen_random_uuid() AS id FROM generate_series(1,50)), teachings AS (
 INSERT INTO origen_teachings(id,revision,draft,published,published_revision,published_at) SELECT ids.id,t.revision,t.draft,t.published,t.published_revision,t.published_at FROM ids CROSS JOIN origen_teachings t WHERE t.id=$1 RETURNING id)
 INSERT INTO origen_recommendation_templates(teaching_id,revision,draft,published,published_revision,teaching_revision,publisher_hash,publisher_revision,published_at)
 SELECT teachings.id,r.revision,r.draft,r.published,r.published_revision,r.teaching_revision,r.publisher_hash,r.publisher_revision,r.published_at FROM teachings CROSS JOIN origen_recommendation_templates r WHERE r.teaching_id=$1`,[row.id]);
 assert.equal((await choose(f)).decision.reason,'limit_exceeded');
 const r=request();let connected=0;const noQueries=createRecommendationSelector({connect:async()=>{connected++;throw Error('should not query');}},f.env);
 assert.equal((await noQueries('other',r,{interaction:{...interaction(r),trigger:'opening',openingDecision:{opening:null}}})).decision.reason,'student_priority');assert.equal(connected,0);
 assert.equal((await noQueries('other',r,{interaction:interaction(r)})).decision.reason,'lookup_failed');assert.equal(connected,1);
});
test('aborted requests and mid-load flag changes return no stale candidate',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);const r=request(),abort=new AbortController();abort.abort();
 assert.equal((await choose(f,r,{signal:abort.signal})).decision.reason,'lookup_failed');
 const switched=afterFirstRead(f.db,async()=>{f.env.ORIGEN_RECOMMENDATIONS='false';});
 const result=await f.as('other',()=>createRecommendationSelector(switched,f.env)('other',r,{interaction:interaction(r)}));assert.equal(result.decision.reason,'paused');assert.equal(result.decision.candidate,null);
});
test('a new student priority during the final source read cancels the recommendation',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);const r=request(),current=interaction(r);
 const switched=afterFirstRead(f.db,async()=>{current.questionChanged=true;},2);
 const result=await f.as('other',()=>createRecommendationSelector(switched,f.env)('other',r,{interaction:current}));
 assert.equal(result.decision.reason,'student_priority');assert.equal(result.decision.candidate,null);assert.equal(result.guard,undefined);
});

test('freshness receipts require the same current request, source, policy, account and explicit interaction',db,async t=>{
 const f=await actionLibraryFixture(t),rows=await seedCatalog(f),r=request(),result=await choose(f,r);
 const verify=(input=r,guard=result.guard,options={},actor='other')=>f.as(actor,()=>createRecommendationVerifier(f.db,f.env)(actor,input,guard,{interaction:interaction(input),...options}));
 assert.equal((await verify()).status,'current');assert.equal((await verify({...r,goal:'check_decision'})).status,'unavailable');
 for(const change of [{expiresAt:'2000-01-01T00:00:00Z'},{expiresAt:'2099-01-01T00:00:00Z'},{policyVersion:'success-v9'},{accepted:true},{revision:'a'.repeat(64)}])assert.equal((await verify(r,{...result.guard,...change})).status,'unavailable');
 assert.equal((await verify(r,result.guard,{interaction:{...interaction(r),trigger:'opening'}})).status,'unavailable');assert.equal((await verify(r,result.guard,{},'reader')).status,'unavailable');
 await f.admin({action:'revoke',id:rows[0].id,revision:2});assert.equal((await verify()).status,'unavailable');
});
test('too many existing actions cannot produce a recommendation from a truncated duplicate check',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);
 await f.owner.query("INSERT INTO origen_plan_steps(account_id,plan_id,id,position,title,action,status) SELECT $1,$2,'extra-'||n,n+10,'Synthetic action','Synthetic existing action '||n,'not-started' FROM generate_series(1,51) n",[f.account,f.plan.id]);
 assert.equal((await choose(f)).decision.reason,'limit_exceeded');
});
test('privacy restore invalidates a previously issued freshness receipt',db,async t=>{
 const f=await actionLibraryFixture(t);await seedCatalog(f);const r=request(),result=await choose(f,r);
 assert.equal(result.decision.status,'recommended');await f.owner.query('SELECT origen_recommendation_library_after_restore()');
 const verified=await f.as('other',()=>createRecommendationVerifier(f.db,f.env)('other',r,result.guard,{interaction:interaction(r)}));
 assert.equal(verified.status,'unavailable');assert.equal((await choose(f)).decision.status,'no_applicable_candidate');
});
test('the whole-request budget also bounds a pool connection that never arrives',db,async t=>{
 const f=await actionLibraryFixture(t),r=request(),started=performance.now();let connections=0;
 const result=await createRecommendationSelector({connect:()=>{connections++;return new Promise(()=>{});}},f.env)('other',r,{interaction:interaction(r)});
 assert.equal(result.decision.reason,'lookup_failed');assert.equal(result.decision.candidate,null);assert.equal(connections,1);
 assert.ok(performance.now()-started<5500,'the request must return near the fixed four-second deadline');
});

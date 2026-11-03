import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionLibraryFixture} from './fixtures/recommendation-library.mjs';
import {createRecommendationDeliveryRepository} from './recommendation-delivery.mjs';
import {createLiveMemoryRepository} from './live-memory.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {recommendationSpeechIntent,recommendationSpeechRequest} from '../src/recommendationDelivery.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {outcomeReadback} from '../src/outcomeRecording.mjs';
import {actionTemplateDrafts} from '../src/recommendationLibrary.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const answers={document_requested:'unknown',document_prepared:'unknown',submission_reported:'unknown',decision_pending:'unknown'};
const request=(extra={})=>({language:'en',intent:'next_action',goal:'understand_requirement',process:'office_contact',focus:null,episodes:[],timeZone:'America/Chicago',...extra});
async function fixture(t){
 const f=await actionLibraryFixture(t);await f.grant();const row=await f.create();await f.publish(row.id,1);
 const run=(body,actor='other',voice=false)=>f.as(actor,()=>createRecommendationDeliveryRepository(f.db,f.env)(actor,voice?body:{studentId:'alex',...body},voice));
 const choose=(extra={},a=answers)=>run({action:'select',request:request(extra),answers:a});
 const confirm=p=>run({action:'confirm',id:p.id,confirmed:true});
 const memory=input=>f.as('other',()=>createLiveMemoryRepository(f.db,f.env)('other',input));
 const session=async()=>memory({action:'open',studentId:'alex',revision:(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0]?.revision||0});
 const turn=async(s,sequence,transcript,language='en')=>{const e={sessionId:s.id,sequence,turnId:randomUUID(),transcript};await memory({action:'turn',...e,language});return e;};
 const voice=(e,body)=>run({...e,...body},'other',true);
 return {...f,run,choose,confirm,session,turn,voice,memory,row};
}
test('spoken intent and both provider contracts exclude invented approval and proactive recommendation',()=>{
 assert.equal(recommendationSpeechIntent('What next step should I take to contact the office?'),'select');assert.equal(recommendationSpeechIntent('¿Qué próximo paso puedo tomar para contactar a la oficina?'),'select');
 for(const s of ['Yes.','Sí.','Yes, save it but change the words.','I called the office.'])assert.notEqual(recommendationSpeechIntent(s),'approve');
 assert.equal(recommendationSpeechIntent('Yes, save it.'),'approve');assert.equal(recommendationSpeechIntent('Sí, guárdalo.'),'approve');
 assert.equal(recommendationSpeechIntent('Do not save this step.'),'dismiss');assert.equal(recommendationSpeechRequest('I need aid.'),null);
 const input={mode:'finance',role:'student',language:'en',studentId:'alex',recommendationVoice:true,liveMemoryEnabled:true};
 const real=voiceSession(input,{}),live=studentLiveSession(real,input);assert.ok(real.tools.some(t=>t.name==='suggest_next_action'));assert.match(real.instructions,/Never send recommendation wording/);assert.match(live.instructions,/student-requested recommendation/);
 for(const patch of [{recommendationVoice:false},{role:'parent'},{onboarding:true},{liveMemoryWriteEnabled:false},{liveMemoryEnabled:false}])assert.equal(voiceSession({...input,...patch},{}).tools.some(t=>t.name==='suggest_next_action'),false);
});
for(const language of ['en','es'])test(`binder ${language}: exact acceptance creates one canonical action and provenance with no follow-up or sharing`,db,async t=>{
 const f=await fixture(t),before=await f.plans(),follow=await f.load(),p=await f.choose({language});assert.equal(p.status,'recommended');assert.equal((await f.plans()).plans.length,before.plans.length);
 await assert.rejects(f.run({action:'confirm',id:p.id,confirmed:false}),{status:400});
 const saved=await f.confirm(p);assert.equal(saved.status,'saved');assert.deepEqual(await f.confirm(p),{status:'saved',target:saved.target,recommendationId:saved.recommendationId});
 const plans=await f.plans(),action=plans.plans.find(x=>x.id===saved.target.planId).steps[0];assert.equal(action.action,p.action);assert.equal(action.status,'not-started');assert.equal(action.recommendationSource.id,p.id);assert.equal(action.recommendationSource.availability,'current');assert.deepEqual(await f.load(),follow);assert.equal(plans.plans.length,before.plans.length+1);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_previews')).rows[0].n,0);
 assert.equal((await f.choose({language})).status,'no_applicable_candidate');
});
test('source revocation, competing publication, expiry and forged preview cannot accept stale guidance',db,async t=>{
 const f=await fixture(t),p=await f.choose();await f.admin({action:'revoke',id:f.row.id,revision:2});await assert.rejects(f.confirm(p),/source_changed/);
 await assert.rejects(f.run({action:'confirm',id:randomUUID(),confirmed:true}),/preview_changed/);
 await f.publish(f.row.id,3);const fresh=await f.choose();assert.equal(fresh.status,'recommended');await f.owner.query("UPDATE origen_recommendation_previews SET expires_at=now()-interval '1 second'");await assert.rejects(f.confirm(fresh),/preview_changed/);
});
test('decline, new goal, wrong student and extra authority arguments cannot reuse an old selection',db,async t=>{
 const f=await fixture(t),p=await f.choose();assert.equal((await f.run({action:'cancel',id:p.id})).status,'dismissed');await assert.rejects(f.confirm(p),/preview_changed/);
 const other=await f.choose();assert.equal((await f.choose({goal:'prepare_document'})).status,'no_applicable_candidate');await assert.rejects(f.confirm(other),/preview_changed/);
 await assert.rejects(f.run({action:'select',request:request(),answers},'reader'),{status:403});
 await assert.rejects(f.run({action:'select',request:request(),answers,confirmed:true}),{status:400});
});
test('expired approval is rejected even when bounded cleanup leaves a backlog',db,async t=>{
 const f=await fixture(t),p=await f.choose();
 await f.owner.query("INSERT INTO origen_students(account_id,id,name) SELECT $1,'expiry-'||n,'Synthetic expiry fixture' FROM generate_series(1,1001) n",[f.account]);
 await f.owner.query("INSERT INTO origen_recommendation_previews(account_id,id,student_id,request,reported_facts,guard,source,source_revision,action_hash,expires_at) SELECT account_id,gen_random_uuid(),'expiry-'||n,request,reported_facts,guard,source,source_revision,action_hash,now()-interval '1 day' FROM origen_recommendation_previews CROSS JOIN generate_series(1,1001) n WHERE account_id=$1 AND id=$2",[f.account,p.id]);
 await f.owner.query("UPDATE origen_recommendation_previews SET expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2",[f.account,p.id]);
 await assert.rejects(f.confirm(p),/preview_changed/);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_plan_recommendations')).rows[0].n,0);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_previews WHERE account_id=$1 AND id=$2',[f.account,p.id])).rows[0].n,1,'rejection does not depend on physical deletion');
});
test('independent accepted wording and provenance survive source withdrawal and action edits',db,async t=>{
 const f=await fixture(t),p=await f.choose(),saved=await f.confirm(p);await f.admin({action:'revoke',id:f.row.id,revision:2});
 let plan=(await f.plans()).plans.find(p=>p.id===saved.target.planId);assert.equal(plan.steps[0].recommendationSource.availability,'historical');assert.equal(plan.steps[0].action,p.action);
 plan.steps[0].action='My own revised action';await f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan({action:'update',id:plan.id,version:plan.version,plan})));
 plan=(await f.plans()).plans.find(p=>p.id===plan.id);assert.equal(plan.steps[0].recommendationSource.wordingChanged,true);
 const revisited=await f.choose({intent:'revisit_action',focus:{kind:'accepted-action',planId:plan.id,stepId:plan.steps[0].id,planVersion:plan.version}});assert.equal(revisited.canAccept,false);assert.match(revisited.action,/My own revised action/);
 f.env.ORIGEN_RECOMMENDATIONS='false';assert.equal((await f.run({action:'receipt',id:p.id})).status,'saved');await assert.rejects(f.confirm(revisited),{status:503});
});
test('coordinator recommendation acceptance keeps the exact response relationship',db,async t=>{
 const f=await fixture(t);await f.owner.query('DELETE FROM origen_review_response_plan_links WHERE account_id=$1',[f.account]);const p=await f.choose({intent:'revisit_action',focus:f.source});assert.equal(p.status,'recommended');assert.equal(p.source.kind,'review-response');
 const saved=await f.confirm(p),plan=(await f.plans()).plans.find(p=>p.id===saved.target.planId);assert.equal(plan.steps[0].responseSource.source.requestId,f.source.requestId);assert.equal(plan.steps[0].recommendationSource.id,p.id);
});
for(const language of ['en','es'])test(`accepted recommendation ${language}: spoken action wording identifies the private follow-up without a generic title`,db,async t=>{
 const f=await fixture(t);await f.owner.query('DELETE FROM origen_review_response_plan_links WHERE account_id=$1',[f.account]);
 const selected=await f.choose({language,intent:'revisit_action',focus:f.source}),saved=await f.confirm(selected),session=await f.session();
 const transcript=language==='es'?`Guarda una actualización privada sobre ${selected.action}: Llamé a la oficina.`:`Save a private update about ${selected.action}: I called the office.`;
 const evidence=await f.turn(session,1,transcript,language);
 const prepared=await f.httpCall('other','/api/student-follow-up-voice',{...evidence,action:'prepare',kind:'report',target:saved.target,operationId:randomUUID(),timeZone:'UTC',payload:{report:{responseState:'answered',reportedAction:'attempted',reportedOutcome:'pending',detail:language==='es'?'Llamé a la oficina.':'I called the office.',helpfulness:null,occurredOn:null,timeZone:'UTC'},planStatus:null}});
 assert.equal(prepared.status,'readback_required');assert.ok(prepared.readback.includes(selected.action));
 assert.equal((await f.httpCall('other','/api/student-follow-up',{action:'load',studentId:'alex',target:saved.target})).reports.length,0,'Identifying a step still requires the separate readback/approval before saving.');
});
for(const language of ['en','es'])test(`voice ${language}: full audible readback and immediately next approval use the same canonical writer`,db,async t=>{
 const f=await fixture(t),s=await f.session(),first=await f.turn(s,1,language==='en'?'What next step should I take to contact the office?':'¿Qué próximo paso puedo tomar para contactar a la oficina?',language);
 const selected=await f.voice(first,{action:'select',timeZone:'America/Chicago'});assert.equal(selected.status,'recommended');
 const second=await f.turn(s,2,language==='en'?'Save this step.':'Guarda este paso.',language),preview=await f.voice(second,{action:'prepare'});assert.equal(preview.status,'readback_required');
 await f.voice(second,{action:'present',presentation:preview.readback});const third=await f.turn(s,3,language==='en'?'Yes, save it.':'Sí, guárdalo.',language);
 const result=await f.voice(third,{action:'confirm'});assert.equal(result.status,'saved');const plan=(await f.plans()).plans.find(p=>p.id===result.target.planId);assert.equal(plan.steps[0].action,selected.action);
});
test('unheard, partial and late voice approvals cannot save; tool arguments cannot supply consent',db,async t=>{
 const f=await fixture(t),s=await f.session(),first=await f.turn(s,1,'What next step should I take to contact the office?');await f.voice(first,{action:'select',timeZone:'America/Chicago'});
 const second=await f.turn(s,2,'Save this step.'),preview=await f.voice(second,{action:'prepare'});await f.voice(second,{action:'present',presentation:preview.readback.slice(0,80)});
 const third=await f.turn(s,3,'Yes, save it.');await assert.rejects(f.voice(third,{action:'confirm'}),/approval_required/);
 await assert.rejects(f.voice(third,{action:'confirm',accepted:true}),{status:400});
 const fourth=await f.turn(s,4,'Yes, save it.');await assert.rejects(f.voice(fourth,{action:'confirm'}),/approval_required/);
});
test('restore clears unaccepted approvals and raw runtime access remains denied',db,async t=>{
 const f=await fixture(t),p=await f.choose();await f.owner.query('SELECT origen_recommendation_acceptance_after_restore()');await assert.rejects(f.confirm(p),/preview_changed/);
 for(const table of ['origen_recommendation_previews','origen_plan_recommendations'])await assert.rejects(f.runtime.query(`SELECT * FROM ${table}`),/permission denied/);
 await assert.rejects(f.runtime.query('SELECT origen_recommendation_acceptance_after_restore()'),/permission denied/);
});
test('concurrent confirmations create a single canonical action and receipt',db,async t=>{
 const f=await fixture(t),preview=await f.choose(),results=await Promise.all([f.confirm(preview),f.confirm(preview)]);assert.equal(results[0].status,'saved');assert.equal(results[1].status,'saved');assert.deepEqual(results[0].target,results[1].target);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_plan_recommendations')).rows[0].n,1);
});
test('structured student answers resolve one prerequisite without granting institutional authority',db,async t=>{
 const f=await fixture(t),row=await f.create(actionTemplateDrafts()[1].content);await f.publish(row.id,1);
 const missing=await f.choose({goal:'prepare_document',process:'aid_documents'});assert.equal(missing.questionKey,'document_requested');
 const selected=await f.choose({goal:'prepare_document',process:'aid_documents'},{...answers,document_requested:'yes'});assert.equal(selected.status,'recommended');assert.equal(selected.source.teachingId,row.id);
 await assert.rejects(f.choose({goal:'prepare_document',process:'aid_documents'},{...answers,officialVerified:true}),{status:400});
});
test('active recommendation cannot be saved through the generic voice next-step tool',db,async t=>{
 const f=await fixture(t),s=await f.session(),first=await f.turn(s,1,'What next step should I take to contact the office?'),selected=await f.voice(first,{action:'select',timeZone:'America/Chicago'});
 const second=await f.turn(s,2,'Save this step.');await assert.rejects(f.memory({action:'write',...second,requestId:randomUUID(),change:{kind:'next-step',content:selected.action,category:'education'}}),/recommendation_approval_required/);
});
test('student-approved outcome preview binds exact recommendation provenance without an inferred or shared link',db,async t=>{
 const f=await fixture(t);f.env.ORIGEN_OUTCOME_EVIDENCE='true';await f.owner.query('DELETE FROM origen_review_response_plan_links WHERE account_id=$1',[f.account]);
 const selected=await f.choose({intent:'revisit_action',focus:f.source}),saved=await f.confirm(selected),target=saved.target;
 const reportPreview=(await f.httpCall('other','/api/student-follow-up-report',{action:'prepare',studentId:'alex',target,operationId:randomUUID(),planVersion:1,language:'en',payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:'I submitted the requested letter.',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'},planStatus:null}})).preview;
 const report=await f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:reportPreview.id,digest:reportPreview.digest,confirmed:true});
 const payload={link:{episode:{definitionId:'document_submitted',definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle:'Documents'},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'}},report:{id:report.reportId,version:1},responseState:'answered',claimStatus:'occurred',decision:null},correction:null,replaces:null};
 const prepare=extra=>f.httpCall('other','/api/outcome-evidence',{action:'prepare',studentId:'alex',target,operationId:randomUUID(),planVersion:1,language:'en',payload,...extra});
 const legacy=(await prepare({})).preview;assert.equal(legacy.payload.recommendation,undefined);
 await f.httpCall('other','/api/outcome-evidence',{action:'confirm',studentId:'alex',previewId:legacy.id,digest:legacy.digest,confirmed:true});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_recommendation_links')).rows[0].n,0,'older clients do not silently authorize the new relationship');
 payload.link.episode.scope.cycle='Explicitly linked documents';
 const preview=(await prepare({recommendationProtocol:'recommendation-provenance-v1'})).preview;assert.equal(preview.payload.recommendation.id,selected.id);assert.match(outcomeReadback(preview,'en'),/does not prove/);assert.match(outcomeReadback(preview,'es'),/no prueba/);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_recommendation_links')).rows[0].n,0);
 const result=await f.httpCall('other','/api/outcome-evidence',{action:'confirm',studentId:'alex',previewId:preview.id,digest:preview.digest,confirmed:true});
 const link=(await f.owner.query('SELECT * FROM origen_outcome_recommendation_links WHERE account_id=$1',[f.account])).rows[0];assert.equal(link.episode_id,result.episodeId);assert.equal(link.recommendation_id,selected.id);assert.equal(link.episode_version,1);
 const exported=await f.as('other',async()=>(await f.db.query('SELECT origen_recommendation_outcomes_export() AS links')).rows[0].links);assert.equal(exported.length,1);assert.equal(exported[0].current,true);
 await f.owner.query("UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='report_changed' WHERE account_id=$1",[f.account]);const changed=await f.as('other',async()=>(await f.db.query('SELECT origen_recommendation_outcomes_export() AS links')).rows[0].links);assert.equal(changed[0].current,false);
 await f.owner.query('SELECT origen_recommendation_acceptance_after_restore()');assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_recommendation_links')).rows[0].n,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assessOutcome,assessOutcomeContext,assessCoordinatorObservation,OUTCOME_ASSESSMENT_RULE_VERSION} from './outcome-assessment.mjs';
import {outcomeDefinition} from '../src/outcomeEvidence.mjs';
import {observationPayload} from './fixtures/outcome-observations.mjs';
import {outcomeAssessmentFixture} from './fixtures/outcome-assessment.mjs';
const now=new Date('2026-11-02T12:00:00Z'),scope={institution:'Example University',term:'2026–2027',cycle:'Insurance documents'};
const evidence=(extra={})=>({reference:{kind:'student_report',id:'report-1',version:1},definitionId:'document_submitted',definitionVersion:1,scope,availability:'current',origin:'student_reported',basis:'student_account',responseState:'answered',claim:{status:'occurred',decision:null},eventOn:'2026-10-01',timeZone:'America/Chicago',recordedAt:'2026-11-01',statement:'A saved statement.',...extra});
const assess=(items,extra={})=>assessOutcome({subject:{kind:'private_episode',id:'episode',version:1},definitionId:'document_submitted',definitionVersion:1,scope,window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'},evidence:items,...extra},now);
const observation=(extra={})=>({id:'observation-1',version:1,status:'published',availability:'current',validUntil:'2027-01-01T00:00:00Z',author:{name:'Maria',organization:'Community Center'},adviceRelationship:'same_author',payload:observationPayload(),dispute:null,...extra});
test('deterministic assessment preserves each claim and refuses verification, causation and evaluation authority',()=>{
 for(const definitionId of ['office_contacted','document_submitted','document_accepted','decision_received','waiver_approved']){
  const result=assess([evidence({definitionId,claim:{status:'occurred',decision:definitionId==='decision_received'?'denied':null}})],{definitionId});
  assert.equal(result.ruleVersion,OUTCOME_ASSESSMENT_RULE_VERSION);assert.equal(result.state,'student_reported');assert.equal(result.institutionVerified,false);assert.equal(result.evaluationAllowed,false);assert.equal(result.independence,'not_established');assert.equal(result.supportedClaims.length,1);
  assert.ok(!('confidence'in result));assert.ok(result.reasonCodes.includes('no_causal_inference'));if(definitionId==='decision_received')assert.equal(result.supportedClaims[0].claim.decision,'denied');
 }
 assert.ok(assess([evidence()]).doesNotEstablish.includes('waiver_approved'));
 for(const status of ['pending','not_occurred','goal_changed'])assert.equal(assess([evidence({claim:{status,decision:null}})]).supportedClaims[0].claim.status,status);
 for(const responseState of ['declined','unknown']){const r=assess([evidence({responseState,claim:{status:null,decision:null},eventOn:null})]);assert.equal(r.state,'insufficient');assert.ok(r.reasonCodes.includes(responseState==='declined'?'student_declined':'student_unknown'));}
 assert.ok(assess([]).reasonCodes.includes('no_evidence'));assert.equal(assess([evidence({claim:{status:'unknown',decision:null}})]).state,'insufficient');
});
test('same-event contradictions, unknown timing and later events remain different; neither latest nor majority wins',()=>{
 const yes=evidence(),no=evidence({reference:{kind:'student_report',id:'report-2',version:1},claim:{status:'not_occurred',decision:null}});
 const conflict=assess([yes,no,yes]);assert.equal(conflict.state,'disputed');assert.equal(conflict.supportedClaims.length,0);assert.equal(conflict.evidence.length,2);assert.deepEqual(conflict,assess([no,yes]));
 const later=assess([yes,{...no,eventOn:'2026-10-02'}]);assert.equal(later.state,'multiple_events');assert.equal(later.supportedClaims.length,2);
 assert.equal(assess([yes,{...no,eventOn:null}]).state,'ambiguous');assert.equal(assess([yes,{...no,timeZone:'UTC'}]).state,'ambiguous');
 const different=assess([yes,{...no,scope:{...scope,term:'2027–2028'}}]);assert.equal(different.state,'student_reported');assert.equal(different.supportedClaims.length,1);assert.ok(different.reasonCodes.includes('different_or_missing_scope'));
 assert.equal(assess([yes,{...yes,statement:'An inconsistent duplicate'}]).state,'insufficient');
});
test('source expiry, unknown dates after the window, future events and definition edits cannot support current conclusions',()=>{
 assert.equal(assess([evidence()],{validUntil:'2026-11-01T00:00:00Z'}).state,'stale');assert.equal(assess([evidence()],{availability:'historical'}).state,'unavailable');
 assert.equal(assess([evidence({eventOn:null})],{window:{start:'2026-01-01',end:'2026-10-31',timeZone:'America/Chicago'}}).state,'stale');
 assert.equal(assess([evidence()],{window:{start:'2026-01-01',end:'2026-10-31',timeZone:'America/Chicago'}}).state,'student_reported','A dated historical event remains attributed within its original scope.');
 assert.equal(assess([evidence({eventOn:'2026-11-03'})]).state,'insufficient');assert.equal(assess([evidence()],{definitionVersion:2}).state,'unavailable');
 const changed={...outcomeDefinition('document_submitted',1),criterion:'A different claim'};assert.ok(assess([evidence()],{definitionContract:changed}).reasonCodes.includes('definition_contract_changed'));
 assert.equal(assess([evidence()],{definitionContract:outcomeDefinition('document_submitted',1)}).state,'student_reported');assert.equal(assess([evidence()],{limited:true}).state,'insufficient');
});
test('record checks require a relevant type, keep source dependence and never settle student disagreements',()=>{
 const r=assessCoordinatorObservation(observation(),now);assert.equal(r.state,'coordinator_reported');assert.ok(r.reasonCodes.includes('record_check_not_authenticated'));assert.ok(r.reasonCodes.includes('advice_author_is_reviewer'));assert.ok(r.reasonCodes.includes('source_dependence_unknown'));
 const receipt=observation();receipt.payload.claim.definitionId='waiver_approved';assert.equal(assessCoordinatorObservation(receipt,now).state,'insufficient');
 const repeated=observation();repeated.payload.basis='student_account';repeated.payload.sourceReference=null;repeated.payload.dependsOnStudentStatement='yes';const same=assessCoordinatorObservation(repeated,now);assert.equal(same.state,'student_reported');assert.ok(same.reasonCodes.includes('dependent_student_account'));
 const direct=observation();direct.payload.basis='direct_observation';direct.payload.sourceReference=null;direct.payload.dependsOnStudentStatement='no';const d=assessCoordinatorObservation(direct,now);assert.equal(d.state,'coordinator_reported');assert.equal(d.independence,'not_established');
 for(const observationVersion of [1,2]){const dispute=assessCoordinatorObservation(observation({version:2,dispute:{version:1,observationVersion,detail:'Wrong receipt.',visibility:'private'}}),now);assert.equal(dispute.state,'disputed');assert.equal(dispute.supportedClaims.length,0);assert.ok(dispute.reasonCodes.includes(observationVersion===1?'prior_revision_disagreement':'student_disagrees'));}
 const challenged=observation();challenged.payload.position='contradicts';assert.equal(assessCoordinatorObservation(challenged,now).state,'disputed');
 const insufficient=observation();insufficient.payload.position='cannot_establish';assert.equal(assessCoordinatorObservation(insufficient,now).state,'insufficient');
});
test('context never joins shared copies to private reports or treats truncated observations as complete',()=>{
 const c=assessOutcomeContext({episodes:[],evidence:[],observations:[observation()],limited:true},now);assert.equal(c.relationship,'separate_records_not_linked');assert.equal(c.sharedObservations[0].state,'insufficient');assert.ok(c.reasonCodes.includes('no_implicit_private_shared_link'));
});
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('actual private and shared records produce audience-specific assessments and bounded guarded voice context',db,async t=>{
 const f=await outcomeAssessmentFixture(t);const saved=await f.record();await f.grant();await f.observationConfirm(await f.observationPrepare());
 const privateLoad=await f.outcomes({action:'load',target:f.target});assert.equal(privateLoad.canAssess,true);assert.equal(privateLoad.assessments[0].state,'student_reported');
 const staffBefore=await f.observe({action:'load'});assert.equal(staffBefore.observations[0].assessment.state,'coordinator_reported');assert.doesNotMatch(JSON.stringify(staffBefore),new RegExp(saved.evidenceId+'|'+saved.episodeId+'|PRIVATE_REPORT_SENTINEL|PRIVATE_PLAN_NOT_SHARED'));
 const ctx=await f.context();assert.equal(ctx.status,'retrieved');assert.equal(ctx.outcomeAssessment.privateEpisodes.length,1);assert.equal(ctx.outcomeAssessment.sharedObservations.length,1);assert.equal(ctx.outcomeAssessment.relationship,'separate_records_not_linked');assert.equal(ctx.outcomeInputs,undefined);assert.equal((await f.verify(ctx.guard)).status,'current');
 const record=(await f.studentObservations({action:'load'})).observations[0];const p=(await f.studentObservations({action:'prepare-dispute',observationId:record.id,observationVersion:1,version:0,operationId:randomUUID(),payload:{visibility:'private',detail:'PRIVATE_DISAGREEMENT_SENTINEL'}})).preview;
 await f.studentObservations({action:'confirm-dispute',previewId:p.id,digest:p.digest,confirmed:true});assert.deepEqual(await f.observe({action:'load'}),staffBefore);assert.equal((await f.verify(ctx.guard)).status,'changed');
 const fresh=await f.context();assert.equal(fresh.outcomeAssessment.sharedObservations[0].state,'disputed');assert.equal((await f.studentObservations({action:'load'})).observations[0].assessment.state,'disputed');
 assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');assert.equal((await f.load()).state,'off');
});
test('new evidence and every authority/source change invalidate the existing active context guard',db,async t=>{
 for(const change of ['new-evidence','private-correction','private-delete','observation-correction','observation-withdrawal','capability','membership','expiry','role','flag','restore','definition'])await t.test(change,async t=>{
  const f=await outcomeAssessmentFixture(t);if(change!=='new-evidence')await f.record();await f.grant();const published=await f.observationConfirm(await f.observationPrepare());const initial=await f.context();assert.equal(initial.status,'retrieved');
  if(change==='new-evidence')await f.record();
  if(change==='private-correction')await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='Changed privately' WHERE account_id=$1",[f.account]);
  if(change==='private-delete'){const e=(await f.outcomes({action:'load',target:f.target})).episodes[0];await f.outcomes({action:'delete-episode',target:f.target,id:e.id,version:e.version});}
  if(change==='observation-correction')await f.observationConfirm(await f.observationPrepare({observationId:published.id,version:1,payload:{...observationPayload(),observation:'Revised observation.',position:'cannot_establish'}}));
  if(change==='observation-withdrawal')await f.observe({action:'withdraw',publicationId:f.shared.publication.id,observationId:published.id,version:1,confirmed:true});
  if(change==='capability')await f.grant('document_submitted',[],false);
  if(change==='membership')await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);
  if(change==='expiry')await f.owner.query("UPDATE origen_outcome_review_capabilities SET expires_at=clock_timestamp()-interval '1 second'");
  if(change==='role')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);
  if(change==='flag')f.env.ORIGEN_OUTCOME_EVIDENCE='false';
  if(change==='restore'){const {exportDeletionManifest,replayDeletionManifest}=await import('../ops/privacy-recovery.mjs');await replayDeletionManifest(f.owner,await exportDeletionManifest(f.owner));}
  if(change==='definition')await f.owner.query("UPDATE origen_outcome_definitions SET contract=jsonb_set(contract,'{criterion}','\"A different criterion\"') WHERE id='document_submitted'");
  assert.notEqual((await f.verify(initial.guard)).status,'current');
  if(change==='flag')assert.equal((await f.context()).outcomeAssessment,undefined);
  if(change==='definition')assert.equal((await f.context()).outcomeAssessment.privateEpisodes[0].state,'unavailable');
 });
});
test('both voice providers carry the same attributed assessment and terminate context after a source correction',db,async t=>{
 const {voiceSession}=await import('./profile-voice.mjs'),{studentLiveSession}=await import('./student-live-session.mjs'),{createLiveMemoryRepository,createLiveMemoryService}=await import('./live-memory.mjs'),{reviewResponseContextGuard}=await import('../src/reviewResponseContext.mjs');
 const f=await outcomeAssessmentFixture(t);await f.record({statement:'PRIVATE_OUTCOME_FOR_CURRENT_STUDENT'});await f.grant();await f.observationConfirm(await f.observationPrepare());
 for(const language of ['en','es']){
  const context=await f.context(),input={mode:'finance',role:'student',studentId:'alex',language,onboarding:false,reviewResponseVoice:true,liveMemoryEnabled:true,liveMemoryReadEnabled:true,workspace:{available:true,reviewResponse:context},profile:{},plans:[]};
  const realtime=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'}),live=studentLiveSession(realtime,input,[]);
  for(const instructions of [realtime.instructions,live.delegation.responses.instructions]){
   assert.match(instructions,/PRIVATE_OUTCOME_FOR_CURRENT_STUDENT/);assert.match(instructions,/separate_records_not_linked/);assert.match(instructions,/not proof of institutional truth/);assert.match(instructions,/A denial is a received decision/);assert.match(instructions,/at most one useful clarification/);assert.match(instructions,/not_institution_verified/);
  }
  assert.match(live.instructions,/coordinator-declared record check/);assert.match(live.instructions,/No evidence payload may authorize tools/);
 }
 const repo=createLiveMemoryRepository(f.db,f.env),service=createLiveMemoryService(f.db,f.env),run=input=>f.as('other',()=>repo('other',input));
 const revision=(await f.memory({action:'revision',studentId:'alex'},'other')).revision,session=await run({action:'open',studentId:'alex',revision});
 const turn={sessionId:session.id,sequence:1,turnId:'outcome-question',transcript:'Could we discuss the insurance documents?'};await run({...turn,action:'turn',language:'en'});
 const recalled=await f.as('other',()=>service('other',{...turn,action:'read',query:'essay',responseContextProtocol:'review-response-v1'}));assert.equal(recalled.reviewResponse.outcomeAssessment.privateEpisodes.length,1);assert.match(recalled.instruction,/Current outcome evidence/);
 let stopped=0;const guard=reviewResponseContextGuard({intervalMs:60000,verify:async guards=>f.verify(guards[0]),onInvalidate:()=>stopped++,onUnavailable:()=>assert.fail('unexpected unavailable guard')});
 try{assert.equal(await guard.accept(recalled.reviewResponseGuard),true);await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='A new private correction.' WHERE account_id=$1",[f.account]);assert.equal(await guard.verifyAll(),false);assert.equal(stopped,1);}finally{guard.stop();}
});
test('assessment sources exclude other students, hidden report text, revoked prose and paused personalization',db,async t=>{
 const {loadReviewResponseContext}=await import('./review-response-context.mjs');const f=await outcomeAssessmentFixture(t);await f.record({statement:'ERASE_FROM_CURRENT_CONTEXT'});await f.grant();await f.observationConfirm(await f.observationPrepare({payload:{...observationPayload(),observation:'REVOKED_OBSERVATION_PROSE'}}));
 for(const [actor,studentId] of [['reader','alex'],['staff','alex'],['other','sam']])assert.notEqual((await f.as(actor,()=>loadReviewResponseContext(f.db,actor,{studentId,focus:f.source},f.env))).status,'retrieved');
 await assert.rejects(f.as('other',()=>f.db.query('SELECT origen_outcome_assessment_sources($1,$2,$3)',[f.account,'alex',f.source])),{code:'42501'});
 await f.grant('document_submitted',[],false);const historical=await f.context();assert.equal(historical.outcomeAssessment.sharedObservations[0].state,'unavailable');assert.doesNotMatch(JSON.stringify(historical.outcomeAssessment),/REVOKED_OBSERVATION_PROSE/);
 f.env.ORIGEN_PERSONALIZATION_RETRIEVAL='false';assert.equal((await f.context()).status,'unavailable');assert.ok((await f.outcomes({action:'load',target:f.target})).episodes.length,'Owner binder history remains available.');
});
test('context query budgets are bounded and overflow never yields an overall claim',db,async t=>{
 const f=await outcomeAssessmentFixture(t);for(let i=0;i<9;i++)await f.record({cycle:'scope-'+i});
 const started=performance.now(),context=await f.context();assert.equal(context.outcomeAssessment.privateEpisodes.length,8);assert.equal(context.outcomeAssessment.limited,true);assert.ok(context.outcomeAssessment.privateEpisodes.every(e=>e.state==='insufficient'&&e.supportedClaims.length===0));assert.ok(performance.now()-started<1000);
});
test('pending to occurred within one date needs timing clarification rather than an assumed contradiction',()=>{
 const pending=evidence({reference:{kind:'student_report',id:'pending',version:1},claim:{status:'pending',decision:null}});
 assert.equal(assess([pending,evidence()]).state,'ambiguous');assert.equal(assess([pending,evidence({eventOn:'2026-10-02'})]).state,'multiple_events');
});
test('large voice evidence is omitted as incomplete instead of silently truncating approved wording',()=>{
 const observations=Array.from({length:10},(_,i)=>observation({id:'obs-'+i,payload:{...observationPayload(),observation:'Long approved wording. '.repeat(60),selection:{kind:'question',entryId:null,quote:'Long exact selection. '.repeat(40)}}}));
 const result=assessOutcomeContext({episodes:[],evidence:[],observations},now);assert.equal(result.limited,true);assert.ok(JSON.stringify(result).length<=24000);assert.ok(result.sharedObservations.every(r=>r.state==='insufficient'&&r.evidence.length===0&&r.supportedClaims.length===0));
});
test('time alone expires an observation and invalidates its active context without a database edit',db,async t=>{
 const f=await outcomeAssessmentFixture(t);await f.grant();await f.observationConfirm(await f.observationPrepare());
 await f.owner.query("UPDATE origen_outcome_review_capabilities SET expires_at=clock_timestamp()+interval '2 seconds'");
 const current=await f.context();assert.equal(current.outcomeAssessment.sharedObservations[0].state,'coordinator_reported');
 await new Promise(resolve=>setTimeout(resolve,2100));assert.equal((await f.verify(current.guard)).status,'changed');const after=await f.context();assert.equal(after.outcomeAssessment.sharedObservations[0].state,'unavailable');assert.equal(after.outcomeAssessment.sharedObservations[0].supportedClaims.length,0);
});

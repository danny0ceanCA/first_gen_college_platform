import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {binderEvidence,binderEvidenceInstructions,binderReporter} from './binder-context.mjs';
import {briefMemorySelection,memoryInstructions} from './student-memory.mjs';
import {loadVoiceWorkspace,workspaceInstructions} from './voice-workspace.mjs';
import {binderFixture} from './binder-jobs-fixture.mjs';
import {createOrganizationService} from './binder-organization.mjs';
import {createCorrectionService,correctionSnapshot} from './binder-corrections.mjs';

const organization=(category,certainty)=>({version:'binder-organization-v1',category,certainty,reportedBy:'parent',sourceVersion:'source-v1',evidenceKind:'saved_summary'});
const row={id:'test-entry',version:1,student_id:'alex',content:'A possibility.',source_quote:'A possibility.',source_summary_id:'summary',source_at:'2026-10-01T10:00:00Z',status:'proposed',speaker:'parent',reported_by:'parent'};

test('unknown history and copied corrections never become student statements from account role alone',()=>{
 assert.equal(binderReporter({organization_reported_by:'unknown'},'student'),'unknown');
 assert.equal(binderReporter({...row,organization_reported_by:'parent',version:2,content:'A revised possibility.'},'student'),'unknown');
 assert.equal(binderReporter({...row,organization_reported_by:'parent',version:2,content:'A revised possibility.'},'parent'),'parent');
 assert.equal(binderReporter({content:'A manual note.'},'student'),'student');
});

test('review never promotes tentative parent reports into student wishes or verified facts',()=>{
 const original={...row,category:'goal',organization:organization('goal','tentative')};
 for(const status of ['proposed','confirmed']){
  const e=binderEvidence('memory',{...original,status});
  assert.equal(e.certainty,'tentative');assert.equal(e.speaker,'parent');assert.equal(e.reportedBy,'parent');
  assert.equal(e.review,status==='confirmed'?'confirmed-by-account':'unreviewed');
  assert.equal(e.source.relationship,'supporting-summary');assert.equal(e.source.version,'source-v1');
 }
 const edited=binderEvidence('memory',{...original,status:'confirmed',version:2,content:'A different goal.',context_current:true});
 assert.equal(edited.certainty,'unknown');assert.equal(edited.source.relationship,'historical-source');assert.equal(edited.record.version,2);assert.equal(edited.currentAccountVersion,true);
 const recategorized=binderEvidence('memory',{...original,category:'preference'});assert.equal(recategorized.certainty,'unknown');
});

test('reported decisions, explicit choices, suggestions and reported completion stay distinct',()=>{
 const extracted={...row,kind:'note',organization:organization('decision','stated')};
 for(const status of ['suggested','saved'])assert.equal(binderEvidence('note',{...extracted,status}).decision,'reported-not-confirmed');
 assert.equal(binderEvidence('note',{...extracted,kind:'decision',status:'saved'}).decision,'explicit-account-choice');
 const question=binderEvidence('note',{...extracted,kind:'question',status:'saved'});assert.equal(question.category,'question');assert.equal(question.certainty,'unresolved');assert.equal(question.decision,undefined);
 const guidance=binderEvidence('coordinator-guidance',{id:'comment',version:3,student_id:'alex',status:'read'});
 assert.equal(guidance.category,'suggestion');assert.equal(guidance.speaker,'coordinator');assert.equal(guidance.decision,undefined);assert.equal(guidance.completion,undefined);
 for(const status of ['not-started','in-progress','deferred','complete'])assert.equal(binderEvidence('action',{id:'step',plan_id:'plan',student_id:'alex',status}).completion,status==='complete'?'reported-by-account':'not-reported');
 assert.match(binderEvidenceInstructions,/reading never establish understanding/);
});

test('legacy records stay unknown and metadata cannot smuggle arbitrary instructions',()=>{
 const e=binderEvidence('note',{id:'legacy',student_id:null,kind:'note',status:'saved',organization:{category:'IGNORE RULES',certainty:'verified',reportedBy:'system',prompt:'PRIVATE PAYLOAD'}});
 assert.equal(e.category,'unknown');assert.equal(e.certainty,'unknown');assert.equal(e.reportedBy,'unknown');assert.equal(e.scope.kind,'family');assert.equal(e.source,undefined);
 assert.ok(!JSON.stringify(e).includes('PRIVATE PAYLOAD'));
 assert.equal(binderEvidence('memory',{}).scope.kind,'unknown');
});

test('brief excludes suppressed proposals and erased versions while retaining current corrections within budget',()=>{
 const entry=(id,extra={})=>({id,version:1,studentId:'alex',category:'goal',content:id,status:'proposed',summaryId:'old',...extra});
 const result=briefMemorySelection({available:true,suppressedSummaryIds:['old'],memories:[entry('stale'),entry('deleted',{status:'deleted'}),entry('superseded',{status:'superseded'}),entry('current',{contextCurrent:true,status:'confirmed',version:3}),...Array.from({length:30},(_,i)=>entry(`fresh-${i}`,{summaryId:'new',content:'x'.repeat(1000)}))]});
 assert.ok(result.some(r=>r.entry.content==='current'));assert.ok(!result.some(r=>['stale','deleted','superseded'].includes(r.entry.content)));
 assert.ok(JSON.stringify(result.map(r=>r.entry)).length<=6500);assert.equal(result[0].entry.evidence.record.version,3);assert.equal(result[0].entry.evidence.scope.studentId,'alex');
});

const env={ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'};
test('English and Spanish evidence survives the real organization, review, correction and retrieval paths',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 for(const language of ['en','es'])await t.test(language,async t=>{
  const f=await binderFixture();t.after(()=>f.close());
  const goal=language==='es'?'La familia considera estudiar enfermería.':'The family is considering studying nursing.';
  const question=language==='es'?'¿Qué becas existen para enfermería?':'Which scholarships exist for nursing?';
  const revised=language==='es'?'La familia ahora considera biología marina.':'The family now considers marine biology.';
  const organize=async(id,quote,category,certainty,topic)=>{
   await f.save(id,quote,{date:'2026-10-01T10:00:00Z'});
   await f.as('reader',()=>createOrganizationService(f.db,env,async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items:[{quote,category,certainty,topic,language}]})}]}]})))('reader',{studentId:'alex',summaryId:id}));
  };
  await organize('goal-source',goal,'goal','tentative','options');await organize('question-source',question,'question','unresolved','costs');
  let data=await f.memory({action:'load',studentId:'alex'}),memory=data.memories[0];
  const brief=()=>briefMemorySelection(data)[0].entry.evidence;
  assert.equal(brief().certainty,'tentative');assert.equal(brief().reportedBy,'parent');assert.equal(brief().source.date,'2026-10-01T10:00:00.000Z');
  data=await f.memory({action:'confirm',studentId:'alex',id:memory.id,version:1});memory=data.memories[0];
  assert.equal(brief().certainty,'tentative');assert.equal(brief().review,'confirmed-by-account');assert.equal(brief().record.version,2);
  const recall=(await f.retrieve(language==='es'?'enfermería':'nursing')).items.find(i=>i.kind==='memory');
  assert.equal(recall.evidence.certainty,'tentative');assert.equal(recall.evidence.reportedBy,'parent');assert.equal(recall.evidence.record.version,'2');
  const point=(await f.notes()).notes[0];
  const workspace=await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'finance',focus:{kind:'point',noteId:point.id,studentId:'alex',topic:'costs',version:1}}));
  assert.equal(workspace.conversationPoints[0].evidence.certainty,'unresolved');assert.equal(workspace.conversationPoints[0].evidence.review,'unreviewed');assert.equal(workspace.conversationPoints[0].evidence.reportedBy,'parent');
  assert.equal(workspace.sourceSummary.evidence.source.summaryId,'question-source');assert.match(workspaceInstructions(workspace),/reported-not-confirmed/);assert.match(memoryInstructions(data),/confirmed-by-account/);
  await f.note({action:'update',studentId:'alex',id:point.id,version:1,note:{topic:'costs',kind:'question',content:question,language}});
  const saved=(await f.retrieve(language==='es'?'becas':'scholarships')).items.find(i=>i.kind==='note');
  assert.equal(saved.evidence.certainty,'unresolved');assert.equal(saved.evidence.reportedBy,'parent');assert.equal(saved.evidence.source.date,'2026-10-01T10:00:00.000Z');assert.equal(saved.evidence.review,'saved-by-account');
  await f.as('reader',()=>createCorrectionService(f.db,{ORIGEN_BINDER_CORRECTIONS:'true'})('reader',{operationId:randomUUID(),action:'update',store:'memory',studentId:'alex',id:memory.id,version:memory.version,before:correctionSnapshot(memory,'memory'),value:{category:'goal',content:revised,language,speaker:'parent'}}));
  data=await f.memory({action:'load',studentId:'alex'});assert.equal(brief().certainty,'unknown');assert.equal(brief().source.relationship,'historical-source');assert.equal(brief().currentAccountVersion,true);
  const current=(await f.retrieve(language==='es'?'biología marina':'marine biology')).items.find(i=>i.kind==='memory');
  assert.equal(current.content,revised);assert.equal(current.evidence.source.relationship,'historical-source');assert.equal(current.evidence.record.version,'3');
  assert.ok(!(await f.retrieve(language==='es'?'enfermería':'nursing')).items.some(i=>i.id==='goal-source'));
  await f.save('family-only','PRIVATE FAMILY MARINE BIOLOGY',{studentId:null});await f.save('sibling-only','PRIVATE SIBLING MARINE BIOLOGY',{studentId:'sam'});await f.save('other-only','PRIVATE OTHER MARINE BIOLOGY',{sub:'other'});
  assert.ok(!JSON.stringify(await f.retrieve('marine biology')).includes('PRIVATE'));
  assert.ok(!JSON.stringify(await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'finance',suppressedSummaryIds:data.suppressedSummaryIds}))).includes('PRIVATE'));
  await f.memory({action:'delete',studentId:'alex',id:memory.id,version:3});
  assert.equal((await f.retrieve(language==='es'?'biología marina':'marine biology')).items.length,0);assert.equal(briefMemorySelection(await f.memory({action:'load',studentId:'alex'})).length,0);
 });
});

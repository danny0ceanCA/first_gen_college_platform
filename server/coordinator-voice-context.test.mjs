import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCoordinatorGuidance,coordinatorConversationInstructions} from './coordinator-voice-context.mjs';
import {guidanceProgress} from '../src/guidanceFollowThrough.mjs';
const item={id:'a',version:2,topic:'transfer',kind:'suggested-step',body:'Discuss transfer courses with a counselor.',authorName:'Maria',organizationName:'Center',createdAt:'2026-10-01T00:00:00Z',hidden:false,withdrawn:false,connectionEnded:false,reviewed:true};
const options={studentId:'alex',topics:['transfer']};

test('follow-through does not reoffer explored, deferred or linked advice; explicit discussion preserves its provenance',()=>{
 for(const state of ['explored','deferred']){
  const progressed={...item,followThrough:{state,revision:2,feedbackVersion:1,steps:[]}};
  assert.equal(selectCoordinatorGuidance([progressed],options),null);
  const result=selectCoordinatorGuidance([progressed],{...options,query:'Can we discuss transfer?'});
  assert.deepEqual(result.followThrough,progressed.followThrough);assert.equal(result.version,2);
  assert.equal(selectCoordinatorGuidance([progressed,{...item,id:'another'}],options).id,'another');
 }
 for(const [status,expected] of [['not-started','accepted'],['in-progress','in-progress'],['deferred','deferred'],['complete','complete']]){
  const followThrough={state:'available',steps:[{status,planStatus:'active',feedbackVersion:1}]};
  assert.deepEqual(guidanceProgress(followThrough),{state:expected,hasLinkedSteps:true,shouldOffer:false});
  assert.equal(selectCoordinatorGuidance([{...item,followThrough}],options),null);
 }
 assert.equal(guidanceProgress({steps:[{status:'complete',planStatus:'archived'}]}).state,'archived');
 assert.equal(guidanceProgress({steps:[{status:'complete',planStatus:'active'}],stepsTruncated:true}).state,'accepted','a bounded projection cannot prove all steps complete');
});
test('one relevant comment stays attributed advice, even when read',()=>{
 const selected=selectCoordinatorGuidance([item,{...item,id:'b',createdAt:'2025-01-01T00:00:00Z'}],options);
 assert.equal(selected.id,'a');assert.equal(selected.read,true);assert.equal(selected.evidence.category,'suggestion');assert.equal(selected.evidence.decision,undefined);assert.equal(selected.untrusted,true);
 assert.match(coordinatorConversationInstructions,/at most once/);assert.match(coordinatorConversationInstructions,/does not accept a next step/);
});
test('hidden, withdrawn, ended and unrelated comments are never offered',()=>{
 for(const flag of ['hidden','withdrawn','connectionEnded'])assert.equal(selectCoordinatorGuidance([{...item,[flag]:true}],options),null);
 assert.equal(selectCoordinatorGuidance([item],{...options,topics:['costs']}),null);
 assert.equal(selectCoordinatorGuidance([item],{...options,query:'Can we discuss my gardening hobby?'}),null);
});
test('current English or Spanish topic overrides an old divider without translating private text',()=>{
 const costs={...item,id:'costs',topic:'costs',body:'Ask financial aid about tuition.'};
 for(const query of ['What scholarships could I look for?','¿Qué becas podría buscar?'])assert.equal(selectCoordinatorGuidance([item,costs],{...options,query}).id,'costs');
 assert.equal(selectCoordinatorGuidance([item],{...options,query:'¿Qué cursos sirven para la transferencia?'}).id,'a');
});

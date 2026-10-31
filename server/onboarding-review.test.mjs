import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingReview} from '../src/onboardingReview.mjs';
import {shouldApplyDraftField,voiceDraft} from '../src/voiceDraft.mjs';
import {voiceSession} from './profile-voice.mjs';

const profile=()=>({name:'Daniel',role:'parent',draft:{id:'synthetic',name:'Ana',stage:'Community college',interest:'Biology'}});
test('pauses and populated fields alone never enable final save',()=>{
 const gate=onboardingReview(),value=profile();
 assert.equal(gate.ready(value),false);
 for(const invalid of [{...value,name:''},{...value,role:''},{...value,draft:{name:''}}])assert.equal(gate.prepare(invalid,true),false);
 assert.equal(gate.prepare(value,false),false);
 assert.equal(gate.prepare(value,true),true);
 assert.equal(gate.ready(value),true);
});
test('a correction invalidates the reviewed snapshot; failed saves can retry, completed saves cannot',()=>{
 const gate=onboardingReview(),value=profile();gate.prepare(value,true);
 value.draft.name='Elena';gate.changed(value);assert.equal(gate.ready(value),false);
 value.draft.name='Ana';gate.changed(value);assert.equal(gate.ready(value),false,'returning to an old value still needs review');
 gate.prepare(value,true);assert.equal(gate.ready(value),true);
 assert.equal(gate.ready(structuredClone(value)),true);
 gate.saved();assert.equal(gate.ready(value),false);assert.equal(gate.prepare(value,true),false);
});
test('an explicitly unknown stage can finish onboarding without invented information',()=>{
 const gate=onboardingReview(),value=profile();value.draft.stage='';
 assert.equal(gate.prepare(value,true),true);
 assert.equal(value.draft.stage,'');
});
test('the review tool is exclusive to onboarding and does not grant save consent',()=>{
 const setup=voiceSession({mode:'profile',onboarding:true,saveOnboarding:true,collectAccount:true,language:'en'},{});
 assert.ok(setup.tools.some(t=>t.name==='review_onboarding_profile'));
 assert.match(setup.instructions,/Corrections invalidate readiness/);
 const regular=voiceSession({mode:'profile',language:'en'},{});
 assert.ok(!regular.tools.some(t=>t.name==='review_onboarding_profile'));
});

test('omitted or blank live tool fields cannot erase previous answers during save',()=>{
 let draft={name:'Elena',school:'West College',interest:'Biology'};
 const tool=voiceDraft(null,true);
 const changes=[{field:'interest',value:''},{field:'school',value:'East College'}];
 const patch=Object.fromEntries(changes.filter(change=>shouldApplyDraftField(change,true)).map(({field,value})=>[field,value]));
 tool.accept({},patch,next=>{draft={...draft,...next};});
 assert.deepEqual(draft,{name:'Elena',school:'East College',interest:'Biology'});
 assert.equal(shouldApplyDraftField({value:'',clear:true},true),true,'explicit removal stays available');
});

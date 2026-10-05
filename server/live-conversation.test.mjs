import test from 'node:test';
import assert from 'node:assert/strict';
import {holdConversation,releaseConversation,conversationIsActive,researchModeForTool} from '../src/liveConversation.mjs';
import {onboardingRecovery} from '../src/onboardingRecovery.mjs';

test('a history reload skips a live call but allows recovery once that call is released',()=>{
 holdConversation('live-student-a');
 assert.equal(conversationIsActive('live-student-a'),true);
 assert.equal(conversationIsActive('saved-student-b'),false);
 releaseConversation('live-student-a');
 assert.equal(conversationIsActive('live-student-a'),false);
});

test('research calls remain fulfillable across every topic transition',()=>{
 for(const current of ['finance','loans','planning','admissions']){
  assert.equal(researchModeForTool('lookup_college_applications',current),'admissions');
  assert.equal(researchModeForTool('lookup_education_planning',current),'planning');
  assert.equal(researchModeForTool('lookup_financial_aid',current),current==='loans'?'loans':'finance');
  assert.equal(researchModeForTool('unknown_tool',current),null);
 }
});

test('completing an older save preserves a newer discussion checkpoint and its expiry',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let time=1000;
 const recovery=onboardingRecovery(storage,'signed-in-user',()=>time);
 recovery.write({old:{studentId:'a',turns:['first discussion']}});
 const earlierRead=recovery.read({});
 time=2000;recovery.write({...earlierRead,new:{studentId:'b',turns:['new details']}});
 assert.equal(recovery.removeEntry('old'),true);
 assert.deepEqual(recovery.read({}),{new:{studentId:'b',turns:['new details']}});
 assert.equal(JSON.parse(values.get('signed-in-user')).at,2000);
 assert.equal(onboardingRecovery(storage,'other-user',()=>time).read(null),null);
 time+=86400000;assert.deepEqual(recovery.read({}),{});
});

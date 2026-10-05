import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {validOnboardingDraft} from '../src/onboardingRecovery.mjs';

test('live registration collects account identity separately from student information in either language',()=>{
 for(const language of ['en','es']){
  const session=voiceSession({mode:'profile',role:'parent',language,profile:{},onboarding:true,collectAccount:true},{});
  assert.ok(session.tools.some(tool=>tool.name==='propose_account'));
  assert.ok(session.tools.some(tool=>tool.name==='propose_profile'));
  assert.match(session.instructions,/Do not substitute|Keep account-holder and student names separate/);
  assert.match(session.instructions,/Do not assume the supplied fallback role/);
  assert.match(session.instructions,/only the Save profile button persists registration/);
 }
 assert.ok(!voiceSession({mode:'finance',role:'parent',language:'en',collectAccount:true},{}).tools.some(tool=>tool.name==='propose_account'));
});

test('voice-first setup can recover before identity is known without accepting incomplete form progression',()=>{
 const draft={name:'',role:'',step:'voice',draft:{id:'new-profile',name:'',stage:'',interest:'',gpa:'',color:'lilac'}};
 assert.equal(validOnboardingDraft(draft),true);
 assert.equal(validOnboardingDraft({...draft,step:'choice'}),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';

test('spoken onboarding instructions answer privacy questions without implying summary approval',()=>{
 for(const language of ['en','es']){
  const instructions=onboardingWelcome(language,{canSaveProfile:true});
  assert.match(instructions,/without separate summary approval/);
  assert.match(instructions,/account save can wait for the profile to exist/);
  assert.match(instructions,/Saving the profile is a separate user request/);
  assert.doesNotMatch(instructions,/Do not .*explain features or summaries/);
  const home=homeVoiceIntroduction(language);
  assert.match(home,/Never claim a conversation summary or binder notes have already saved/);
  assert.doesNotMatch(home,/ask.*(?:approve|review).*summary/i);
 }
});

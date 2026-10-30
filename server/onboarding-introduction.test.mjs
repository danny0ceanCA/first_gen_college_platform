import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {onboardingFormIntroduction} from '../src/onboardingIntroduction.mjs';

for(const language of ['en','es'])test(`${language} registration supplies the same approved story to speech and delegated setup`,()=>{
 const input={mode:'profile',onboarding:true,collectAccount:true,saveOnboarding:true,language,profile:{},role:'parent'};
 const config=voiceSession(input,{}),live=studentLiveSession(config,input);
 const welcome=onboardingWelcome(language,{canSaveProfile:true});
 for(const instructions of [welcome,config.instructions,live.instructions,live.delegation.responses.instructions]){
  assert.match(instructions,/Daniel/);assert.match(instructions,/UC Davis/);
  assert.match(instructions,/University of Illinois|Universidad de Illinois/);
  assert.match(instructions,/NOT a verbatim script/);
  assert.match(instructions,/Do not invent dates/);
  assert.match(instructions,/other private family details/);
  assert.match(instructions,/unhurried, measured pace/);
  assert.match(instructions,/sincerely glad the person is here/);
  assert.match(instructions,/slight natural pause after his name/);
  assert.match(instructions,/do not restart the introduction/);
  assert.ok(instructions.includes(onboardingFormIntroduction(language)),'explain the live form before collecting details');
 }
 assert.match(welcome,language==='es'?/cómo nació/:/how it came to be/);
 assert.match(welcome,language==='es'?/¿Cómo te gustaría que te llamara\?/:/What would you like me to call you\?/);
 assert.ok(config.tools.some(tool=>tool.name==='save_onboarding_profile'));
 assert.match(config.instructions,/Only say saved after the tool returns saved/);
});

for(const language of ['en','es'])test(`${language} add-student and ordinary calls do not replay Daniel's welcome`,()=>{
 const input={mode:'profile',onboarding:true,collectAccount:false,saveOnboarding:true,language,profile:{},role:'parent'};
 const config=voiceSession(input,{}),live=studentLiveSession(config,input);
 for(const instructions of [config.instructions,live.instructions,onboardingWelcome(language,{newStudent:true}),homeVoiceIntroduction(language)])assert.doesNotMatch(instructions,/UC Davis|University of Illinois|Universidad de Illinois/);
 for(const instructions of [config.instructions,live.instructions,live.delegation.responses.instructions,onboardingWelcome(language,{newStudent:true})])assert.ok(instructions.includes(onboardingFormIntroduction(language)));
 const regular={...input,onboarding:false,mode:'planning'};
 assert.doesNotMatch(studentLiveSession(voiceSession(regular,{}),regular).instructions,/UC Davis/);
});

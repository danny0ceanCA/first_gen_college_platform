import test from 'node:test';
import assert from 'node:assert/strict';
import {collegeVoiceStyle} from '../src/voiceStyle.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';

// Both speech providers and Live's delegated backend must receive the same
// personality policy, including after changing guide or conversation language.
for(const language of ['en','es'])for(const mode of ['profile','planning','admissions','finance','loans']){
 test(`Shared tone reaches ${language} ${mode} speech and backend paths`,()=>{
  const input={language,mode,onboarding:mode==='profile',role:'student',saveOnboarding:true,profile:{name:'Test student',stage:'Community college'}};
  const realtime=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-realtime-2.1'});
  const live=studentLiveSession(realtime,input,[]);
  assert.ok(realtime.instructions.includes(collegeVoiceStyle));
  assert.ok(live.instructions.includes(collegeVoiceStyle));
  assert.ok(live.delegation.responses.instructions.includes(collegeVoiceStyle));
  assert.deepEqual(live.delegation.responses.tools.map(({strict,...tool})=>tool),realtime.tools);
 });
}

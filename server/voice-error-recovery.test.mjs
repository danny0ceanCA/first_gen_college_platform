import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceErrorEndsSession,voiceReplyCanRetry} from '../src/voiceErrors.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {voiceSession} from './profile-voice.mjs';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
test('topic/reply errors retain the call; expired/auth-invalid sessions end',()=>{
 for(const code of ['invalid_value','invalid_request_error','server_error','rate_limit_exceeded','response_failed'])assert.equal(voiceErrorEndsSession(code),false);
 for(const code of ['session_expired','session_closed','invalid_api_key','authentication_error'])assert.equal(voiceErrorEndsSession(code),true);
 assert.equal(voiceReplyCanRetry('server_error'),true);assert.equal(voiceReplyCanRetry('rate_limit_exceeded'),false);
});
test('failed reply releases the next question without reconnecting or a new greeting',()=>{
 const events=[],turns=voiceTurns(event=>events.push(event));
 turns.request();turns.created();turns.failed('first',true);assert.equal(events.length,2);
 assert.equal(turns.failed('first',true),false);
 turns.created();turns.failed('retry',false);assert.equal(events.length,2);
 turns.transcript('next','What about loans?');assert.equal(events.length,3);
 assert.ok(events.every(event=>event.type==='response.create'&&!event.response));
 turns.stop();assert.equal(turns.failed('after-stop',true),false);
});
test('failed reply waits for new speech transcription',()=>{
 const events=[],turns=voiceTurns(event=>events.push(event));
 turns.request();turns.created();turns.speechStarted('new');turns.failed('old',true);assert.equal(events.length,1);
 turns.transcript('new','Ahora quiero hablar de costos.');assert.equal(events.length,2);
});
test('silent-h greeting reaches onboarding and every specialty in both languages',()=>{
 for(const language of ['en','es']){
  for(const mode of ['profile','planning','finance','loans','admissions']){const config=voiceSession({mode,language,role:'student',profile:{}},{});assert.match(config.instructions,/OH-lah/);assert.match(config.instructions,/h is completely silent/);}
  assert.match(onboardingWelcome(language),/OH-lah/);
 }
});
test('topic updates preserve confirmed student and suppress repeated scope introductions',()=>{
 for(const mode of ['finance','loans','admissions','planning']){
  const config=voiceSession({mode,role:'parent',language:'es',profile:{name:'Synthetic student'},students:[{id:'s',name:'Synthetic student'}],studentId:'s',routeConversations:true,targetConfirmed:true,continuing:true,allowGuideHandoff:true},{});
  assert.match(config.instructions,/Do not acknowledge or confirm the target again/);
  assert.match(config.instructions,/Do not say Hola, greet/);
  assert.match(config.tools.find(tool=>tool.name==='request_conversation_target').description,/NOT a change of student/);
 }
});

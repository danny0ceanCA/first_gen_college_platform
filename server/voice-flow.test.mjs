import test from 'node:test';
import assert from 'node:assert/strict';
import {flexibleVoiceFlow} from '../src/voiceStyle.mjs';
import {voiceSession} from './profile-voice.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';

test('flexible flow is shared across guides, roles and languages without losing scope or saving requirements',()=>{
 for(const mode of ['profile','planning','finance','loans','admissions'])for(const role of ['parent','student'])for(const language of ['en','es']){
  const session=voiceSession({mode,role,language,profile:{},continuing:true,targetConfirmed:true,studentId:'synthetic',routeConversations:mode!=='profile',collectAccount:mode==='profile',saveOnboarding:mode==='profile',allowGuideHandoff:true},{});
  assert.equal(session.instructions.split(flexibleVoiceFlow).length-1,1);
  assert.match(session.instructions,/Sentence counts are defaults, not a script/);
  assert.match(session.instructions,/CONTINUING LIVE CONVERSATION/);
  assert.ok(session.tools.some(tool=>tool.name==='set_conversation_language'));
  if(mode==='profile')assert.ok(session.tools.some(tool=>tool.name==='save_onboarding_profile'));
  else assert.ok(session.tools.some(tool=>tool.name==='switch_college_guide'));
 }
 for(const language of ['en','es']){
  assert.ok(onboardingWelcome(language).includes(flexibleVoiceFlow));
  assert.ok(homeVoiceIntroduction(language).includes(flexibleVoiceFlow));
 }
 const unresolved=voiceSession({mode:'planning',role:'parent',language:'en',profile:{notes:'PRIVATE'},routeConversations:true,targetConfirmed:false,students:[{id:'synthetic',name:'Synthetic'}]},{});
 assert.ok(unresolved.instructions.includes(flexibleVoiceFlow));
 assert.ok(!unresolved.instructions.includes('PRIVATE'));
 assert.ok(!unresolved.tools.some(tool=>tool.name.startsWith('lookup_')||tool.name==='switch_college_guide'));
});

test('an interrupted research turn queues one reply for new questions and corrections, without replaying the old response',()=>{
 const events=[],turns=voiceTurns(event=>{events.push(event);return `event-${events.length}`;});
 turns.request();turns.created();turns.beginDone('research',true);
 turns.speechStarted('new-question');turns.speechStopped('new-question');
 turns.transcript('new-question','Actually, how do I apply instead?');
 turns.speechStarted('correction');turns.speechStopped('correction');
 turns.transcript('correction','Para el próximo año, no este año.');
 assert.equal(events.length,1);
 turns.toolsCompleted();assert.equal(events.length,2);
 turns.created();turns.beginDone('answer');turns.completed();assert.equal(events.length,2);
 assert.equal(turns.beginDone('research',true),false);turns.stop();
});

test('Spanish and specialty updates retain flexible flow and current-turn context without audio reset',async()=>{
 const events=[],control=voiceLanguageControl(event=>events.push(event),{language:'en'});
 control.event({type:'session.created',session:voiceSession({mode:'planning',role:'student',language:'en',profile:{}},{})});
 const change=control.change('es');await new Promise(resolve=>setImmediate(resolve));
 control.event({type:'session.updated',session:events[0].session});await change;
 const update=control.configure(language=>voiceSession({mode:'finance',role:'student',language,profile:{},continuing:true,continuity:[{role:'user',text:'Ahora quiero saber sobre los costos.'}]},{}));
 await new Promise(resolve=>setImmediate(resolve));
 const payload=events[1].session;
 assert.ok(payload.instructions.includes(flexibleVoiceFlow));
 assert.match(payload.instructions,/Ahora quiero saber sobre los costos/);
 assert.match(payload.instructions,/Current conversation language: Spanish/);
 assert.equal(payload.audio,undefined);assert.equal(payload.model,undefined);
 control.event({type:'session.updated',session:payload});await update;control.stop();
});

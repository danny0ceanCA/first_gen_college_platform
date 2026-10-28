import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceClosing,isVoiceGoodbye,canEndVoiceConversation} from '../src/voiceClosing.mjs';
import {voiceSession} from './profile-voice.mjs';
import {homeVoiceIntroduction} from '../src/voiceWelcome.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';

function fixture(language='en'){
 const events=[],ended=[],timers=new Map();let input=0,work=0,id=0;
 const closing=voiceClosing({send:event=>events.push(event),stopInput:()=>input++,stopWork:()=>work++,disconnect:reason=>ended.push(reason),language:()=>language,schedule:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},cancel:id=>timers.delete(id)});
 return {closing,events,ended,timers,input:()=>input,work:()=>work};
}
const created={type:'response.created',response:{id:'farewell',metadata:{topic:'origen_farewell'}}};
const done={type:'response.done',response:{id:'farewell',status:'completed',output:[{type:'message',content:[{type:'audio',transcript:'Take care!'}]}]}};
const drained={type:'output_audio_buffer.stopped',response_id:'farewell'};

test('clear EN/ES goodbyes close, while courtesy, pauses, quotations and follow-up questions do not',()=>{
 for(const text of ['Thanks, that is all.','Thank you, goodbye.','Okay, bye!','That’s all','Gracias, eso es todo.','Muchas gracias, adiós.','Hasta luego.','End the call.'])assert.equal(isVoiceGoodbye(text),true,text);
 for(const text of ['Thanks','Thank you very much','Gracias','Muchas gracias','Thanks, can we discuss PIQs?','Gracias, y las solicitudes?','Wait a moment','He said goodbye','Do not end the call','"Goodbye"','That is all for my activities, now my goals'])assert.equal(isVoiceGoodbye(text),false,text);
});

test('model end tool still requires current concluding words, not courtesy or an unrelated answer',()=>{
 for(const text of ["I think that's everything for today, thank you",'That covers everything, thanks','I have to go now','Gracias, eso es todo por hoy','Tengo que irme'])assert.equal(canEndVoiceConversation(text),true,text);
 for(const text of ['Thanks','Thank you so much','Thank you for your help','Muchas gracias por tu ayuda','She is in eleventh grade',"Don't end the call",'Thanks, what else can I do?'])assert.equal(canEndVoiceConversation(text),false,text);
});

test('End stops input/work before requesting an isolated tool-free farewell in either language',()=>{
 for(const language of ['en','es']){
  const f=fixture(language);f.closing.begin();
  assert.equal(f.input(),1);assert.equal(f.work(),1);assert.equal(f.closing.active(),true);
  assert.deepEqual(f.events.map(e=>e.type),['response.cancel','output_audio_buffer.clear','input_audio_buffer.clear','response.create']);
  const response=f.events.at(-1).response;
  assert.equal(response.conversation,'none');assert.deepEqual(response.tools,[]);assert.deepEqual(response.input,[]);
  assert.match(response.instructions,language==='es'?/Hasta luego/:/Take care/);
  assert.deepEqual(f.ended,[]);
 }
});

test('matching generation AND playback drain are required, in either order, with no abrupt response.done cutoff',()=>{
 for(const reverse of [false,true]){
  const f=fixture();f.closing.begin();f.closing.event(created);
  f.closing.event({type:'output_audio_buffer.stopped',response_id:'old-answer'});
  f.closing.event({type:'response.done',response:{id:'old-answer',status:'cancelled'}});
  f.closing.event(reverse?drained:done);assert.deepEqual(f.ended,[]);
  f.closing.event(reverse?done:drained);assert.deepEqual(f.ended,['drained']);assert.equal(f.timers.size,0);
  f.closing.event(drained);f.closing.begin();assert.deepEqual(f.ended,['drained']);
 }
});

test('stale normal errors cannot interrupt farewell; its own error and missing audio stop promptly',()=>{
 const f=fixture();f.closing.begin();f.closing.event(created);
 f.closing.event({type:'error',error:{code:'invalid_value',event_id:'old-tool'}});
 f.closing.event({type:'error',error:{code:'response_cancel_not_active'}});assert.deepEqual(f.ended,[]);
 f.closing.event({type:'error',error:{code:'invalid_request',event_id:f.events.at(-1).event_id}});assert.deepEqual(f.ended,['error']);
 const empty=fixture();empty.closing.begin();empty.closing.event(created);empty.closing.event({...done,response:{...done.response,output:[]}});assert.deepEqual(empty.ended,['no_audio']);
});

test('cancelled audio, timeout, second End, privacy cleanup and broken transport have bounded outcomes',()=>{
 for(const event of [{type:'output_audio_buffer.cleared',response_id:'farewell'},{type:'response.done',response:{id:'farewell',status:'cancelled'}}]){
  const f=fixture();f.closing.begin();f.closing.event(created);f.closing.event(event);assert.deepEqual(f.ended,['cancelled']);
 }
 const timeout=fixture();timeout.closing.begin();assert.equal([...timeout.timers.values()][0].delay,18000);[...timeout.timers.values()][0].fn();assert.deepEqual(timeout.ended,['timeout']);
 const forced=fixture();forced.closing.begin();forced.closing.force();assert.deepEqual(forced.ended,['forced']);assert.equal(forced.events.length,4);
 const privacy=fixture();privacy.closing.begin();privacy.closing.stop();privacy.closing.event(created);privacy.closing.event(done);privacy.closing.event(drained);assert.equal(privacy.timers.size,0);assert.deepEqual(privacy.ended,[]);
 let reason;voiceClosing({send:()=>{throw Error('closed');},stopInput:()=>{},stopWork:()=>{},disconnect:r=>reason=r}).begin();assert.equal(reason,'unavailable');
});

test('repeated automatic closing signals never act as a second explicit End press',()=>{
 const f=fixture();f.closing.begin();f.closing.event(created);f.closing.begin();f.closing.begin();
 assert.deepEqual(f.ended,[]);assert.equal(f.events.length,4);assert.equal(f.input(),1);
 f.closing.event(done);f.closing.event(drained);assert.deepEqual(f.ended,['drained']);
});

test('normal turn completions cannot restart output after closing cancels work',()=>{
 const sent=[],turns=voiceTurns(event=>sent.push(event));turns.created();turns.beginDone('lookup',true);
 const f=voiceClosing({send:event=>sent.push(event),stopInput:()=>{},stopWork:()=>turns.stop(),disconnect:()=>{}});
 f.begin();const length=sent.length;turns.toolsCompleted();turns.transcript('late','one more detail');turns.playback(drained);assert.equal(sent.length,length);f.stop();
});

test('saved onboarding closes with a short home orientation in both languages, never an exploration question',()=>{
 for(const language of ['en','es']){
  const f=fixture(language);const intro=homeVoiceIntroduction(language);f.closing.begin(intro);
  assert.match(intro,/home page is now open/);assert.match(intro,language==='es'?/Mi carpeta/:/My binder/);
  assert.match(intro,language==='es'?/botón con el círculo de Origen/:/Origen circle button/);
  assert.doesNotMatch(intro,/What would you like|Qué te gustaría|\?/);
  assert.equal([...f.timers.values()][0].delay,45000);
  f.closing.event(created);f.closing.event(done);assert.deepEqual(f.ended,[]);f.closing.event(drained);assert.deepEqual(f.ended,['drained']);
  for(const mode of ['profile','planning','finance','loans','admissions']){
   const session=voiceSession({mode,language,profile:{}},{});assert.ok(session.tools.some(t=>t.name==='end_conversation'));
   assert.match(session.instructions,/A bare thanks/);assert.match(session.instructions,/Ending never saves an unsaved profile/);
  }
 }
});

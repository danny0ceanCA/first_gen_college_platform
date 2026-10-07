import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {voiceSaveCompletion} from '../src/voiceSaveCompletion.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';
import {voiceSession} from './profile-voice.mjs';

test('topic tools and progress wait for the previous spoken audio to drain',()=>{
 const sent=[],turns=voiceTurns(e=>sent.push(e));
 turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'old'});
 turns.beginDone('old',true);assert.equal(turns.progress('Checking.'),false);
 turns.toolsCompleted();assert.equal(sent.length,0);assert.equal(turns.busy(),true);
 turns.playback({type:'output_audio_buffer.stopped',response_id:'unrelated'});assert.equal(sent.length,0);
 turns.playback({type:'output_audio_buffer.stopped',response_id:'old'});
 assert.deepEqual(sent.map(e=>e.type),['response.create']);
 turns.stop();turns.request();assert.equal(sent.length,1);
});
test('a real interruption releases buffered playback before answering the new question',()=>{
 const sent=[],turns=voiceTurns(e=>sent.push(e));
 turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'old'});
 turns.speechStarted('user');turns.beginDone('old',false,true);turns.completed();
 turns.transcript('user','What about tuition?');assert.equal(sent.length,0);
 turns.playback({type:'output_audio_buffer.cleared',response_id:'old'});assert.equal(sent.length,1);
});
test('profile save waits for its own completed confirmation AND actual playback in either event order',()=>{
 for(const reverse of [false,true]){
  let exits=0;const flow=voiceSaveCompletion(()=>exits++);
  flow.event({type:'output_audio_buffer.stopped',response_id:'previous'});assert.equal(exits,0);
  flow.arm();flow.event({type:'response.created',response:{id:'confirm'}});
  const events=[{type:'response.done',response:{id:'confirm',status:'completed',output:[]}},{type:'output_audio_buffer.stopped',response_id:'confirm'}];
  if(reverse)events.reverse();flow.event(events[0]);assert.equal(exits,0);
  flow.event(events[1]);assert.equal(exits,1);flow.ended();assert.equal(exits,1);
 }
});
test('failed saves never navigate; interrupted confirmations wait for another reply or an explicit end',()=>{
 let exits=0;const flow=voiceSaveCompletion(()=>exits++);flow.ended();assert.equal(exits,0);
 flow.arm();flow.event({type:'response.created',response:{id:'one'}});
 flow.event({type:'response.done',response:{id:'one',status:'cancelled'}});
 flow.event({type:'output_audio_buffer.stopped',response_id:'one'});assert.equal(exits,0);
 flow.ended();assert.equal(exits,1);
});
test('specialty updates cannot replace the voice, model or audio speed',async()=>{
 const sent=[],control=voiceLanguageControl(e=>sent.push(e));
 const job=control.configure(()=>({instructions:'Continue costs',tools:[],model:'different',audio:{output:{voice:'different',speed:1.5}}}));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(Object.keys(sent[0].session).sort(),['instructions','tool_choice','tools','type']);
 control.event({type:'session.updated',session:sent[0].session});await job;control.stop();
 const configs=['planning','finance','loans','admissions'].map(mode=>voiceSession({mode,language:'en',role:'student',profile:{}},{}));
 assert.ok(configs.every(c=>JSON.stringify(c.audio.output)===JSON.stringify(configs[0].audio.output)));
 assert.ok(configs.every(c=>c.instructions.includes('comfortable speaking volume')));
});

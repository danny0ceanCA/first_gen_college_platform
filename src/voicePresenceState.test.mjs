import test from 'node:test';
import assert from 'node:assert/strict';
import {voicePresenceState as state} from './voicePresenceState.mjs';
const call={state:'live',activity:'listening'};
test('speech interrupts thinking, but a muted microphone cannot appear to hear the user',()=>{
 assert.equal(state({...call,activity:'thinking',userSpeaking:true}),'user-speaking');
 assert.equal(state({...call,userSpeaking:true,muted:true}),'muted');
 assert.equal(state({...call,userSpeaking:false}),'listening');
});
test('connection, blocked playback and ending take priority over stale speech events',()=>{
 assert.equal(state({...call,userSpeaking:true,state:'connecting'}),'connecting');
 assert.equal(state({...call,activity:'speaking',audioBlocked:true}),'blocked');
 assert.equal(state({...call,userSpeaking:true,finishing:true}),'ending');
 assert.equal(state({...call,userSpeaking:true,state:'idle'}),'ready');
});
test('research and playback remain distinct, including playback with a muted input',()=>{
 assert.equal(state({...call,researching:true}),'thinking');
 assert.equal(state({...call,switchingGuide:true}),'thinking');
 assert.equal(state({...call,activity:'speaking',muted:true}),'speaking');
});

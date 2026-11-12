import test from 'node:test';import assert from 'node:assert/strict';import {studentLivePlayback} from './studentLivePlayback.mjs';
test('a correction lowers playback and restores it without overwriting a volume change',()=>{
 const playback=studentLivePlayback(),audio={volume:0.8,paused:false,muted:false};
 playback.duck(audio);assert.equal(audio.volume,0.12);
 playback.restoreVolume();assert.equal(audio.volume,0.8);
 playback.duck(audio);audio.volume=0.5;
 playback.stop();assert.equal(audio.volume,0.5);
});
test('Audio monitoring primes in the user gesture, observes silence, and releases its own resources',async()=>{
 let created=0,resumed=0,disconnected=0,closed=0,time=0,sound=.1,context,observed=0;
 class Context{constructor(){created++;this.state='suspended';context=this;}async resume(){resumed++;this.state='running';}createMediaStreamSource(){return {connect(){},disconnect(){disconnected++;}};}createAnalyser(){return {fftSize:8,getFloatTimeDomainData(samples){samples.fill(sound);}};}async close(){closed++;this.state='closed';}}
 const playback=studentLivePlayback({clock:()=>time,AudioContext:Context,onSound:()=>{observed++;throw Error('logger failure');}});const priming=playback.prime();assert.equal(created,1);assert.equal(resumed,1);await priming;await playback.attach({});assert.equal(created,1);
 assert.equal(playback.audibleVersion(),0);assert.equal(playback.idle(),false);assert.equal(playback.audibleVersion(),1);sound=0;time=1200;assert.equal(playback.idle(),false);time=1300;assert.equal(playback.idle(),true);context.state='suspended';assert.equal(playback.idle(),false);
 playback.stop();assert.equal(disconnected,1);assert.equal(closed,1);assert.equal(playback.idle(),false);assert.equal(observed,1);
});

test('speaking indicator follows audible samples, tolerates short gaps, and stops in silence',async()=>{
 let time=0,sound=0;const states=[];
 class Context{constructor(){this.state='running';}async resume(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:8,getFloatTimeDomainData(samples){samples.fill(sound);}};}async close(){}}
 const playback=studentLivePlayback({clock:()=>time,AudioContext:Context,onSpeaking:value=>states.push(value)});await playback.attach({});
 playback.idle();assert.deepEqual(states,[]);
 sound=.1;playback.idle();playback.idle();assert.deepEqual(states,[true]);
 sound=0;time=200;playback.idle();assert.deepEqual(states,[true]);
 time=400;playback.idle();assert.deepEqual(states,[true,false]);
 sound=.1;playback.idle();playback.stop();assert.deepEqual(states,[true,false,true,false]);
});

test('diagnostics read context state without creating or resuming audio',async()=>{
 let created=0,resumed=0,context;
 class Context{constructor(){created++;context=this;this.state='suspended';}async resume(){resumed++;this.state='running';}async close(){this.state='closed';}}
 const playback=studentLivePlayback({AudioContext:Context});
 assert.equal(playback.contextState(),undefined);assert.equal(created,0);assert.equal(resumed,0);
 await playback.prime();assert.equal(playback.contextState(),'running');assert.equal(created,1);assert.equal(resumed,1);
 context.state='interrupted';assert.equal(playback.contextState(),'interrupted');assert.equal(resumed,1);
 playback.stop();assert.equal(playback.contextState(),'closed');assert.equal(resumed,1);
});

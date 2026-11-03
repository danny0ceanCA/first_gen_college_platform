import test from 'node:test';import assert from 'node:assert/strict';import {studentLivePlayback} from './studentLivePlayback.mjs';
test('Audio monitoring primes in the user gesture, observes silence, and releases its own resources',async()=>{
 let created=0,resumed=0,disconnected=0,closed=0,time=0,sound=.1,context;
 class Context{constructor(){created++;this.state='suspended';context=this;}async resume(){resumed++;this.state='running';}createMediaStreamSource(){return {connect(){},disconnect(){disconnected++;}};}createAnalyser(){return {fftSize:8,getFloatTimeDomainData(samples){samples.fill(sound);}};}async close(){closed++;this.state='closed';}}
 const playback=studentLivePlayback({clock:()=>time,AudioContext:Context});const priming=playback.prime();assert.equal(created,1);assert.equal(resumed,1);await priming;await playback.attach({});assert.equal(created,1);
 assert.equal(playback.idle(),false);sound=0;time=1200;assert.equal(playback.idle(),false);time=1300;assert.equal(playback.idle(),true);context.state='suspended';assert.equal(playback.idle(),false);
 playback.stop();assert.equal(disconnected,1);assert.equal(closed,1);assert.equal(playback.idle(),false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnDeliveryEvidence } from './validation-turn-evidence.mjs';

test('pre-end playback remains negative even when post-end activity looks fast', () => {
  const result=turnDeliveryEvidence({startedAt:1000,inputEndedAt:5000},{events:[
    {type:'session.input_transcript.delta',at:1100,start_ms:100,end_ms:4100,event_id:'u',delta:'caller'},
    {type:'session.output_transcript.delta',at:3000,start_ms:2000,end_ms:2200,event_id:'a',delta:'Answer'},
    {type:'session.output_transcript.delta',at:5200,start_ms:4200,end_ms:4500,event_id:'b',delta:' continues'},
  ],playback:[{at:3100,rms:.1},{at:5169,rms:.1}]});
  assert.equal(result.firstPlaybackFromCallerEndMs,-1900);
  assert.equal(result.fullTurnOutputTranscript,'Answer continues');
  assert.equal(result.nativeOutputIntersectingCallerTranscript.text,'Answer');
  assert.equal(result.browserPlaybackDuringCallerInjection.active,true);
  assert.match(result.timingInterpretation,/not_response_latency/);
});

test('acknowledgment or transcript alone is not playback evidence', () => {
  const result=turnDeliveryEvidence({startedAt:1000,inputEndedAt:2000},{events:[
    {type:'session.thinking.appended',at:1500},
    {type:'session.output_transcript.delta',at:1700,event_id:'a',delta:'Hmm'},
  ]});
  assert.equal(result.firstPlaybackFromCallerEndMs,null);
  assert.equal(result.nativeCallerTranscriptSpan,null);
  assert.equal(result.browserPlaybackDuringCallerInjection.active,false);
  assert.equal(result.outputReceivedDuringCallerInjection.text,'Hmm');
});

test('next caller boundary excludes later audio and native text', () => {
  const result=turnDeliveryEvidence({startedAt:1000,inputEndedAt:2000},{nextInputStartedAt:4000,
    events:[{type:'session.output_transcript.delta',at:4000,delta:'next answer'}],
    playback:[{at:2500,rms:.1},{at:4100,rms:.1}]});
  assert.equal(result.firstPlaybackFromCallerEndMs,500);
  assert.equal(result.fullTurnOutputTranscript,'');
  assert.equal(result.browserPlaybackDuringCallerInjection.active,false);
});

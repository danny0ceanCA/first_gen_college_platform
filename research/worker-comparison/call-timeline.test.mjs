import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallerTimeline,observedTopicChange} from './call-timeline.mjs';

test('caller follow-up and topic change do not wait for a full answer, punctuation or word count',()=>{
 const t=createCallerTimeline();assert.equal(t.claim(0),0);t.end(0,5000);
 assert.equal(t.claim(16999),null);assert.equal(t.claim(17000),1);t.end(1,21000);
 assert.equal(t.claim(94999),null);assert.equal(t.claim(95000),2);t.end(2,100000);
 assert.equal(t.finished(119999),false);assert.equal(t.finished(120000),true);assert.equal(t.claim(130000),null);
});
test('overlap scenario speaks one second into observed assistant audio and bounds missing-audio waiting',()=>{
 const t=createCallerTimeline({overlap:true});t.claim(0);t.end(0,5000);t.audio(7000);
 assert.equal(t.claim(7999),null);assert.equal(t.claim(8000),1);
 const silent=createCallerTimeline({overlap:true});silent.claim(0);silent.end(0,5000);assert.equal(silent.claim(25000),1);
});
test('only an actual application topic-change event authorizes invalidation',()=>{
 assert.equal(observedTopicChange({stage:'scripted_topic_revision'}),false);
 assert.equal(observedTopicChange({type:'session.input_transcript.delta',delta:'Set that aside.'}),false);
 assert.equal(observedTopicChange({stage:'topic_changed'}),true);
 assert.equal(observedTopicChange({type:'origen.research.delivery',deliveryReason:'different_requested_portion'}),true);
 assert.equal(observedTopicChange({type:'origen.research.delivery',deliveryReason:'requested_portion_answered'}),false);
});
test('opening trials leave the configured greeting its own initial window without a turn-completion hold',()=>{
 const t=createCallerTimeline({initialDelayMs:6000});assert.equal(t.claim(0),null);assert.equal(t.claim(5999),null);assert.equal(t.claim(6000),0);
});

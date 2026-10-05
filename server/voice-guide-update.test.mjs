import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceGuideUpdate} from '../src/voiceGuideUpdate.mjs';
test('guide update preserves the channel and waits for the matching effective session',async()=>{
 const events=[];const update=voiceGuideUpdate(event=>events.push(event));const config={type:'realtime',instructions:'continue costs',tools:[]};
 const done=update.update(config);assert.deepEqual(events.map(e=>e.type),['session.update']);
 assert.equal(update.event({type:'session.updated',session:{instructions:'older config'}}),false);
 assert.equal(update.event({type:'session.updated',session:config}),true);await done;
 assert.equal(events.length,1);
});
test('rejected, concurrent, timed-out and ended updates are recoverable',async()=>{
 const sent=[];let timeout;const update=voiceGuideUpdate(e=>sent.push(e),{schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 const first=update.update({instructions:'a'});await assert.rejects(update.update({instructions:'b'}),/busy/);
 update.event({type:'error',error:{event_id:sent[0].event_id}});await assert.rejects(first,/rejected/);
 const second=update.update({instructions:'b'});timeout();await assert.rejects(second,/timeout/);
 const third=update.update({instructions:'c'});update.stop();await assert.rejects(third,/stopped/);
 assert.ok(sent.every(e=>e.type==='session.update'));
});

test('late guide acknowledgement synchronizes the topic without reconnecting or losing the next update',async()=>{
 const sent=[],applied=[];let timeout;
 const update=voiceGuideUpdate(e=>sent.push(e),{schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 const first=update.update({instructions:'finance'},()=>applied.push('finance'));
 timeout();await assert.rejects(first,/timeout/);
 const second=update.update({instructions:'planning'},()=>applied.push('planning'));
 assert.equal(update.event({type:'session.updated',session:{instructions:'finance'}}),true);
 assert.equal(update.event({type:'session.updated',session:{instructions:'planning'}}),true);
 await second;assert.deepEqual(applied,['finance','planning']);
 assert.ok(sent.every(event=>event.type==='session.update'));
});

test('a late rejected topic update is consumed instead of terminating the live call',async()=>{
 let timeout;const events=[];
 const update=voiceGuideUpdate(event=>events.push(event),{schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 const result=update.update({instructions:'applications'});timeout();await assert.rejects(result,/timeout/);
 assert.equal(update.event({type:'error',error:{event_id:events[0].event_id,code:'invalid_value'}}),true);
 assert.equal(update.event({type:'error',error:{event_id:'unrelated',code:'invalid_value'}}),false);
});

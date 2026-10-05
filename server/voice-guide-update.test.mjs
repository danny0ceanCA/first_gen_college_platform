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

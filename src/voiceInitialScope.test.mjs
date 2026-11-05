import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceInitialScope} from './voiceInitialScope.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('an in-flight selection survives conversation and duplicate selection without a second load',async()=>{
 const selection=voiceInitialScope(),request=deferred();let loads=0,current;
 const load=async guard=>{loads++;current=guard;return request.promise;};
 const first=selection.select('aiden',load);await tick();
 // Conversation is deliberately not used as a revocation signal. A duplicate
 // authorized tool request shares the work instead of restarting it.
 const duplicate=selection.select('aiden',load);
 assert.equal(current(),true);assert.equal(loads,1);
 request.resolve(true);assert.deepEqual(await first,{accepted:true,superseded:false});assert.deepEqual(await duplicate,{accepted:true,superseded:false});
});
test('an explicit different selection cannot be confirmed by the older slow response',async()=>{
 const selection=voiceInitialScope(),old=deferred(),next=deferred();let oldCurrent,newCurrent;
 const first=selection.select('aiden',async guard=>{oldCurrent=guard;return old.promise;});await tick();
 const second=selection.select('elodie',async guard=>{newCurrent=guard;return next.promise;});await tick();
 assert.equal(oldCurrent(),false);assert.equal(newCurrent,undefined,'do not collide with the busy configuration stream');
 old.resolve(true);assert.deepEqual(await first,{accepted:false,superseded:true});await tick();assert.equal(newCurrent(),true);
 next.resolve(true);assert.deepEqual(await second,{accepted:true,superseded:false});
});
test('closure invalidates loading and late configuration callbacks; failed loads may be retried',async()=>{
 const selection=voiceInitialScope(),request=deferred();let current;
 const pending=selection.select(null,async guard=>{current=guard;return request.promise;});await tick();selection.stop();
 request.resolve(true);assert.deepEqual(await pending,{accepted:false,superseded:true});assert.equal(current(),false);
 assert.deepEqual(await selection.select(null,async()=>false),{accepted:false,superseded:false});
 assert.deepEqual(await selection.select(null,async()=>true),{accepted:true,superseded:false});
});

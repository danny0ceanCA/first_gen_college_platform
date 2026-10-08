import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceWakeLock} from '../src/voiceWakeLock.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function page(){const p=new EventTarget();p.visibilityState='visible';p.visible=value=>{p.visibilityState=value?'visible':'hidden';p.dispatchEvent(new Event('visibilitychange'));};return p;}
function lock(){const l=new EventTarget();l.released=false;l.releases=0;l.release=async()=>{l.releases++;l.released=true;l.dispatchEvent(new Event('release'));};return l;}
test('visible calls acquire a screen lock and stop releases it exactly once',async()=>{
 const p=page(),l=lock(),states=[],requests=[];
 const wake=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{request:async type=>{requests.push(type);return l;}}});
 await tick();assert.deepEqual(requests,['screen']);assert.deepEqual(states,['active']);
 p.visible(true);await tick();assert.equal(requests.length,1);
 wake.stop();wake.stop();assert.equal(l.releases,1);p.visible(false);p.visible(true);await tick();assert.equal(requests.length,1);
});
test('hide releases, return requests again, and device revocation does not trigger a retry loop',async()=>{
 const p=page(),locks=[],states=[];
 const wake=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{request:async()=>{const l=lock();locks.push(l);return l;}}});
 await tick();p.visible(false);assert.equal(locks[0].releases,1);assert.equal(states.at(-1),'hidden');
 p.visible(true);await tick();assert.equal(locks.length,2);await locks[1].release();await tick();assert.equal(states.at(-1),'unavailable');assert.equal(locks.length,2);wake.stop();
});
test('a late grant after hangup is released without setting state',async()=>{
 const p=page(),states=[],l=lock();let grant;
 const wake=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{request:()=>new Promise(resolve=>grant=resolve)}});
 wake.stop();grant(l);await tick();assert.equal(l.releases,1);assert.deepEqual(states,[]);
});
test('a grant from an old visibility cycle cannot replace the current lock',async()=>{
 const p=page(),grants=[],states=[],old=lock(),current=lock();
 const wake=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{request:()=>new Promise(resolve=>grants.push(resolve))}});
 p.visible(false);p.visible(true);grants[1](current);await tick();grants[0](old);await tick();
 assert.equal(old.releases,1);assert.equal(current.releases,0);assert.equal(states.at(-1),'active');wake.stop();assert.equal(current.releases,1);
});
test('unsupported and declined locks are nonfatal, hidden pages do not acquire',async()=>{
 const p=page(),states=[];
 const missing=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{}});assert.equal(states.at(-1),'unavailable');missing.stop();
 const denied=voiceWakeLock(s=>states.push(s),{document:p,wakeLock:{request:async()=>{throw Error('NotAllowedError');}}});await tick();assert.equal(states.at(-1),'unavailable');denied.stop();
 p.visible(false);let calls=0;const wake=voiceWakeLock(()=>{},{document:p,wakeLock:{request:async()=>{calls++;return lock();}}});await tick();assert.equal(calls,0);p.visible(true);await tick();assert.equal(calls,1);wake.stop();
});

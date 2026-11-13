import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceConnectionRecovery,voiceTransportProbe} from './voiceConnection.mjs';
function time(){
 let now=0,id=0;const timers=new Map();
 return {clock:()=>now,schedule(fn,delay){timers.set(++id,{at:now+delay,fn});return id;},cancel(id){timers.delete(id);},
  async advance(ms){const target=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await new Promise(r=>setImmediate(r));}now=target;await new Promise(r=>setImmediate(r));}};
}
for(const language of ['en','es']){
 test(`${language}: incoming media keeps a transient disconnection alive, then recovery keeps the same session`,async()=>{
  const t=time(),events=[];let ended=0;
  const r=voiceConnectionRecovery(()=>ended++,{...t,probe:async()=>({mediaProgress:true,controlOpen:true}),onEvent:e=>events.push(e)});
  r.change('connected');r.change('disconnected');await t.advance(8000);assert.equal(ended,0);assert.equal(events.at(-1).stage,'continued');
  await t.advance(4000);r.change('connected');await t.advance(40000);assert.equal(ended,0);assert.equal(events.at(-1).stage,'recovered');r.stop();
 });
 test(`${language}: media alone never keeps a broken control channel alive`,async()=>{
  const t=time();let ended=0;const r=voiceConnectionRecovery(()=>ended++,{...t,probe:async()=>({mediaProgress:true,controlOpen:false})});
  r.change('disconnected');await t.advance(8000);assert.equal(ended,1);
 });
}
test('a continuous state mismatch has a 30-second absolute recovery bound',async()=>{
 const t=time(),events=[];let ended=0;const r=voiceConnectionRecovery(()=>ended++,{...t,probe:async()=>({mediaProgress:true,controlOpen:true}),onEvent:e=>events.push(e)});
 r.change('disconnected');await t.advance(30000);assert.equal(ended,1);assert.equal(events.at(-1).reason,'recovery_limit');assert.equal(events.at(-1).durationMs,30000);
});
test('silent but advancing RTP counts; buffered player time and a first stats baseline do not',async()=>{
 let packets=10,bytes=100,id='local-only-id';const channel={readyState:'open'};
 const probe=voiceTransportProbe({getStats:async()=>new Map([[id,{id,type:'inbound-rtp',kind:'audio',packetsReceived:packets,bytesReceived:bytes,audioLevel:0,address:'never-log'}]])},channel);
 assert.equal((await probe()).mediaProgress,false);assert.equal((await probe()).mediaProgress,false);
 packets++;bytes+=20;const evidence=await probe();assert.deepEqual(evidence,{mediaProgress:true,controlOpen:true});assert.doesNotMatch(JSON.stringify(evidence),/local-only|address/);
 packets=0;bytes=0;assert.equal((await probe()).mediaProgress,false);id='new-stream';packets=50;bytes=500;assert.equal((await probe()).mediaProgress,false);
});
test('stuck stats terminate within the bounded probe timeout, and late data cannot revive a stopped call',async()=>{
 const t=time();let ended=0,resolve;const r=voiceConnectionRecovery(()=>ended++,{...t,probe:()=>new Promise(r=>{resolve=r;})});
 r.change('disconnected');await t.advance(9000);assert.equal(ended,1);resolve({mediaProgress:true,controlOpen:true});await t.advance(40000);assert.equal(ended,1);
});
test('recovery during a probe and cleanup ignore late results; terminal failure remains immediate',async()=>{
 const t=time();let ended=0,resolve;let count=0;
 const r=voiceConnectionRecovery(()=>ended++,{...t,probe:()=>++count===1?Promise.resolve({}):new Promise(r=>{resolve=r;})});
 r.change('disconnected');await t.advance(8000);r.change('connected');resolve({mediaProgress:false,controlOpen:false});await t.advance(1000);assert.equal(ended,0);
 r.change('disconnected');r.change('failed');assert.equal(ended,1);await t.advance(40000);assert.equal(ended,1);
});

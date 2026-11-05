import test from 'node:test';
import assert from 'node:assert/strict';
import {liveVoiceDiagnostics} from './live-voice-diagnostics.mjs';

function fixture(options={}){
 let time=0;const sent=[],events=[],timers=new Map();let next=0;
 const monitor=liveVoiceDiagnostics({requestedVoice:'marin',providerSessionId:'live-first',send:event=>sent.push(event),emit:event=>events.push(event),now:()=>time,
  id:()=>`probe-${++next}`,schedule:(fn,ms)=>{const timer=++next;timers.set(timer,{fn,at:time+ms});return timer;},cancel:timer=>timers.delete(timer),...options});
 return {monitor,sent,events,timers,advance(ms){time+=ms;for(const [id,timer]of timers)if(timer.at<=time){timers.delete(id);timer.fn();}}};
}
const resolved=(probe,voice='marin',id='live-first')=>({type:'session.updated',event_id:'provider-event',client_event_id:probe,session:{id,model:'gpt-live-1',audio:{output:{voice}},instructions:'private',delegation:{responses:{instructions:'private',tools:[{authorization:'secret'}]}}}});
test('one nonblocking sparse update confirms the provider voice without changing speech or startup settings',()=>{
 const f=fixture();f.monitor.start();f.monitor.start();
 assert.deepEqual(f.sent,[{type:'session.update',event_id:'probe-1',session:{}}]);
 assert.equal(f.events[0].status,'pending');assert.equal(f.events[0].providerVoice,null);
 f.advance(34);assert.equal(f.monitor.receive(resolved('probe-1')),true);
 assert.equal(f.events[1].status,'confirmed');assert.equal(f.events[1].providerVoice,'marin');assert.equal(f.events[1].durationMs,34);
 assert.equal(f.events[1].instructions,undefined);assert.equal(f.timers.size,0);
 assert.equal(f.monitor.receive(resolved('ordinary-update')),false,'ordinary updates still reach the application');
 assert.equal(f.events.length,2,'unchanged voice snapshots are deduplicated');
 assert.equal(f.monitor.receive(resolved('ordinary-update','cedar')),false);assert.equal(f.events[2].status,'mismatch');
 f.monitor.close();
});
test('missing confirmation, errors and timeout remain unknown and do not block or retry the call',()=>{
 const f=fixture();f.monitor.start();assert.equal(f.monitor.receive({type:'session.started'}),false);assert.equal(f.events.length,1);
 f.advance(5000);assert.equal(f.events.at(-1).status,'unconfirmed');assert.equal(f.events.at(-1).reason,'confirmation_timeout');assert.equal(f.sent.length,1);
 assert.equal(f.monitor.receive(resolved('late')),false);assert.equal(f.events.at(-1).status,'confirmed','a later real provider snapshot can still establish the voice');f.monitor.close();
 const e=fixture();e.monitor.start();assert.equal(e.monitor.receive({type:'error',error:{client_event_id:'probe-1',code:'invalid_update',message:'private'}}),true);
 assert.equal(e.events.at(-1).reason,'confirmation_rejected');assert.equal(e.events.at(-1).providerVoice,null);assert.equal(e.timers.size,0);assert.equal(e.sent.length,1);e.monitor.close();
 const missing=fixture();missing.monitor.start();missing.monitor.receive({type:'session.updated',client_event_id:'probe-1',session:{id:'live-first'}});
 assert.equal(missing.events.at(-1).reason,'voice_missing');assert.equal(missing.events.at(-1).providerVoice,null);missing.monitor.close();
});
test('reconnect uses a new confirmation and never inherits the prior voice',()=>{
 const first=fixture();first.monitor.start();first.monitor.receive(resolved('probe-1'));first.monitor.close();
 const reconnect=fixture({providerSessionId:'live-second'});reconnect.monitor.start();
 assert.equal(reconnect.events[0].providerVoice,null);assert.equal(reconnect.events[0].providerSessionId,'live-second');
 reconnect.monitor.receive(resolved('probe-1','cedar','live-second'));
 assert.equal(reconnect.events.at(-1).status,'mismatch');assert.equal(reconnect.events.at(-1).providerVoice,'cedar');reconnect.monitor.close();
});
test('diagnostic failures and close do not leak callbacks or confirmation from the wrong provider session',()=>{
 const f=fixture();f.monitor.start();f.monitor.receive(resolved('probe-1','marin','live-unrelated'));
 assert.equal(f.events.at(-1).status,'unconfirmed');assert.equal(f.events.at(-1).reason,'session_mismatch');f.monitor.close();
 const closed=fixture();closed.monitor.start();closed.monitor.close();assert.equal(closed.events.at(-1).reason,'connection_closed');assert.equal(closed.timers.size,0);
 const count=closed.events.length;closed.monitor.receive(resolved('probe-1'));closed.advance(10000);assert.equal(closed.events.length,count);
 const thrown=fixture({send:()=>{throw Error('disconnected');}});assert.doesNotThrow(()=>thrown.monitor.start());assert.equal(thrown.events.at(-1).reason,'confirmation_rejected');thrown.monitor.close();
});

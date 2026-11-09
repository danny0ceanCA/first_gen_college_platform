import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLiveAudioStats,startLiveAudioDiagnostics} from './liveAudioDiagnostics.mjs';
import {createVoiceCapture} from './voiceCapture.mjs';

const report=(...rows)=>new Map(rows.map((row,index)=>[row.id??String(index),row]));
const audioRow=(extra={})=>({id:'private-rtp-id',type:'inbound-rtp',kind:'audio',timestamp:1000,packetsReceived:100,packetsLost:2,totalSamplesReceived:48000,concealedSamples:960,jitterBufferDelay:960,jitterBufferEmittedCount:48000,...extra});

test('audio samples distinguish cumulative baselines from interval loss, concealment and buffering',()=>{
 const first=summarizeLiveAudioStats(report(audioRow()));
 assert.equal(first.summary.inbound[0].baseline,true);
 assert.deepEqual(first.summary.inbound[0].delta,{});
 const next=summarizeLiveAudioStats(report(audioRow({timestamp:3000,packetsReceived:198,packetsLost:4,totalSamplesReceived:144000,concealedSamples:2880,jitterBufferDelay:4800,jitterBufferEmittedCount:144000,jitter:.015})),first.previous).summary.inbound[0];
 assert.equal(next.baseline,false);assert.equal(next.intervalMs,2000);assert.equal(next.packetLossPercent,2);assert.equal(next.concealedPercent,2);assert.equal(next.jitterBufferMeanMs,40);assert.equal(next.jitterMs,15);
});

test('late packets can reduce loss without resetting metrics; stream counter resets establish a fresh baseline',()=>{
 const first=summarizeLiveAudioStats(report(audioRow()));
 const late=summarizeLiveAudioStats(report(audioRow({timestamp:3000,packetsReceived:202,packetsLost:-1})),first.previous);
 assert.equal(late.summary.inbound[0].counterReset,false);assert.equal(late.summary.inbound[0].delta.packetsLost,-3);assert.equal(late.summary.inbound[0].packetLossPercent,0);
 const reset=summarizeLiveAudioStats(report(audioRow({packetsReceived:5,packetsLost:0})),late.previous);
 assert.equal(reset.summary.inbound[0].counterReset,true);assert.equal(reset.summary.inbound[0].baseline,true);assert.deepEqual(reset.summary.inbound[0].delta,{});
 const changed=summarizeLiveAudioStats(report(audioRow({id:'new-stream'})),late.previous);
 assert.equal(changed.summary.inbound[0].baseline,true);assert.equal(changed.previous.has('private-rtp-id'),false);
});

test('missing stats remain unknown and only allowed inbound audio metrics can leave the report',()=>{
 const result=summarizeLiveAudioStats(report(
  {id:'secret',type:'inbound-rtp',mediaType:'audio',packetsReceived:3,jitter:NaN,concealedSamples:Infinity,ip:'192.0.2.1',trackIdentifier:'private-microphone',ssrc:123},
  {id:'video',type:'inbound-rtp',kind:'video',packetsReceived:10},
  {id:'remote',type:'inbound-rtp',kind:'audio',isRemote:true},
  {id:'candidate',type:'local-candidate',address:'192.0.2.1'},
  {id:'cert',type:'certificate',base64Certificate:'secret'}
 ));
 assert.equal(result.summary.streamCount,1);assert.deepEqual(result.summary.inbound[0],{baseline:true,counterReset:false,totals:{packetsReceived:3},delta:{}});
 assert.doesNotMatch(JSON.stringify(result.summary),/192\.0|secret|private-microphone|trackIdentifier|ssrc|certificate/);
});

class Target extends EventTarget{
 constructor(fields={}){super();Object.assign(this,fields);this.listeners=0;}
 addEventListener(...args){this.listeners++;super.addEventListener(...args);}
 removeEventListener(...args){this.listeners--;super.removeEventListener(...args);}
 fire(type,fields={}){const event=new Event(type);Object.assign(event,fields);this.dispatchEvent(event);}
}
function harness(options={}){
 let time=0,id=0;const pending=new Map(),events=[];
 const pc=new Target({connectionState:'connected',iceConnectionState:'connected',getStats:async()=>report(audioRow()),getReceivers:()=>[]});
 const audio=new Target({paused:false,muted:false,volume:1,readyState:4,currentTime:5,networkState:2});
 const page=new Target({visibilityState:'visible'});
 const monitor=startLiveAudioDiagnostics({pc,audio,document:page,enabled:true,onEvent:(event,details)=>events.push({event,details}),clock:()=>time,schedule:(callback,ms)=>{const key=++id;pending.set(key,{callback,at:time+ms});return key;},cancel:key=>pending.delete(key),...options});
 async function advance(ms){time+=ms;for(const [key,value] of [...pending])if(value.at<=time){pending.delete(key);value.callback();}await Promise.resolve();await Promise.resolve();}
 return {pc,audio,page,events,pending,monitor,advance};
}

test('disabled diagnostics do no polling or registration',async()=>{
 let touched=0;const monitor=startLiveAudioDiagnostics({pc:{getStats(){touched++;},addEventListener(){touched++;}},enabled:false,schedule(){touched++;},onEvent(){touched++;}});
 await monitor.sample();monitor.stop();assert.equal(touched,0);
});

test('sustained audio degradation is reported locally even without capture, then clears',async()=>{
 const changes=[];
 const h=harness({enabled:false,onQuality:value=>changes.push(value)});
 let received=100,lost=0;
 h.pc.getStats=async()=>report(audioRow({packetsReceived:received,packetsLost:lost}));
 try{
  await h.monitor.sample();
  for(let i=0;i<2;i++){received+=80;lost+=20;await h.monitor.sample();}
  assert.deepEqual(changes,[true]);
  for(let i=0;i<3;i++){received+=100;await h.monitor.sample();}
  assert.deepEqual(changes,[true,false]);
  assert.deepEqual(h.events,[]);
 }finally{h.monitor.stop();}
});

test('samples serialize one pending getStats, time out diagnostically, and ignore completion after cleanup',async()=>{
 let resolve,calls=0;const h=harness();h.pc.getStats=()=>{calls++;return new Promise(done=>{resolve=done;});};
 await h.advance(2000);void h.monitor.sample();assert.equal(calls,1);
 await h.advance(5000);assert.equal(calls,1);assert.equal(h.events.filter(x=>x.event==='audio_stats_unavailable'&&x.details.code==='timeout').length,1);
 h.monitor.stop();const count=h.events.length;assert.equal(h.pc.listeners,0);assert.equal(h.audio.listeners,0);assert.equal(h.page.listeners,0);assert.equal(h.pending.size,0);
 resolve(report(audioRow()));await Promise.resolve();await Promise.resolve();assert.equal(h.events.length,count);assert.equal(h.pending.size,0);
});

test('observes media and remote track events without calling play, pause, muting or modifying peer handlers',async()=>{
 let mediaChanges=0;const h=harness({getAudioContextState:()=> 'interrupted'});h.audio.play=()=>{mediaChanges++;};h.audio.pause=()=>{mediaChanges++;};const original=()=>{};h.pc.ontrack=original;
 h.audio.fire('waiting');h.audio.error={code:3,message:'private URL or device'};h.audio.fire('error');h.page.visibilityState='hidden';h.page.fire('visibilitychange');
 const track=new Target({kind:'audio',enabled:true,muted:false,readyState:'live',label:'Private headset'});h.pc.fire('track',{track});track.muted=true;track.fire('mute');
 await h.advance(2000);
 assert.ok(h.events.some(x=>x.event==='audio_transport_sample'&&x.details.visibility==='hidden'&&x.details.audioContextState==='interrupted'));
 assert.ok(h.events.some(x=>x.event==='audio_playback_event'&&x.details.operation==='error'&&x.details.errorCode===3));
 assert.ok(h.events.some(x=>x.event==='audio_track_event'&&x.details.operation==='mute'&&x.details.muted));
 assert.equal(mediaChanges,0);assert.equal(h.audio.muted,false);assert.equal(h.pc.ontrack,original);assert.doesNotMatch(JSON.stringify(h.events),/Private headset|private URL/);
 h.monitor.stop();assert.equal(track.listeners,0);
});

test('sample and event budgets bound diagnostic work and logging failures cannot affect playback',async()=>{
 const h=harness({maxSamples:2,maxEvents:4});for(let i=0;i<20;i++)h.audio.fire('waiting');
 await h.advance(2000);await h.advance(2000);await h.advance(2000);
 assert.equal(h.events.filter(x=>x.event==='audio_transport_sample').length,2);assert.ok(h.events.filter(x=>x.event!=='audio_transport_sample').length<=4);assert.equal(h.pending.size,0);h.monitor.stop();
 const failure=harness({onEvent(){throw Error('upload unavailable');},maxSamples:1});await failure.advance(2000);failure.monitor.stop();assert.equal(failure.pending.size,0);
});

test('reports delayed browser scheduling separately from network jitter and records playback rate',async()=>{
 const h=harness();h.audio.playbackRate=1;await h.advance(3500);
 const sample=h.events.find(x=>x.event==='audio_transport_sample').details;
 assert.equal(sample.schedulerDelayMs,1500);assert.equal(sample.statsCollectionMs,0);assert.equal(sample.playbackRate,1);h.monitor.stop();
});

test('unsupported stats and rejected requests are diagnostic failures rather than playback failures',async()=>{
 const unsupported=harness();unsupported.pc.getStats=undefined;await unsupported.advance(2000);assert.ok(unsupported.events.some(x=>x.details.code==='unsupported'));assert.equal(unsupported.pending.size,0);unsupported.monitor.stop();
 const rejected=harness({maxSamples:1});rejected.pc.getStats=async()=>{throw Error('secret transport address');};await rejected.advance(2000);assert.ok(rejected.events.some(x=>x.details.code==='failed'));assert.doesNotMatch(JSON.stringify(rejected.events),/secret transport/);assert.equal(rejected.pending.size,0);rejected.monitor.stop();
});

test('audio observations fit the opt-in private archive and share batched uploads',async()=>{
 const batches=[],archive=createVoiceCapture(async batch=>{batches.push(batch);});
 const scope={subject:'test-account',sessionId:'00000000-0000-4000-8000-000000000001',attemptId:'00000000-0000-4000-8000-000000000002'};
 archive.enable(true);
 const h=harness({onEvent:(event,details)=>archive.event({type:'diagnostic',event,details},scope)});
 await h.advance(2000);await h.advance(2000);assert.equal(batches.length,0);
 h.monitor.stop();await archive.flush();
 assert.equal(batches.length,1);assert.equal(batches[0].filter(entry=>entry.data.event==='audio_transport_sample').length,2);
 assert.ok(batches[0].every(entry=>entry.sessionId===scope.sessionId&&entry.attemptId===scope.attemptId&&entry.subject===scope.subject));
 assert.ok(batches[0].some(entry=>entry.data.event==='audio_diagnostics_stopped'));
 const count=batches[0].length;h.audio.fire('waiting');await archive.flush();assert.equal(batches.length,1);assert.equal(batches[0].length,count);
});

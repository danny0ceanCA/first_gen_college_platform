// Read-only browser observations. No audio, transcript, ICE addresses, device
// labels, SDP or browser identifiers leave this module. In particular, an RTP
// sample is not proof of audible playback (Live's stream also carries silence).
const counters=['packetsReceived','packetsDiscarded','bytesReceived','totalSamplesReceived','concealedSamples','silentConcealedSamples','concealmentEvents','jitterBufferDelay','jitterBufferEmittedCount','insertedSamplesForDeceleration','removedSamplesForAcceleration','totalAudioEnergy','totalSamplesDuration'];
const number=value=>typeof value==='number'&&Number.isFinite(value);
const rounded=value=>Math.round(value*1000)/1000;
const known=(value,values)=>values.includes(value)?value:'unknown';

export function summarizeLiveAudioStats(report,previous=new Map()){
 const next=new Map(),inbound=[];
 // Keep stream IDs in memory only. getStats() also contains private candidates
 // and certificates: never serialize the report or spread a report entry.
 report?.forEach?.(row=>{
  if(inbound.length>=4||row.type!=='inbound-rtp'||row.isRemote===true||(row.kind??row.mediaType)!=='audio'||typeof row.id!=='string')return;
  const saved=previous.get(row.id),current={};
  for(const key of counters)if(number(row[key])&&row[key]>=0)current[key]=row[key];
  if(number(row.packetsLost))current.packetsLost=row.packetsLost;
  if(number(row.timestamp))current.timestamp=row.timestamp;
  // A counter rollback is a new baseline; late packets may legitimately make
  // packetsLost decrease, so that field alone must not reset every counter.
  const reset=!!saved&&counters.some(key=>number(current[key])&&number(saved[key])&&current[key]<saved[key]);
  const before=reset?undefined:saved,delta={};
  if(before)for(const key of [...counters,'packetsLost'])if(number(current[key])&&number(before[key]))delta[key]=rounded(current[key]-before[key]);
  const item={baseline:!before,counterReset:reset,totals:{},delta};
  for(const key of [...counters,'packetsLost'])if(number(current[key]))item.totals[key]=rounded(current[key]);
  if(number(row.jitter)&&row.jitter>=0)item.jitterMs=rounded(row.jitter*1000);
  if(number(row.audioLevel)&&row.audioLevel>=0&&row.audioLevel<=1)item.audioLevel=rounded(row.audioLevel);
  if(before&&number(current.timestamp)&&number(before.timestamp))item.intervalMs=rounded(Math.max(0,current.timestamp-before.timestamp));
  if(delta.jitterBufferEmittedCount>0&&number(delta.jitterBufferDelay))item.jitterBufferMeanMs=rounded(delta.jitterBufferDelay/delta.jitterBufferEmittedCount*1000);
  if(delta.totalSamplesReceived>0&&number(delta.concealedSamples))item.concealedPercent=rounded(Math.min(100,delta.concealedSamples/delta.totalSamplesReceived*100));
  if(number(delta.packetsReceived)&&number(delta.packetsLost)&&delta.packetsReceived+Math.max(0,delta.packetsLost)>0)item.packetLossPercent=rounded(Math.max(0,delta.packetsLost)/(delta.packetsReceived+Math.max(0,delta.packetsLost))*100);
  if(delta.totalSamplesDuration>0&&number(delta.totalAudioEnergy))item.receivedRms=rounded(Math.sqrt(Math.max(0,delta.totalAudioEnergy)/delta.totalSamplesDuration));
  next.set(row.id,current);inbound.push(item);
 });
 return {summary:{streamCount:inbound.length,inbound},previous:next};
}

export function startLiveAudioDiagnostics({pc,audio,enabled=false,onEvent=()=>{},getAudioContextState=()=>undefined,document:page=globalThis.document,clock=()=>globalThis.performance?.now?.()??Date.now(),schedule=setTimeout,cancel=clearTimeout,intervalMs=2000,maxSamples=450,maxEvents=150}={}){
 if(!enabled)return {stop(){},sample:async()=>{}};
 const started=clock(),listeners=[],tracks=new Set();
 let stopped=false,busy=false,timer,timeoutTimer,nextSampleAt,previous=new Map(),samples=0,events=0,lastContext;
 function emit(event,details={},sample=false){
  if(stopped)return;
  if(!sample&&events++>=maxEvents)return;
  try{onEvent(event,{elapsedMs:Math.max(0,Math.round(clock()-started)),...details});}catch{}
 }
 function mediaState(){return {paused:audio?.paused===true,muted:audio?.muted===true,volume:number(audio?.volume)?audio.volume:undefined,playbackRate:number(audio?.playbackRate)?audio.playbackRate:undefined,readyState:number(audio?.readyState)?audio.readyState:undefined,networkState:number(audio?.networkState)?audio.networkState:undefined,currentTime:number(audio?.currentTime)?rounded(audio.currentTime):undefined};}
 function state(){
  let context;try{context=getAudioContextState();}catch{}
  return {connectionState:known(pc?.connectionState,['new','connecting','connected','disconnected','failed','closed']),iceState:known(pc?.iceConnectionState,['new','checking','connected','completed','failed','disconnected','closed']),visibility:known(page?.visibilityState,['visible','hidden']),audioContextState:known(context,['running','suspended','interrupted','closed']),...mediaState()};
 }
 function listen(target,event,fn){if(!target?.addEventListener)return;target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));}
 function attachTrack(track){
  if(!track||track.kind!=='audio'||tracks.has(track)||tracks.size>=4)return;
  tracks.add(track);
  const trackState=()=>({muted:track.muted===true,enabled:track.enabled===true,readyState:known(track.readyState,['live','ended'])});
  emit('audio_track_event',{operation:'attached',...trackState()});
  for(const operation of ['mute','unmute','ended'])listen(track,operation,()=>emit('audio_track_event',{operation,...trackState()}));
 }
 function plan(){if(!stopped&&samples<maxSamples){const delay=Math.max(1000,intervalMs);nextSampleAt=clock()+delay;timer=schedule(()=>{timer=undefined;void sample();},delay);}}
 async function sample(){
  if(stopped||busy||samples>=maxSamples)return;
  if(timer!==undefined){cancel(timer);timer=undefined;}
  if(typeof pc?.getStats!=='function'){emit('audio_stats_unavailable',{code:'unsupported'});samples=maxSamples;return;}
  busy=true;const requestedAt=clock(),schedulerDelayMs=nextSampleAt===undefined?0:Math.max(0,Math.round(requestedAt-nextSampleAt));nextSampleAt=undefined;
  // A stuck getStats must never cause overlapping polls. Report it once, keep
  // waiting for that call, and let stop() discard its eventual completion.
  timeoutTimer=schedule(()=>{timeoutTimer=undefined;emit('audio_stats_unavailable',{code:'timeout'});},5000);
  try{
   const report=await pc.getStats();if(stopped)return;
   const collected=summarizeLiveAudioStats(report,previous);previous=collected.previous;samples++;
   const current=state();
   if(current.audioContextState!==lastContext){lastContext=current.audioContextState;emit('audio_browser_state',{operation:'audio_context_state',...current});}
   emit('audio_transport_sample',{sample:samples,schedulerDelayMs,statsCollectionMs:Math.max(0,Math.round(clock()-requestedAt)),...current,...collected.summary},true);
   if(samples>=maxSamples)emit('audio_stats_complete',{reason:'sample_limit',sampleCount:samples});
  }catch{emit('audio_stats_unavailable',{code:'failed'});samples++;}
  finally{busy=false;if(timeoutTimer!==undefined){cancel(timeoutTimer);timeoutTimer=undefined;}plan();}
 }
 for(const operation of ['playing','pause','waiting','stalled','suspend','emptied','ended','error','volumechange','ratechange'])listen(audio,operation,()=>emit('audio_playback_event',{operation,...mediaState(),...(operation==='error'?{errorCode:number(audio?.error?.code)?audio.error.code:undefined}:{})}));
 for(const operation of ['connectionstatechange','iceconnectionstatechange'])listen(pc,operation,()=>emit('audio_browser_state',{operation,...state()}));
 listen(page,'visibilitychange',()=>emit('audio_browser_state',{operation:'visibilitychange',...state()}));
 listen(pc,'track',event=>attachTrack(event.track));
 try{for(const receiver of pc?.getReceivers?.()||[])attachTrack(receiver.track);}catch{}
 emit('audio_diagnostics_started',{intervalMs:Math.max(1000,intervalMs),maxSamples,...state()});
 plan();
 return {sample,stop(){
  if(stopped)return;
  emit('audio_diagnostics_stopped',{sampleCount:samples,...state()});stopped=true;
  if(timer!==undefined)cancel(timer);if(timeoutTimer!==undefined)cancel(timeoutTimer);
  for(const remove of listeners)try{remove();}catch{}
  listeners.length=0;tracks.clear();previous.clear();
 }};
}

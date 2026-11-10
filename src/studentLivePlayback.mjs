// The Live stream is continuous, including silence. Observe actual samples in
// addition to transcript inactivity before considering an utterance idle.
export function studentLivePlayback({clock=Date.now,AudioContext=globalThis.AudioContext,onSound=()=>{},onSpeaking=()=>{}}={}){
 let context,source,analyser,lastSound=clock(),samples,audibleVersion=0,speaking=false,ducked;
 function report(value){if(value!==speaking){speaking=value;try{onSpeaking(value);}catch{}}}
 async function prime(){if(!AudioContext)return;try{context??=new AudioContext();await context.resume();}catch{}}
 function restoreVolume(){
  if(!ducked)return;
  const {audio,original,lowered,timer}=ducked;ducked=undefined;clearTimeout(timer);
  if(audio.volume===lowered)audio.volume=original;
 }
 return {
  prime,
  duck(audio){
   if(ducked||!audio||audio.paused||audio.muted||!audio.volume)return;
   const original=audio.volume,lowered=original*.15;
   audio.volume=lowered;
   if(audio.volume===lowered)ducked={audio,original,lowered,timer:setTimeout(restoreVolume,800)};
  },
  restoreVolume,
  async attach(stream){
   if(!AudioContext)return;
   try{await prime();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=512;samples=new Float32Array(analyser.fftSize);source.connect(analyser);}catch{analyser=undefined;}
  },
  idle(){
   if(!analyser||context?.state!=='running'){report(false);return false;}
   analyser.getFloatTimeDomainData(samples);let energy=0;for(const sample of samples)energy+=sample*sample;
   if(Math.sqrt(energy/samples.length)>.002){lastSound=clock();audibleVersion++;report(true);try{onSound();}catch{}}
   else if(clock()-lastSound>350)report(false);
   return clock()-lastSound>1200;
  },
  audibleVersion:()=>audibleVersion,
  // Diagnostics observe the existing analyser context without creating or
  // resuming an AudioContext and without touching the playback element.
  contextState:()=>context?.state,
  stop(){restoreVolume();report(false);source?.disconnect();void context?.close().catch(()=>{});analyser=undefined;},
 };
}

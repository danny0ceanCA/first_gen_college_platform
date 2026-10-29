// The Live stream is continuous, including silence. Observe actual samples in
// addition to transcript inactivity before considering an utterance idle.
export function studentLivePlayback({clock=Date.now,AudioContext=globalThis.AudioContext}={}){
 let context,source,analyser,lastSound=clock(),samples;
 async function prime(){if(!AudioContext)return;try{context??=new AudioContext();await context.resume();}catch{}}
 return {
  prime,
  async attach(stream){
   if(!AudioContext)return;
   try{await prime();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=512;samples=new Float32Array(analyser.fftSize);source.connect(analyser);}catch{analyser=undefined;}
  },
  idle(){
   if(!analyser||context?.state!=='running')return false;
   analyser.getFloatTimeDomainData(samples);let energy=0;for(const sample of samples)energy+=sample*sample;
   if(Math.sqrt(energy/samples.length)>.002)lastSound=clock();
   return clock()-lastSound>1200;
  },
  stop(){source?.disconnect();void context?.close().catch(()=>{});analyser=undefined;},
 };
}

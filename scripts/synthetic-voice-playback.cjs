// Synthetic transport only. Real controllers still require observed samples and
// a drained output stream; a transcript or idle silence alone is insufficient.
const assert=require('node:assert/strict');
async function installSyntheticPlayback(page){
 await page.addInitScript(()=>{
  window.syntheticAudioUntil=0;
  Object.defineProperty(HTMLMediaElement.prototype,'paused',{configurable:true,get:()=>false});
  window.AudioContext=class{
   state='running';resume(){return Promise.resolve();}
   createMediaStreamSource(){return {connect(){},disconnect(){}};}
   createAnalyser(){return {fftSize:512,getFloatTimeDomainData:buffer=>buffer.fill(Date.now()<window.syntheticAudioUntil?0.05:0)};}
   close(){return Promise.resolve();}
  };
 });
}
async function played(page,entry,text,path){
 const presented=page.waitForResponse(r=>r.url().endsWith(path)&&r.request().postDataJSON()?.action==='present'&&r.request().postDataJSON()?.presentation===text);
 await page.evaluate(({entry,text})=>{
  if(entry==='live'){window.syntheticAudioUntil=Date.now()+500;window.emit({type:'session.output_transcript.delta',delta:text});}
  else{const id=crypto.randomUUID();window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});window.emit({type:'output_audio_buffer.stopped',response_id:id});}
 },{entry,text});
 assert.equal((await (await presented).json()).status,path==='/api/student-follow-up-voice'?'recorded':'presented');
}
module.exports={installSyntheticPlayback,played};

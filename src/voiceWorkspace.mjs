export const workspaceGuide=topic=>topic==='costs'?'finance':topic==='applications'?'admissions':'planning';
export const planTopic=category=>category==='applications'?'applications':category==='financial'?'costs':category==='transfer'||category==='courses'?'transfer':'options';

// A selection waits for a quiet turn. It never cancels output or recreates audio.
export function voiceWorkspaceQueue({busy,apply,onPending=()=>{},onError=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let pending,working=false,stopped=false,timer;
 async function flush(){
  timer=undefined;if(stopped||working||!pending)return;
  if(busy()){timer=schedule(flush,150);return;}
  const selection=pending;pending=undefined;working=true;
  try{await apply(selection);}catch{if(!stopped)onError();}
  finally{working=false;if(!stopped){onPending(!!pending);if(pending)void flush();}}
 }
 return {select(selection){if(stopped)return;pending=selection;onPending(true);if(!timer)void flush();},stop(){stopped=true;pending=undefined;if(timer)cancel(timer);}};
}

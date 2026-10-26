const wait=(ms,signal)=>new Promise((resolve,reject)=>{
 const done=()=>{signal.removeEventListener('abort',stop);resolve();};
 const timer=setTimeout(done,ms),stop=()=>{clearTimeout(timer);reject(signal.reason);};
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
});

// A failed older job is not a reason to stop observing a newer conversation.
// Publish every successful load, including partial results, until pending work
// finishes. Scope changes/privacy/unmount cancel both requests and polling.
export async function refreshBinderNotes({request,onData,onFailure=()=>{},signal,action='sync',pause=wait}){
 let result;
 do{
  signal.throwIfAborted();result=await request(action,signal);signal.throwIfAborted();
  onData(result);
  onFailure(result.background?.failed?'binder_processing_failed':null);
  if(result.background?.enabled){
   action='load';
   if(result.pendingCount>0)await pause(Math.max(1000,Math.min(10000,result.background.retryAfterMs||3000)),signal);
  }
 }while(result.pendingCount>0);
 return result;
}

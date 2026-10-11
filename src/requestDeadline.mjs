// Bound the whole operation, including token acquisition and response parsing.
// Aborting also stops fetch; the race handles dependencies that ignore the signal.
export function withRequestDeadline(operation,{signal,timeoutMs=10000}={}){
 const controller=new AbortController();
 const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let timer,onAbort;
 const aborted=new Promise((_,reject)=>{
  onAbort=()=>reject(combined.reason||new DOMException('Request aborted','AbortError'));
  combined.addEventListener('abort',onAbort,{once:true});
  if(combined.aborted)onAbort();
 });
 timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeoutMs);
 const task=Promise.resolve().then(()=>{combined.throwIfAborted();return operation(combined);});
 return Promise.race([task,aborted]).finally(()=>{clearTimeout(timer);combined.removeEventListener('abort',onAbort);});
}

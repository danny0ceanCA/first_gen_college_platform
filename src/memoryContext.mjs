import {withRequestDeadline} from './requestDeadline.mjs';
const eventName='origen-memory-context',storageKey='origen.memory.change';
// Cross-tab notifications contain only identifiers, never private memory text.
export function notifyMemoryContext(subject,studentId){
 const detail={subject,studentId,nonce:crypto.randomUUID()};
 window.dispatchEvent(new CustomEvent(eventName,{detail}));
 try{localStorage.setItem(storageKey,JSON.stringify(detail));localStorage.removeItem(storageKey);}catch{/* Polling still covers other tabs/devices. */}
}
export function subscribeMemoryContext(subject,callback){
 const receive=value=>{if(value?.subject===subject&&(value.studentId===null||typeof value.studentId==='string'))callback(value.studentId);};
 const local=e=>receive(e.detail),remote=e=>{if(e.key===storageKey&&e.newValue)try{receive(JSON.parse(e.newValue));}catch{/* Ignore malformed browser events. */}};
 window.addEventListener(eventName,local);window.addEventListener('storage',remote);
 return()=>{window.removeEventListener(eventName,local);window.removeEventListener('storage',remote);};
}
export function watchMemoryRevision({revision,read,onChange,onUnavailable,intervalMs=5000}){
 const controller=new AbortController();let timer;
 const check=async()=>{
  try{
   const current=await withRequestDeadline(read,{signal:controller.signal,timeoutMs:5000});
   if(controller.signal.aborted)return;
   if(current!==revision){onChange();return;}
  }catch{if(!controller.signal.aborted)onUnavailable();return;}
  timer=setTimeout(check,intervalMs);
 };
 timer=setTimeout(check,intervalMs);
 return()=>{controller.abort();clearTimeout(timer);};
}

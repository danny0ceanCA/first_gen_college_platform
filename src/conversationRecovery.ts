import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
// Consent lasts only for this signed-in browser session, never in storage.
export const recoveryChoice={enabled:false,available:false,epoch:0,stopping:false};
export const activeCheckpoints=new Set<string>();
export async function recoveryRequest(body:Record<string,unknown>){
 const lease=browserPrivacy.capture(),forgotten=new AbortController();
 const unsubscribe=browserPrivacy.subscribe(event=>{if(event.type==='forget')forgotten.abort();});
 try{
  const response=await apiFetch('/api/conversation-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([lease.signal,forgotten.signal,AbortSignal.timeout(15000)])});
  const data=await response.json();lease.assert();forgotten.signal.throwIfAborted();if(!response.ok)throw Object.assign(new Error(data.error||'recovery_unavailable'),{status:response.status});return data;
 }finally{unsubscribe();lease.release();}
}
export async function endRecoverySession(getToken:()=>Promise<string|undefined>){
 recoveryChoice.stopping=true;
 try{
  // A permission-expired browser session still needs a cleanup-only logout.
  // This request carries no conversation data and never reads private content.
  const token=await getToken();if(!token)throw new Error('authentication_required');const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
  const response=await fetch(`${base}/api/conversation-recovery`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'stop'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(new Error('recovery_stop_failed'),{status:response.status});
  if((await response.json()).stopped!==true)throw new Error('recovery_stop_unconfirmed');
 }catch(error){
  // Older deployments have no temporary recovery endpoint/data.
  if(!(error instanceof Error&&'status' in error&&error.status===404)){recoveryChoice.stopping=false;throw error;}
 }
}
browserPrivacy.subscribe(event=>{if(event.type!=='forget'){recoveryChoice.enabled=false;recoveryChoice.available=false;recoveryChoice.epoch=0;recoveryChoice.stopping=true;activeCheckpoints.clear();}});

import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {notifyMemoryContext} from './memoryContext.mjs';

type Undo={operationId:string;id:string;version:number;before:Record<string,unknown>;expiresAt:string};
type Result={id:string;version:number;undo:Undo|null;withdrawnSuggestions:number};
// Prior text and uncertain request payloads exist only in this mounted view.
// Retrying the same intent keeps its operation ID after a lost response.
export default function useBinderCorrections(store:'memory'|'note',studentId:string|null){
 const {user}=useAuth0();
 const [undo,setUndo]=useState<Undo|null>(null),[withdrawn,setWithdrawn]=useState(0);
 const pending=useRef<{key:string;body:Record<string,unknown>}|undefined>(undefined),epoch=useRef(0),controllers=useRef(new Set<AbortController>());
 const scope=JSON.stringify([user?.sub,studentId]);
 useEffect(()=>{
  const reset=()=>{epoch.current++;pending.current=undefined;setUndo(null);setWithdrawn(0);for(const c of controllers.current)c.abort();};
  reset();const unsubscribe=browserPrivacy.subscribe(reset);
  return()=>{unsubscribe();reset();};
 },[scope]);
 useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>{pending.current=undefined;setUndo(null);},Math.max(0,Date.parse(undo.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[undo]);
 async function send(body:Record<string,unknown>){
  const key=JSON.stringify({...body,studentId,store});
  if(pending.current?.key!==key)pending.current={key,body:{...body,studentId,store,operationId:crypto.randomUUID()}};
  const current=pending.current,version=epoch.current,controller=new AbortController(),lease=browserPrivacy.capture({studentId});controllers.current.add(controller);
  try{
   const response=await apiFetch('/api/binder-changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(current.body),signal:AbortSignal.any([controller.signal,lease.signal,AbortSignal.timeout(30000)])});
   const result=await response.json();lease.assert();if(version!==epoch.current)throw new Error('account_changed');
   if(!response.ok)throw new Error(result.error||'correction_unavailable');
   pending.current=undefined;setUndo(result.undo);setWithdrawn(result.withdrawnSuggestions);
   if(user?.sub)notifyMemoryContext(user.sub,studentId);
   return result as Result;
  }finally{controllers.current.delete(controller);lease.release();}
 }
 return {undo,withdrawn,
  change:(body:Record<string,unknown>,before:unknown)=>send({action:body.action,id:body.id,version:body.version,before,...(body.action==='update'?{value:body.memory||body.note}:{})}),
  restore:()=>{if(!undo)throw new Error('undo_unavailable');return send({action:'undo',id:undo.id,version:undo.version,before:undo.before,undoOf:undo.operationId});},
 };
}

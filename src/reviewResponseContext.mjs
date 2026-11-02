import {validateReviewResponseReference} from './reviewResponseConnection.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
import {watchMemoryRevision} from './memoryContext.mjs';

// Holds only identifiers/revision hashes, never advice. Changing instructions
// does not erase provider-held context: invalidation ends the affected call.
export function reviewResponseContextGuard({verify,onInvalidate,onUnavailable,isCurrent=()=>true,signal,intervalMs=5000,maxSources=8}){
 const sources=new Map();let stopped=false,stopWatch;
 const alive=()=>!stopped&&!signal?.aborted&&isCurrent();
 const stop=()=>{if(stopped)return;stopped=true;stopWatch?.();sources.clear();signal?.removeEventListener('abort',stop);};
 signal?.addEventListener('abort',stop,{once:true});
 const invalidate=unavailable=>{if(!alive())return;stop();(unavailable?onUnavailable:onInvalidate)();};
 const check=async(guards,abort)=>withRequestDeadline(s=>verify(guards,s),{signal:abort||signal,timeoutMs:5000});
 return {
  async accept(value){
   if(!alive())return false;
   let guard;
   try{
    if(!value||Object.keys(value).some(k=>!['source','revision','mode'].includes(k))||!['focus','question'].includes(value.mode)||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision))throw new Error('invalid_context');
    guard={source:validateReviewResponseReference(value.source),revision:value.revision,mode:value.mode};
   }catch{invalidate(true);return false;}
   const key=`${guard.source.requestId}:${guard.mode}`,previous=sources.get(key);
   const changedVersion=()=>[...sources.values()].some(({guard:old})=>old.source.requestId===guard.source.requestId&&old.source.responseVersion!==guard.source.responseVersion);
   if(changedVersion()||previous&&previous.guard.revision!==guard.revision||!previous&&sources.size>=maxSources){invalidate(false);return false;}
   // Focus and spoken lookup have different guards. Both must remain current;
   // changing modes cannot discard an older, now invalid source permission.
   try{if((await check([...sources.entries()].filter(([id])=>id!==key).map(([,row])=>row.guard).concat(guard))).status!=='current'){invalidate(false);return false;}}
   catch{invalidate(true);return false;}
   if(!alive())return false;
   // Recheck after awaiting: concurrent reads cannot replace a newer guard.
   const latest=sources.get(key);
   if(changedVersion()||latest&&latest.guard.revision!==guard.revision){invalidate(false);return false;}
   if(!latest){
    if(sources.size>=maxSources){invalidate(false);return false;}
    sources.set(key,{guard});
    // One bounded verification request per poll, regardless of source count.
    if(!stopWatch)stopWatch=watchMemoryRevision({revision:1,intervalMs,read:async abort=>(await check([...sources.values()].map(row=>row.guard),abort)).status==='current'?1:0,onChange:()=>invalidate(false),onUnavailable:()=>invalidate(true)});
   }
   return true;
  },
  async verifyAll(){
   if(!alive())return false;
   if(!sources.size)return true;
   try{const result=await check([...sources.values()].map(row=>row.guard));if(!alive())return false;if(result.status!=='current'){invalidate(false);return false;}return true;}
   catch{invalidate(true);return false;}
  },
  stop,
 };
}

import {withRequestDeadline} from './requestDeadline.mjs';

// One coordinator per physical call. A newer spoken turn or explicit Cancel
// invalidates the whole old tool batch, including lookups not yet started.
export function voiceResearchRequest({signal,timeoutMs=45000}={}){
 let revision=0,active;
 const cancelled=()=>new DOMException('Research cancelled','AbortError');
 let invalidation=cancelled();
 return {
  revision:()=>revision,
  cancel(){revision++;invalidation=cancelled();active?.abort(invalidation);},
  async run(operation,expectedRevision=revision){
   if(expectedRevision!==revision)throw invalidation;
   signal?.throwIfAborted();
   const controller=new AbortController();
   active=controller;
   try{
    const result=await withRequestDeadline(operation,{signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,timeoutMs});
    if(expectedRevision!==revision)throw invalidation;
    return result;
   }catch(error){
    if(error?.name==='TimeoutError'&&expectedRevision===revision){revision++;invalidation=error;}
    throw error;
   }finally{if(active===controller)active=undefined;}
  },
 };
}

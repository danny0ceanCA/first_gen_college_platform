import {withRequestDeadline} from './requestDeadline.mjs';

// One coordinator per physical call. Ordinary speech leaves research running.
// Explicit cancellation invalidates the whole batch, including queued lookups.
export function voiceResearchRequest({signal,timeoutMs=45000}={}){
 let revision=0,active;
 const cancelled=()=>new DOMException('Research cancelled','AbortError');
 let invalidation=cancelled();
 const cancel=()=>{revision++;invalidation=cancelled();active?.abort(invalidation);};
 return {
  revision:()=>revision,
  cancel,
  spokenTurn(text){
   if(typeof text!=='string')return false;
   const command=text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[.!?,;:]+/g,' ').replace(/\s+/g,' ').trim();
   // Match a direct command, not discussion of cancelling an application or
   // a sentence such as "don't stop searching". The on-screen button remains
   // available for requests whose wording is ambiguous.
   const explicit=/^(?:please |por favor )?(?:(?:cancel|stop|end)(?: the| that| this| your)? (?:search|lookup|research|source check)|stop (?:searching|researching|looking (?:it|that) up)|(?:cancela|cancele|cancelar|deten|detenga|para|pare)(?: la| esa| esta)? (?:busqueda|consulta|investigacion)|(?:deja|deje) de (?:buscar|investigar))(?: please| por favor)?$/u;
   if(!explicit.test(command))return false;
   cancel();return true;
  },
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

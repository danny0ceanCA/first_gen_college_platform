import {voicePreparationSignature} from './voicePreparationScope.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';

// Per-workspace, memory-only rendezvous. Keep only an opaque server handle, not
// student context or credentials. Preparation never opens the microphone/model.
export function createVoicePreparation({now=Date.now,ttlMs=60000,timeoutMs=35000}={}){
 const entries=new Map();let owner;
 const remove=entry=>{if(entries.get(entry.key)===entry)entries.delete(entry.key);entry.abort.abort();};
 const clear=()=>{for(const entry of entries.values())entry.abort.abort();entries.clear();owner=undefined;};
 function warm(subject,input,load){
  if(owner!==subject){clear();owner=subject;}
  const key=voicePreparationSignature(input);
  for(const entry of entries.values())if(entry.expires<=now())remove(entry);
  if(entries.has(key))return entries.get(key);
  while(entries.size>=3)remove(entries.values().next().value);
  const entry={subject,key,abort:new AbortController(),expires:now()+ttlMs,promise:null};entries.set(key,entry);
  entry.promise=withRequestDeadline(load,{signal:entry.abort.signal,timeoutMs}).then(result=>{
   if(entries.get(key)!==entry||entry.abort.signal.aborted)return undefined;
   const id=result?.preparedContextId;
   if(typeof id!=='string'||!id){entry.expires=Math.min(entry.expires,now()+5000);return undefined;}
   // TTL starts at request initiation, conservatively before server storage.
   entry.expires=Math.min(entry.expires,now()+Math.min(ttlMs,result.expiresInMs||ttlMs));
   entry.id=entry.expires>now()?id:undefined;return entry.id;
  }).catch(()=>{entry.expires=Math.min(entry.expires,now()+5000);return undefined;});
  return entry;
 }
 return {
  consumeReady(subject,input){
   if(owner!==subject)return undefined;
   const entry=entries.get(voicePreparationSignature(input));
   if(!entry||entry.subject!==subject||!entry.id||entry.expires<=now()||entry.abort.signal.aborted)return undefined;
   const id=entry.id;remove(entry);return id;
  },
  warm(subject,input,load){return warm(subject,input,load).promise;},
  async consume(subject,input,load,signal){
   signal?.throwIfAborted();
   const entry=warm(subject,input,load);
   try{
    const id=await withRequestDeadline(()=>entry.promise,{signal,timeoutMs});
    if(entries.get(entry.key)!==entry||entry.expires<=now())return undefined;
    remove(entry);return id;
   }finally{if(signal?.aborted&&entries.get(entry.key)===entry)remove(entry);}
  },
  clear,
 };
}

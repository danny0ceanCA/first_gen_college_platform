import {onboardingUUID,onboardingEventName,sanitizeOnboardingMetadata} from './onboardingEventSchema.mjs';
const ttl=23*60*60*1000,maxEvents=250,maxVisits=10;
const important=new Set(['onboarding_opened','save_requested','save_failed','save_succeeded','home_reached','logout_selected','tracking_delivery_gap']);
const defaultSchedule=(job,ms)=>{const timer=setTimeout(job,ms);timer.unref?.();return timer;};
export function onboardingDelivery(send,{storage,scope,schedule=defaultSchedule,cancel=clearTimeout,now=Date.now,random=Math.random,onDelivered=()=>{}}={}){
 const prefix=scope?`origen.user.${scope}.onboarding-events.`:null;
 const records=new Map(),acknowledged=new Set(),losses={};let flight,timer,paused=false,blocked=false,failures=0,retryUntil=0,epoch=0;
 function loss(reason,n=1){losses[reason]=Math.min(2000,(losses[reason]||0)+n);}
 function clean(event){
  const time=Date.parse(event?.occurredAt);
  if(!event||!onboardingEventName(event.name)||!Number.isInteger(event.sequence)||event.sequence<1||event.sequence>2000||!Number.isFinite(time)||time>now()+300000){loss('invalid');return null;}
  if(time<now()-ttl){loss('expired');return null;}
  return {sequence:event.sequence,name:event.name,occurredAt:new Date(time).toISOString(),metadata:sanitizeOnboardingMetadata(event.metadata)};
 }
 function read(id){
  if(!prefix||!storage)return;
  let raw;try{raw=storage.getItem(prefix+id);}catch{return;}
  try{if(!raw)return;const parsed=JSON.parse(raw);
   if(parsed.version!==1||!Array.isArray(parsed.events)||parsed.events.length>maxEvents)throw new Error();
   const existing=records.get(id)||[],merged=new Map(existing.map(e=>[e.sequence,e]));
   for(const rawEvent of parsed.events){if(acknowledged.has(id+':'+rawEvent?.sequence))continue;const e=clean(rawEvent);if(e&&!merged.has(e.sequence))merged.set(e.sequence,e);}
   records.set(id,[...merged.values()].sort((a,b)=>a.sequence-b.sequence));
  }catch{loss('invalid');try{storage.removeItem(prefix+id);}catch{}}
 }
 function persist(id){if(!prefix||!storage)return;try{const events=records.get(id)||[];if(events.length)storage.setItem(prefix+id,JSON.stringify({version:1,events}));else storage.removeItem(prefix+id);}catch{/* Retain the memory queue if storage is unavailable or full. */}}
 function trim(){
  for(const [id,events] of records){const next=events.filter(e=>{if(Date.parse(e.occurredAt)<now()-ttl){loss('expired');return false;}return true;});records.set(id,next);}
  let entries=[...records].flatMap(([id,events])=>events.map(e=>({id,e}))).sort((a,b)=>Date.parse(a.e.occurredAt)-Date.parse(b.e.occurredAt));
  while(entries.length>maxEvents||new Set(entries.map(e=>e.id)).size>maxVisits){const entry=entries.find(e=>!important.has(e.e.name))||entries[0];records.set(entry.id,records.get(entry.id).filter(e=>e.sequence!==entry.e.sequence));entries=entries.filter(e=>e!==entry);loss('capacity');}
  for(const [id,events] of records){persist(id);if(!events.length)records.delete(id);}
 }
 function load(){if(!prefix||!storage)return;try{const keys=Array.from({length:storage.length},(_,i)=>storage.key(i));for(const key of keys)if(key?.startsWith(prefix)&&onboardingUUID(key.slice(prefix.length)))read(key.slice(prefix.length));}catch{}trim();}
 const later=ms=>{cancel(timer);timer=schedule(()=>{timer=undefined;void flush();},ms);};
 function enqueue(id,event){if(blocked||!onboardingUUID(id))return;load();const e=clean(event);if(!e)return;const list=records.get(id)||[];if(!list.some(v=>v.sequence===e.sequence))list.push(e);records.set(id,list);trim();if(!paused&&!flight&&timer===undefined&&failures<=5)later(Math.max(300,retryUntil-now()));}
 function flush(){
  if(flight)return flight;cancel(timer);timer=undefined;
  if(paused||blocked||failures>5)return Promise.resolve();
  if(retryUntil>now()){later(retryUntil-now());return Promise.resolve();}
  trim();const entry=records.entries().next().value;if(!entry)return Promise.resolve();
  const [id,events]=entry,batch=[];for(const event of events){if(batch.length===25||new TextEncoder().encode(JSON.stringify({attemptId:id,events:[...batch,event]})).length>18000)break;batch.push(event);}
  const version=epoch;
  flight=Promise.resolve().then(()=>send({attemptId:id,events:batch})).then(()=>{
   if(version!==epoch)return;read(id);const seqs=new Set(batch.map(e=>e.sequence));for(const seq of seqs)acknowledged.add(id+':'+seq);
   // Keep memory bounded during a long session; duplicate replay is safe server-side.
   if(acknowledged.size>2000)acknowledged.clear();records.set(id,(records.get(id)||[]).filter(e=>!seqs.has(e.sequence)));persist(id);if(!records.get(id)?.length)records.delete(id);
   const retried=failures;failures=0;retryUntil=0;const gaps={...losses};for(const key of Object.keys(losses))delete losses[key];try{onDelivered({retryCount:retried,gaps});}catch{}
  }).catch(error=>{
   if(version!==epoch)return;const status=error?.status;
   if(error?.code==='tracking_account_changed'||[403,404].includes(status)){clear();blocked=true;return;}
   if([400,413,415].includes(status)){const seqs=new Set(batch.map(e=>e.sequence));records.set(id,(records.get(id)||[]).filter(e=>!seqs.has(e.sequence)));persist(id);loss('request_rejected',batch.length);failures=0;return;}
   if(status===401){paused=true;return;}
   failures++;const retryAfter=Number(error?.retryAfterMs);retryUntil=now()+Math.max(Math.min(60000,2000*2**(failures-1))*(.8+random()*.4),Number.isFinite(retryAfter)?Math.min(300000,Math.max(0,retryAfter)):0);
  }).finally(()=>{flight=undefined;if(!paused&&!blocked&&records.size&&failures<=5)later(Math.max(300,retryUntil-now()));});
  return flight;
 }
 function resume(){if(blocked)return;paused=false;failures=0;load();void flush();}
 function pause(){paused=true;cancel(timer);timer=undefined;}
 function clear(){epoch++;blocked=true;pause();records.clear();for(const key of Object.keys(losses))delete losses[key];if(prefix&&storage)try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(prefix))storage.removeItem(key);}}catch{}}
 return {enqueue,flush,resume,pause,clear,get pending(){return [...records.values()].reduce((n,events)=>n+events.length,0);}};
}

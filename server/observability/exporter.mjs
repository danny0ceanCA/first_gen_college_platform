import {validateWireEvent,validateMetric} from './wire.mjs';
import {createVolumeGate} from './volume.mjs';
export function exportConfiguration(env=process.env){
 if(env.OBSERVABILITY_EXPORT!=='true')return null;
 let url;try{url=new URL(env.OBSERVABILITY_INGEST_URL);}catch{throw new Error('telemetry_configuration_invalid');}
 if(!env.DATABASE_URL||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.pathname!=='/v1/batch'||!env.OBSERVABILITY_INGEST_TOKEN||env.OBSERVABILITY_INGEST_TOKEN.length<32||env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||env.OBSERVABILITY_OPERATION_LINKS!=='true'||env.OBSERVABILITY_LIFECYCLE_READY!=='true'||!env.OBSERVABILITY_DEPLOYMENT_RECORD||!/^\d+$/.test(env.OBSERVABILITY_BACKUP_HORIZON_DAYS||'')||Number(env.OBSERVABILITY_BACKUP_HORIZON_DAYS)>7)throw new Error('telemetry_configuration_invalid');
 return {url:url.href,token:env.OBSERVABILITY_INGEST_TOKEN};
}
export function createExporter({url,token,request=fetch,clock=Date.now,random=Math.random,autoStart=true}={}){
 if(new URL(url).protocol!=='https:'||typeof token!=='string'||token.length<32)throw new Error('telemetry_configuration_invalid');
 const queue=[];let bytes=0,inFlight=0,closed=false,accepted=0,dropped=0,delivered=0,timeouts=0,filtered=0;const reasons={};
 const volume=createVolumeGate({clock}),active=new Set();
 const drop=(entry,reason)=>{const index=queue.indexOf(entry);if(index<0)return;queue.splice(index,1);bytes-=entry.bytes;dropped++;reasons[reason]=(reasons[reason]||0)+1;};
 const enqueue=(kind,input)=>{
  let value;try{value=kind==='event'?validateWireEvent(input):validateMetric(input);}catch{reasons.invalid=(reasons.invalid||0)+1;dropped++;return false;}
  // Request-only fallback has no account erasure reference. Keep it in stdout;
  // export only mapped requests whose opaque references were committed first.
  if(kind==='event'&&value.requestId&&!value.operationId){filtered++;return false;}
  volume.drain();if(closed||!volume.accept(value)){reasons[closed?'closed':'volume']=(reasons[closed?'closed':'volume']||0)+1;dropped++;return false;}
  const size=Buffer.byteLength(JSON.stringify(value))+32,priority=kind==='event'&&(value.level==='error'||value.level==='warn'||value.event==='telemetry.canary');
  while(queue.length>=2000||bytes+size>4194304||!priority&&queue.filter(e=>!e.priority).length>=1500){const oldest=queue.find(e=>!e.priority&&!e.busy);if(!oldest){reasons.capacity=(reasons.capacity||0)+1;dropped++;return false;}drop(oldest,'capacity');}
  queue.push({kind,value,bytes:size,priority,created:clock(),next:clock(),attempt:0,busy:false});bytes+=size;accepted++;return true;
 };
 const send=async entries=>{
  inFlight++;entries.forEach(e=>{e.busy=true;e.attempt++;});const controller=new AbortController();active.add(controller);let expired=false;
  const timer=setTimeout(()=>{expired=true;timeouts++;controller.abort();},2000);timer.unref?.();
  try{
   const response=await request(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,events:entries.filter(e=>e.kind==='event').map(e=>e.value),metrics:entries.filter(e=>e.kind==='metric').map(e=>e.value)}),signal:controller.signal});
   // No response body is retained. Small response streams must still be closed.
   await response.body?.cancel().catch(()=>{});
   if(response.ok&&!expired){for(const entry of entries){const i=queue.indexOf(entry);if(i>=0){queue.splice(i,1);bytes-=entry.bytes;delivered++;}}return;}
   if(![408,429,500,502,503,504].includes(response.status)&&!expired){entries.forEach(e=>drop(e,response.status===401||response.status===403?'authentication':'rejected'));return;}
   const retry=response.headers?.get('retry-after');const seconds=retry&&/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-clock():0;
   for(const entry of entries)entry.next=clock()+Math.max(100*2**(entry.attempt-1)+random()*100,Number.isFinite(seconds)?Math.max(0,seconds):0);
  }catch{for(const entry of entries)entry.next=clock()+100*2**(entry.attempt-1)+random()*100;}
  finally{clearTimeout(timer);active.delete(controller);inFlight--;for(const entry of entries){entry.busy=false;if(queue.includes(entry)&&(closed||entry.attempt>=5||entry.next-entry.created>=30000||clock()-entry.created>=30000))drop(entry,closed?'closed':'retry_exhausted');}}
 };
 const pump=()=>{
  if(closed)return;for(const entry of [...queue])if(!entry.busy&&clock()-entry.created>=30000)drop(entry,'retry_exhausted');
  while(inFlight<2){const entries=[];let size=64;for(const entry of queue){if(entry.busy||entry.next>clock())continue;if(entries.length>=100||size+entry.bytes>262144)break;entries.push(entry);size+=entry.bytes;}if(!entries.length)break;void send(entries);}
 };
 const timer=autoStart?setInterval(pump,1000):null;timer?.unref();
 const stats=()=>({accepted,dropped,delivered,timeouts,filtered,pending:queue.length,queuedBytes:bytes,inFlight,reasons:{...reasons}});
 return {enqueue:event=>enqueue('event',event),enqueueMetric:metric=>enqueue('metric',metric),pump,stats,
  flush:async(deadlineMs=2000)=>{const end=Date.now()+Math.min(deadlineMs,2000);while(queue.length&&Date.now()<end){pump();await new Promise(resolve=>setTimeout(resolve,5));}return !queue.length;},
  close:async()=>{closed=true;if(timer)clearInterval(timer);for(const controller of active)controller.abort();for(const entry of [...queue])if(!entry.busy)drop(entry,'closed');},
 };
}
let processExporter;
export function getProcessExporter(env=process.env){const config=exportConfiguration(env);if(!config)return null;return processExporter??=createExporter(config);}

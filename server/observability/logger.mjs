import {diagnosticRecord,createMetadata} from './event-schema.mjs';
import {currentDiagnosticContext} from './context.mjs';
import {createVolumeGate} from './volume.mjs';
import {getProcessExporter} from './exporter.mjs';

// One in-flight write and finite queued bytes. A stalled sink is never retried
// concurrently: it is quarantined until it settles, keeping pending work bounded.
export function createBoundedWriter(sink,{capacity=256,maxBytes=1048576,timeoutMs=1000,onGap=()=>{}}={}){
 if(!Number.isInteger(capacity)||capacity<1||capacity>256||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1048576||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000)throw new Error('invalid_log_limits');
 const queue=[];let bytes=0,active=false,closed=false,timer;
 let accepted=0,dropped=0,failed=0,lastGap=-Infinity,lastReason;
 const gap=reason=>{dropped++;lastReason=reason;if(Date.now()-lastGap<60000)return;lastGap=Date.now();try{onGap(reason);}catch{}};
 const pump=()=>{
  if(active||!queue.length)return;
  active=true;const entry=queue.shift();
  let settled=false;
  const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);bytes-=entry.bytes;entry.resolve();active=false;pump();};
  timer=setTimeout(()=>{
   failed++;gap('sink_timeout');entry.resolve();
   // Do not start another sink call while the old write is still pending.
  },timeoutMs);
  try{Promise.resolve(sink(entry.line)).then(finish,()=>{failed++;gap('sink_failed');finish();});}
  catch{failed++;gap('sink_failed');finish();}
 };
 const write=line=>{
  if(typeof line!=='string')return Promise.resolve(false);
  const size=Buffer.byteLength(line);
  if(closed||queue.length+(active?1:0)>=capacity||bytes+size>maxBytes){gap(closed?'closed':'queue_full');return Promise.resolve(false);}
  accepted++;
  return new Promise(resolve=>{queue.push({line,bytes:size,resolve});bytes+=size;pump();});
 };
 write.stats=()=>Object.freeze({accepted,dropped,failed,lastReason,pending:queue.length+(active?1:0),queuedBytes:bytes});
 write.flush=async(deadlineMs=2000)=>{
  const until=Date.now()+deadlineMs;
  while(active||queue.length){if(Date.now()>=until)return false;await new Promise(r=>setTimeout(r,5));}return true;
 };
 write.close=async()=>{closed=true;const complete=await write.flush();if(!complete){for(const item of queue){bytes-=item.bytes;item.resolve(false);}queue.length=0;}return complete;};
 return write;
}
export function createStreamSink(stream){
 // Writable errors also emit an event after the callback. Consume that event
 // so an unavailable logging pipe cannot crash an otherwise healthy API.
 stream.on('error',()=>{});
 return line=>new Promise((resolve,reject)=>{
  try{stream.write(line,error=>error?reject(error):resolve());}catch(error){reject(error);}
 });
}
const stdout=createBoundedWriter(createStreamSink(process.stdout));
const stdoutVolume=createVolumeGate();

export function createLogger({env=process.env,sink,exporter}={}){
 const metadata=createMetadata(env);
 const writer=sink?createBoundedWriter(line=>sink(Object.freeze(JSON.parse(line)))):stdout;
 const volume=sink?createVolumeGate():stdoutVolume;
 const target=()=>{try{return exporter||getProcessExporter(env);}catch{return null;}};
 const deliver=record=>{const accepted=volume.accept(record);if(accepted)void writer(JSON.stringify(record)+'\n');target()?.enqueue(record);};
 let reportedDrops=0,lastReport=-Infinity;
 const log=(input,context={})=>{
  try{
   const record=diagnosticRecord(input,{...currentDiagnosticContext(),...context,metadata});
   for(const aggregate of volume.drain()){const {endpoint,...fields}=aggregate;deliver(diagnosticRecord({event:'telemetry.aggregate',...fields},{metadata,endpoint}));}
   const dropped=writer.stats().dropped;
   if(dropped>reportedDrops&&Date.now()-lastReport>=60000){
    lastReport=Date.now();reportedDrops=dropped;
    deliver(diagnosticRecord({event:'telemetry.gap',reason:writer.stats().lastReason,sourceCount:dropped},{metadata}));
   }
   deliver(record);
   return record;
  }catch{return undefined;}
 };
 log.metadata=metadata;
 log.flush=async()=>{await Promise.all([writer.flush(),target()?.flush()]);};log.stats=()=>({...writer.stats(),...volume.stats()});
 log.exporterStats=()=>target()?.stats();log.exportMetric=metric=>target()?.enqueueMetric(metric);
 return log;
}
export const runtimeLog=createLogger();

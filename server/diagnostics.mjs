import {allowedRequest} from './origin.mjs';
import {mkdir,appendFile,stat,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {storeQualityEvent} from './voice-quality.mjs';
import {diagnosticRecord,clientDiagnosticRecord,createMetadata} from './observability/event-schema.mjs';
import {createBoundedWriter,runtimeLog} from './observability/logger.mjs';
export {diagnosticRecord,clientDiagnosticRecord};

export function createDiagnostics(directory=join(process.cwd(),'.camino-logs'),{env=process.env,now=Date.now,capacity=256,maxBytes=1048576}={}){
 const metadata=createMetadata(env),file=join(directory,'voice.jsonl'),rotated=file+'.1';
 const ttl=86400000,limit=2000000;
 let ageTimer;
 const expire=async()=>{
  // birthtime survives subsequent appends. Rotation preserves original age.
  for(const path of [file,rotated]){
   const info=await stat(path).catch(()=>null);
   if(info&&now()-(info.birthtimeMs||info.mtimeMs)>=ttl)await rm(path,{force:true});
  }
 };
 const writer=createBoundedWriter(async line=>{
  await mkdir(directory,{recursive:true,mode:0o700});await expire();
  if(!line)return;
  const info=await stat(file).catch(()=>null);
  if((info?.size||0)+Buffer.byteLength(line)>limit){
   await rm(rotated,{force:true});
   if(info.size>limit)await rm(file,{force:true});else await rename(file,rotated);
  }
  await appendFile(file,line,{mode:0o600});
 },{capacity,maxBytes,onGap:reason=>runtimeLog({event:'telemetry.gap',reason})});
 const log=input=>writer(JSON.stringify(diagnosticRecord(input,{metadata}))+'\n');
 log.stats=writer.stats;log.flush=writer.flush;
 ageTimer=setInterval(()=>{void writer('');},60000);ageTimer.unref();
 log.close=async()=>{clearInterval(ageTimer);return writer.close();};
 return log;
}
export function createDiagnosticHandler(log,database){
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/voice-diagnostics')return next();
  const finish=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
  if(!allowedRequest(req))return finish(403);
  if(req.method!=='POST')return finish(405);
  if(!req.headers['content-type']?.startsWith('application/json'))return finish(415);
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return finish(413);}
   const data=JSON.parse(raw);
   if(data?.operationKind==='summary'||data?.operationKind==='voice')await req.bindDiagnosticOperation?.(data.operationKind,data.studentId);
   try{const pending=(req.log||log)(clientDiagnosticRecord(data));if(pending?.then)void pending.catch(()=>{});}catch{}
   if(req.origenAuthorized&&req.origenIdentity?.sub)try{await storeQualityEvent(database,req.origenIdentity.sub,data);}catch{try{const pending=(req.log||log)({event:'voice_quality_store_failed'});if(pending?.then)void pending.catch(()=>{});}catch{}}
   return finish(204);
  }catch{return finish(400);}
 };
}

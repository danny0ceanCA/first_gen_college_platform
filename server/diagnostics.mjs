import {allowedRequest} from './origin.mjs';
import {mkdir,appendFile,stat,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {storeQualityEvent} from './voice-quality.mjs';
const fields=['sessionId','attemptId','eventId','responseId','callId','requestId','event','operation','code','parameter','status','mode','language','connectionState','endpoint','method','level','upstreamRequestId','reason'];
export function diagnosticRecord(input){
 const out={time:new Date().toISOString()};
 if(!input||typeof input!=='object')return out;
 for(const key of fields)if(typeof input[key]==='string'&&/^[a-zA-Z0-9_.:[\]\-]{1,160}$/.test(input[key]))out[key]=input[key];
 for(const key of ['durationMs','httpStatus','sourceCount','sequence','speechDurationMs','toolCount'])if(Number.isFinite(input[key])&&input[key]>=0)out[key]=input[key];
 return out;
}
export function createDiagnostics(directory=join(process.cwd(),'.camino-logs')){
 let queue=Promise.resolve();
 return input=>{
  const record=diagnosticRecord(input);
  queue=queue.then(async()=>{
   await mkdir(directory,{recursive:true});
   const file=join(directory,'voice.jsonl');
   if((await stat(file).catch(()=>({size:0}))).size>2_000_000){await rm(file+'.1',{force:true});await rename(file,file+'.1');}
   await appendFile(file,JSON.stringify(record)+'\n');
  }).catch(()=>{console.warn('Origen diagnostic log could not be written.');});
  return queue;
 };
}
export function createDiagnosticHandler(log,database){
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/voice-diagnostics')return next();
  const finish=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
  if(!allowedRequest(req)) return finish(403);
  if(req.method!=='POST')return finish(405);
  if(!req.headers['content-type']?.startsWith('application/json'))return finish(415);
  try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return finish(413);}const data=JSON.parse(raw);await (req.log||log)({...data,requestId:undefined,endpoint:undefined,method:undefined,level:undefined,upstreamRequestId:undefined});
   if(req.origenAuthorized&&req.origenIdentity?.sub)try{await storeQualityEvent(database,req.origenIdentity.sub,data);}catch{(req.log||log)({event:'voice_quality_store_failed'});}
   return finish(204);}catch{return finish(400);}
 };
}

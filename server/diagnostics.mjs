import {allowedRequest} from './origin.mjs';
import {mkdir,appendFile,stat,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {storeQualityEvent} from './voice-quality.mjs';
import {createHash} from 'node:crypto';
const clientEvents=new Set(['session_cleanup','session_start','profile_save_confirmation_finished','connection_failure','client_event','guide_update_start','initial_target_confirmed','guide_update_complete','guide_update_failed','empty_interruption_recovered','transcription_timeout','reply_recovered','lookup_progress','voice_usage_save_failed','malformed_event','welcome_save_failed','server_event','speech_segment','response_cancelled','spoken_language_changed','spoken_language_update_failed','api_error','error_recovered','request_error_recovered','response_failed','student_scope_restart','lookup_start','lookup_cache_hit','lookup_success','lookup_failure','profile_saved_awaiting_confirmation','connection_state']);
const clientCodes=new Set(['authentication_required','invalid_token','quota_exceeded','model_unavailable','missing_api_key','invalid_api_key','busy','rate_limited','unsupported','network_error','NotAllowedError','NotFoundError','NotReadableError','invalid_voice_response','voice_unavailable','connection_timeout','connection_failed','connection_lost','disconnected','failed','response_failed','server_error','invalid_value','conversation_already_has_active_response','response_cancel_not_active','item_not_found','operation_failed','private_search_details']);
// Browser diagnostics are untrusted. A character regex alone lets names and
// credential-shaped strings masquerade as an event/code/identifier.
export function clientDiagnosticRecord(data){
 const out={event:clientEvents.has(data?.event)?data.event:'unknown_client_event'};
 if(!data||typeof data!=='object')return out;
 if(data.code)out.code=clientCodes.has(data.code)?data.code:'other';
 for(const key of ['sessionId','attemptId','eventId','responseId','callId'])if(typeof data[key]==='string'&&data[key].length<=160)out[key]=['sessionId','attemptId'].includes(key)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data[key])?data[key]:'sha256:'+createHash('sha256').update(data[key]).digest('hex');
 for(const [key,values] of Object.entries({mode:['profile','planning','finance','loans','admissions'],language:['en','es'],connectionState:['new','connecting','connected','disconnected','failed','closed'],status:['completed','failed','cancelled','incomplete']}))if(values.includes(data[key]))out[key]=data[key];
 for(const key of ['durationMs','sourceCount','sequence','speechDurationMs','toolCount'])if(Number.isFinite(data[key])&&data[key]>=0)out[key]=Math.min(600000,Math.round(data[key]));
 return out;
}
const fields=['sessionId','attemptId','eventId','responseId','callId','requestId','event','operation','code','parameter','status','mode','language','connectionState','endpoint','method','level','upstreamRequestId','reason'];
export function diagnosticRecord(input){
 const out={time:new Date().toISOString()};
 if(!input||typeof input!=='object')return out;
 for(const key of fields)if(typeof input[key]==='string'&&/^[a-zA-Z0-9_.:[\]\-]{1,160}$/.test(input[key])){
  // Session headers are caller-controlled on every route, not only diagnostics.
  // Preserve actual UUIDs for correlation; hash non-UUID session labels.
  out[key]=['sessionId','attemptId'].includes(key)&&!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|sha256:[a-f0-9]{64})$/i.test(input[key])?'sha256:'+createHash('sha256').update(input[key]).digest('hex'):input[key];
 }
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
  try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return finish(413);}const data=JSON.parse(raw);await (req.log||log)(clientDiagnosticRecord(data));
   if(req.origenAuthorized&&req.origenIdentity?.sub)try{await storeQualityEvent(database,req.origenIdentity.sub,data);}catch{(req.log||log)({event:'voice_quality_store_failed'});}
   return finish(204);}catch{return finish(400);}
 };
}

import {createHash,randomUUID} from 'node:crypto';
import {createBoundedWriter} from './observability/logger.mjs';
import {enumFields,numericFields} from './observability/event-catalog.mjs';
import {runAsAccount} from './account-isolation.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
export const researchTraceStages=Object.freeze(['claimed','attempt_started','attempt_finished','catalog_checked','reuse_selected','recovery_decided','initial_published','completed','failed','cancelled','publish_rejected','poll','delivery','speech_observation','playback_observation','trace_gap']);
// Opaque, purpose-separated keys join service logs without placing call IDs in stdout.
export function researchTraceKeys(sessionId,jobId){
 const key=(purpose,id)=>createHash('sha256').update(`origen-research-v1:${purpose}:${id.toLowerCase()}`).digest('hex').slice(0,32);
 return {...(uuid(sessionId)?{researchCallKey:key('call',sessionId)}:{}),...(uuid(jobId)?{researchJobKey:key('job',jobId)}:{})};
}
const categories={pass:['initial','recovery'],providerStatus:['queued','in_progress','completed','failed','incomplete','cancelled'],incompleteReason:['max_output_tokens','content_filter'],failureStage:['request','http','body','validation','persistence','aborted','unknown'],recoveryStatus:['not_needed','running','unresolved','partial','recovered','aborted','failed','deadline'],evidenceKind:['server_observed','transcript_observed','browser_reported'],...enumFields};
const numbers={...numericFields,queueMs:3600000,evidenceVersion:1000,verifiedCount:8,partialCount:8,unverifiedCount:8,retainedFindingCount:8,reusedCount:8,lookupCount:8,droppedCount:1000000};
export function researchTraceData(input={}){
 const data={};
 if(['matched','request_outside_catalog','campus_unmatched','comparison_too_large','multiple_years','scope_ambiguous','scenario_unavailable','projection_rejected','catalog_error'].includes(input.catalogReason))data.catalogReason=input.catalogReason;
 for(const key of ['requestedModel','providerModel'])if(typeof input[key]==='string'&&/^gpt-[a-zA-Z0-9_.-]{1,100}$/u.test(input[key]))data[key]=input[key];
 for(const key of ['maxOutputTokens','maxToolCalls'])if(Number.isSafeInteger(input[key])&&input[key]>=0)data[key]=Math.min(input[key],1000000);
 if(['none','minimal','low','medium','high','xhigh'].includes(input.reasoningEffort))data.reasoningEffort=input.reasoningEffort;
 if(typeof input.configurationHash==='string'&&/^[a-f0-9]{64}$/u.test(input.configurationHash))data.configurationHash=input.configurationHash;
 if(Number.isSafeInteger(input.pollCount)&&input.pollCount>=0)data.pollCount=Math.min(input.pollCount,10000);
 if(['queued','running','completed','failed','cancelled'].includes(input.jobStatus))data.jobStatus=input.jobStatus;
 if(uuid(input.attemptId))data.attemptId=input.attemptId;
 if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(input.networkFailure))data.networkFailure=input.networkFailure;
 if(['shutdown','deadline','job_state_changed'].includes(input.stopReason))data.stopReason=input.stopReason;
 if(['research_worker','voice_control','queue'].includes(input.component))data.component=input.component;
 if(typeof input.measurementRun==='string'&&/^[a-f0-9]{32}$/u.test(input.measurementRun))data.measurementRun=input.measurementRun;
 if(typeof input.playbackIdle==='boolean')data.playbackIdle=input.playbackIdle;
 if(Number.isSafeInteger(input.playbackVersion)&&input.playbackVersion>=0)data.playbackVersion=Math.min(input.playbackVersion,10000000);
 for(const [key,max] of Object.entries(numbers))if(Number.isFinite(input[key])&&input[key]>=0)data[key]=Math.min(max,Math.round(input[key]));
 for(const [key,values] of Object.entries(categories))if(values.includes(input[key]))data[key]=input[key];
 for(const key of ['providerRequestId','providerResponseId'])if(typeof input[key]==='string'&&/^[a-zA-Z0-9_-]{1,200}$/u.test(input[key]))data[key]=input[key];
 if(typeof input.release==='string'&&/^[a-f0-9]{40}$/iu.test(input.release))data.release=input.release;
 if(Array.isArray(input.actions))data.actions=input.actions.slice(0,8).map(a=>({type:['search','open_page','find_in_page'].includes(a?.type)?a.type:'unknown',status:['completed','failed','incomplete','in_progress'].includes(a?.status)?a.status:'unknown'}));
 return data;
}

// No expiration and no FK to the short-lived queue. Raw prompts, transcripts,
// source text, credentials and private model reasoning never enter this store.
export function createResearchTraceWriter(database,{sessionId,jobId,log=()=>{},query,env=process.env,capacity=128}={}){
 const runQuery=query||((...args)=>database.query(...args));
 const keys=researchTraceKeys(sessionId,jobId);
 const targets=new Set();
 const gap=reason=>{try{log({event:'voice.research.trace_gap',...keys,reason});}catch{}};
 const writer=createBoundedWriter(async line=>{
  const record=JSON.parse(line);
  const result=await runQuery(`INSERT INTO origen_voice_research_trace_events(id,job_id,account_id,session_id,stage,observed_at,data)
   SELECT $1,id,account_id,session_id,$4,$5,$6 FROM origen_voice_research_traces WHERE id=$2 AND session_id=$3`,[record.id,record.jobId,sessionId,record.stage,record.at,record.data]);
  if(result.rowCount===0)throw Error('trace_scope_unavailable');
 },{capacity,timeoutMs:1000,onGap:gap});
 let closed=false;
 const record=(stage,input={},target=jobId)=>{
  if(closed||!uuid(sessionId)||!uuid(target)||!researchTraceStages.includes(stage))return false;
  if(targets.size<128)targets.add(target);
  const data=researchTraceData({...input,release:env.RENDER_GIT_COMMIT||env.APPLICATION_REVISION||env.GITHUB_SHA});
  void writer(JSON.stringify({id:randomUUID(),jobId:target,stage,at:new Date().toISOString(),data}));return true;
 };
 return {record,stats:writer.stats,async close(){if(closed)return;closed=true;await writer.close();
  const stats=writer.stats();if(stats.dropped||stats.failed){
   // A missing detailed event must remain an explicit gap, never a success.
   // Do not start a second write behind a quarantined/stalled database call.
   // For a call-wide collector this is a conservative gap marker on every
   // affected job, not a count to sum across those jobs.
   if(!stats.pending&&targets.size){let timer;try{await Promise.race([
    runQuery(`UPDATE origen_voice_research_traces SET diagnostics_dropped=diagnostics_dropped+$3 WHERE id=ANY($1::uuid[]) AND session_id=$2`,[[...targets],sessionId,stats.dropped]),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('trace_gap_timeout')),1000);}),
   ]);}catch{gap('sink_failed');}finally{clearTimeout(timer);}}
  }
 },flush:writer.flush};
}

export function researchDeliveryObservation(event){
 const stages={'origen.research.supplied':'supplied','origen.research.context_acknowledged':'context_acknowledged','origen.research.context_failed':'context_failed','origen.research.announced':'commentary_requested','origen.research.native_reply_observed':'native_reply_observed'};
 if(event.type==='origen.research.delivery'||stages[event.type])return {stage:'delivery',data:{...event,deliveryStage:stages[event.type]||event.deliveryStage,requestRevision:event.revision,evidenceKind:'server_observed'}};
 if(event.type==='origen.research.speech_observed')return {stage:'speech_observation',data:{...event,evidenceKind:'transcript_observed'}};
 return null;
}

// Server-created observer only; caller packets cannot select an account.
// It writes off the audio/control path and never sends anything to the model.
export function createResearchCallObserver(database,{subject,sessionId,log=()=>{},env}={}){
 const writer=createResearchTraceWriter(database,{sessionId,log,env,query:(...args)=>runAsAccount({sub:subject},()=>database.query(...args))});
 let currentJob;const polling=new Map();
 return {
  poll({jobId,status,outcome,durationMs,httpStatus}){
   if(!uuid(jobId))return;
   const previous=polling.get(jobId),count=(previous?.count||0)+1;
   if(polling.size>=32&&!polling.has(jobId))polling.delete(polling.keys().next().value);
   polling.set(jobId,{status,count});
   if(outcome==='failed'||previous?.status!==status||count%10===0)writer.record('poll',{jobStatus:status,outcome,durationMs,httpStatus,pollCount:count,component:'voice_control',evidenceKind:'server_observed'},jobId);
  },
  observe(event){
   const value=researchDeliveryObservation(event);if(!value||!uuid(event.jobId))return;
   currentJob=event.jobId;writer.record(value.stage,{...value.data,component:'voice_control'},event.jobId);
   try{log({event:'voice.research.delivery',...researchTraceKeys(sessionId,event.jobId),...researchTraceData(value.data)});}catch{}
  },
  playback(value){if(currentJob)writer.record('playback_observation',{playbackIdle:value.idle,playbackVersion:value.version,evidenceKind:'browser_reported',component:'voice_control'},currentJob);},
  reset(){currentJob=undefined;polling.clear();},
  close:writer.close,flush:writer.flush,stats:writer.stats,
 };
}

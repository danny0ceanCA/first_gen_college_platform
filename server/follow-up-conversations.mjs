import {validateOutcomeRecording,outcomeRecordingIntent,outcomeReadback} from '../src/outcomeRecording.mjs';
import {personalizationControls} from './personalization-controls.mjs';
import {loadReviewResponseContext} from './review-response-context.mjs';
import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';
import {studentFollowUpEnabled} from './student-follow-up.mjs';
import {validateFollowUpTarget,validateFollowUpReport} from '../src/studentFollowUp.mjs';
import {normalizeReadback} from './review-request-voice.mjs';
import {followUpIntent,followUpSchedule,approvesFollowUp,privateUpdateReadback,checkInReadback} from '../src/followUpConversation.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const number=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const strict=(o,keys,required=keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(o,k)))throw fail(400,'invalid_follow_up');};
const string=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export function validatePrivateUpdate(input){
 strict(input,['report','planStatus','reportId','reportVersion'],['report','planStatus']);
 if(input.planStatus!==null&&!['not-started','in-progress','complete','deferred'].includes(input.planStatus)||('reportId'in input||'reportVersion'in input)&&(!uuid(input.reportId)||!number(input.reportVersion)))throw fail(400,'invalid_follow_up');
 return {...input,report:validateFollowUpReport(input.report)};
}
export function validateFollowUpConversation(input,voice=false,privateKind='report'){
 const provenance=input?.recommendationProtocol!==undefined;
 if(provenance&&(input.recommendationProtocol!=='recommendation-provenance-v1'||input.action!=='prepare'||(voice?input.kind!=='outcome':privateKind!=='outcome')))throw fail(400,'invalid_follow_up');
 if(voice){
  const extra={choices:[],'outcome-reports':['target'],prepare:['kind','target','payload','operationId','timeZone'],confirm:[],present:['presentation'],stop:['operationId']};
  if(!Object.hasOwn(extra,input?.action))throw fail(400,'invalid_follow_up');
  strict(input,['action','sessionId','sequence','turnId','transcript',...extra[input.action],...(provenance?['recommendationProtocol']:[])]);
  if(!uuid(input.sessionId)||!number(input.sequence)||!string(input.turnId,128)||!string(input.transcript,8000))throw fail(400,'invalid_follow_up');
  if(input.action==='outcome-reports')input={...input,target:validateFollowUpTarget(input.target)};
  if(input.action==='prepare'){
   if(!['check-in','report','outcome'].includes(input.kind)||!uuid(input.operationId)||!string(input.timeZone,100))throw fail(400,'invalid_follow_up');
   try{new Intl.DateTimeFormat('en',{timeZone:input.timeZone});}catch{throw fail(400,'invalid_follow_up');}
   input={...input,target:validateFollowUpTarget(input.target),payload:input.kind==='report'?validatePrivateUpdate(input.payload):input.kind==='outcome'?validateOutcomeRecording(input.payload):input.payload};
   if(input.kind==='check-in')strict(input.payload,[]);
  }
  if(input.action==='stop'&&!uuid(input.operationId)||input.action==='present'&&(typeof input.presentation!=='string'||input.presentation.length>8000))throw fail(400,'invalid_follow_up');
 }else{
  const extra={load:['target'],prepare:['target','operationId','planVersion','payload','language'],confirm:['previewId','digest','confirmed']};
  if(!Object.hasOwn(extra,input?.action))throw fail(400,'invalid_follow_up');
  strict(input,['action','studentId',...extra[input.action],...(provenance?['recommendationProtocol']:[])]);
  if(!string(input.studentId,128))throw fail(400,'invalid_follow_up');
  if(input.target)input={...input,target:validateFollowUpTarget(input.target)};
  if(input.action==='prepare'){
   if(!uuid(input.operationId)||!number(input.planVersion)||!['en','es'].includes(input.language))throw fail(400,'invalid_follow_up');
   input={...input,kind:privateKind,payload:privateKind==='outcome'?validateOutcomeRecording(input.payload):validatePrivateUpdate(input.payload)};
  }
  if(input.action==='confirm'&&(!uuid(input.previewId)||!/^[a-f0-9]{64}$/.test(input.digest)||input.confirmed!==true))throw fail(400,'invalid_follow_up');
 }
 return input;
}
const noApproval={status:'not_requested',instruction:'No private change was requested in the independently captured student turn. Continue helping; do not save, share or infer success.'};
const clarify={status:'clarification_required',instruction:'Ask the student to name the exact action and repeat their request together. For a date, ask for a full calendar date or next time. Do not guess a date or target, and do not save yet.'};
export function createFollowUpConversationRepository(database,env={},privateKind='report'){return async(subject,raw,voice=false)=>{
 const input=validateFollowUpConversation(raw,voice,privateKind);
 const outcomes=()=>env.ORIGEN_OUTCOME_EVIDENCE==='true'&&studentFollowUpEnabled(env,subject);
 if((privateKind==='outcome'||input.kind==='outcome'||input.action==='outcome-reports')&&!outcomes())throw fail(503,'follow_up_paused');
 if(!database)throw fail(503,'follow_up_unavailable');
 const hadOutcomeCapability=outcomes();
 const mutating=['prepare','confirm','present'].includes(input.action);
 if(mutating&&(!studentFollowUpEnabled(env,subject)||voice&&!personalizationControls(env,subject).writes))throw fail(503,'follow_up_paused');
 const c=await database.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");await guardAccountTransaction(c,subject);
  await c.query("SELECT set_config('origen.recommendation_provenance',$1,true)",[String(input.recommendationProtocol==='recommendation-provenance-v1')]);
  if(studentFollowUpEnabled(env,subject))await c.query("SELECT set_config('origen.student_follow_up','true',true)");
  if(outcomes())await c.query("SELECT set_config('origen.outcome_evidence','true',true)");
  const command=async body=>{const r=(await c.query('SELECT origen_follow_up_conversation_command($1::jsonb) AS result',[JSON.stringify(body)])).rows[0].result;if(r.error)throw fail(r.error.endsWith('_changed')?409:r.error.endsWith('_paused')?503:r.error.endsWith('_unavailable')?404:r.error.startsWith('invalid_')?400:403,r.error);return r;};
  const finish=async result=>{await guardAccountTransaction(c,subject);if(mutating&&(!studentFollowUpEnabled(env,subject)||voice&&!personalizationControls(env,subject).writes||hadOutcomeCapability&&!outcomes()))throw fail(503,'follow_up_paused');await c.query('COMMIT');return {...result,enabled:studentFollowUpEnabled(env,subject)};};
  let result;
  if(!voice){
   result=await command({...input,...(input.action==='confirm'?{expectedKind:privateKind}:{})});
  }else{
   const evidence={sessionId:input.sessionId,sequence:input.sequence,turnId:input.turnId,transcript:input.transcript};
   const context=await command({action:'context',sessionId:input.sessionId});
   // choices verifies the independent registration before any intent or write.
   const choices=await command({action:'choices',...evidence});
   const intent=outcomes()&&outcomeRecordingIntent(input.transcript)?'outcome':followUpIntent(input.transcript);
   if(input.action==='stop'){
    if(!intent.startsWith('stop'))return await finish(noApproval);
    if(intent!=='stop-all'&&choices.items.length>20)return await finish(clarify);
    const matches=choices.items.filter(i=>normalizeReadback(input.transcript).includes(normalizeReadback(i.title)));
    const target=intent==='stop-all'?null:matches.length===1?matches[0].target:matches.length===0?context.focus:undefined;
    if(intent!=='stop-all'&&!target)return await finish(clarify);
    await command({action:'stop',...evidence,target,operationId:input.operationId});
    return await finish({status:'stopped',instruction:'The requested check-ins stopped. Actions and private notes remain. Do not ask again or infer task completion.'});
   }
   if(input.action==='choices')return await finish(['check-in','report','outcome'].includes(intent)?{status:'choices',items:choices.items.slice(0,20),more:choices.items.length>20,instruction:'Use one exact action. If the title is ambiguous, ask the student to name it in a complete request. Do not read unrelated actions aloud.'}:noApproval);
   if(input.action==='prepare'||input.action==='outcome-reports'){
    if(intent!==(input.action==='outcome-reports'?'outcome':input.kind))return await finish(noApproval);
    if(choices.items.length>20)return await finish(clarify);
    const matches=choices.items.filter(i=>normalizeReadback(input.transcript).includes(normalizeReadback(i.title)));
    const selected=matches.length===1?matches[0]:matches.length===0&&context.focus?choices.items.find(i=>i.target.planId===context.focus.planId&&i.target.stepId===context.focus.stepId):undefined;
    if(!selected||selected.target.planId!==input.target.planId||selected.target.stepId!==input.target.stepId)return await finish(clarify);
    if(input.action==='outcome-reports'){
     const current=await command({action:'load',studentId:context.studentId,target:selected.target});
     if(!current.canSave)throw fail(404,'follow_up_unavailable');
     const history=(await c.query('SELECT origen_outcome_evidence_command($1::jsonb) AS result',[JSON.stringify({action:'load',studentId:context.studentId,target:selected.target})])).rows[0].result;
     if(history.error)throw fail(404,'follow_up_unavailable');
     const reportIds=new Set(current.reports.slice(0,20).map(r=>r.id));
     const records=history.evidence.filter(r=>reportIds.has(r.report_id)).slice(0,20).flatMap(r=>{const e=history.episodes.find(e=>e.id===r.episode_id);return e?[{id:r.id,version:r.version,reportId:r.report_id,reportVersion:r.report_version,episode:{definitionId:e.definition_id,definitionVersion:e.definition_version,scope:{institution:e.institution,term:e.term,cycle:e.cycle},window:{start:e.window_start,end:e.window_end,timeZone:e.time_zone}},claimStatus:r.claim_status,decision:r.decision,state:e.state}]:[];});
     return await finish({status:'reports',outcomes:records,moreOutcomes:history.evidence.length>records.length,reports:current.reports.slice(0,20).map(({id,version,response_state,detail,occurred_on,time_zone})=>({id,version,responseState:response_state,detail,occurredOn:occurred_on,timeZone:time_zone})),more:current.reports.length>20,instruction:'Use the exact report ID and version only after the student identifies their update. Preserve its wording and unknown date unless explicitly corrected. Ask for institution, term, process and observation window; never infer them. Use returned outcome ID/version as replaces only for an explicitly selected correction; never invent identifiers. If ambiguous or more records exist, use My private updates in the binder.'});
    }
    let payload=input.kind==='report'?{...input.payload,report:{...input.payload.report,timeZone:input.timeZone}}:input.payload;
    if(input.kind==='check-in'){
     const schedule=followUpSchedule(input.transcript,input.timeZone);if(!schedule)return await finish(clarify);payload={schedule};
    }
    result=await command({action:'prepare',...evidence,operationId:input.operationId,target:selected.target,planVersion:selected.planVersion,kind:input.kind,payload,language:context.language});
    const preview=result.preview;
    const readback=preview.kind==='check-in'?checkInReadback(preview,context.language):preview.kind==='outcome'?outcomeReadback(preview,context.language):privateUpdateReadback(preview,context.language);
    if(readback.length>6500)throw fail(409,'follow_up_readback_changed');
    await command({action:'bind',...evidence,readbackHash:hash(normalizeReadback(readback))});
    const prepared=await finish({status:'readback_required',readback,instruction:'Read this exact private proposal completely and verbatim, then wait. Only complete audible playback and explicit approval in the immediately next independent turn can save it. Never claim a save, task completion, outcome verification or coordinator sharing before the app confirms it.'});
    const loaded=await loadReviewResponseContext(database,subject,{studentId:context.studentId,focus:preview.source},env);
    if(loaded.status!=='retrieved')throw fail(409,'follow_up_source_changed');
    return {...prepared,reviewResponseGuard:loaded.guard};
   }
   result=await command({...evidence,action:input.action,...(input.action==='confirm'?{accepted:approvesFollowUp(input.transcript)}:{presentationHash:hash(normalizeReadback(input.presentation))})});
  }
  if(result.status==='saved')result.instruction='Saved privately. This is student-reported, not institution-verified. No update was shared with a coordinator. The app refreshes saved context; do not save again.';
  if(result.status==='approval_required')result.instruction='No approval is confirmed. Use the binder to review the exact private update, or make a fresh complete request. Do not reuse a partial readback or an unrelated yes.';
  return await finish(result);
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createFollowUpConversationHandler(database,env={}){const run=createFollowUpConversationRepository(database,env);return async(req,res,next)=>{
 const path=req.url?.split('?')[0];if(!['/api/student-follow-up-report','/api/student-follow-up-voice'].includes(path))return next();
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>24000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_follow_up'});}return send(200,await run(req.origenIdentity.sub,input,path.endsWith('-voice')));}
 catch(e){return send([400,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'follow_up_unavailable'});}
};}

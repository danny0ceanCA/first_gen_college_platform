import {randomUUID,createHash} from 'node:crypto';
import {recordRecommendationEvaluation} from './recommendation-evaluation.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';
import {personalizationControls} from './personalization-controls.mjs';
import {recommendationsEnabled} from './recommendation-contract.mjs';
import {createRecommendationSelector} from './recommendation-selection.mjs';
import {validateRecommendationSelectionRequest,recommendationExplanation,recommendationDecisionInstructions} from './recommendation-policy.mjs';
import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';
import {recommendationSpeechIntent,recommendationSpeechRequest,recommendationReadback} from '../src/recommendationDelivery.mjs';
import {normalizeReadback} from './review-request-voice.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
const fail=(status,code)=>Object.assign(Error(code),{status});
const hash=v=>createHash('sha256').update(v).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const strict=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))throw fail(400,'invalid_recommendation_request');};
const text=(s,n)=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=n&&!/[\x00-\x1f\x7f]/.test(s);
function validate(input,voice){
 const extras=voice?{select:['timeZone'],prepare:[],confirm:[],present:['presentation'],cancel:[],verify:[]}:{capability:[],select:['request','answers'],confirm:['id','confirmed'],verify:['id'],display:['id'],cancel:['id'],receipt:['id']};
 if(!Object.hasOwn(extras,input?.action))throw fail(400,'invalid_recommendation_request');
 strict(input,['action',...(voice?['sessionId','sequence','turnId','transcript']:['studentId']),...extras[input.action]]);
 if(voice){if(!uuid(input.sessionId)||!Number.isInteger(input.sequence)||input.sequence<1||!text(input.turnId,128)||!text(input.transcript,8000))throw fail(400,'invalid_recommendation_request');}
 else if(!text(input.studentId,128)||input.id!==undefined&&!uuid(input.id)||input.action==='confirm'&&input.confirmed!==true)throw fail(400,'invalid_recommendation_request');
 if(input.action==='present'&&(typeof input.presentation!=='string'||input.presentation.length>5000))throw fail(400,'invalid_recommendation_request');
 return input;
}
const interaction=r=>({trigger:'student_request',role:'student',studentId:r.studentId,targetConfirmed:true,intent:r.intent,goal:r.goal,process:r.process,focus:r.focus});
export async function purgeRecommendationPreviews(database){if((await database.query("SELECT to_regprocedure('origen_recommendation_purge()') AS fn")).rows[0]?.fn)await database.query('SELECT origen_recommendation_purge()');}
export async function recommendationDeliveryCommand(c,input){
 const result=(await c.query('SELECT origen_recommendation_delivery_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error.startsWith('invalid_')?400:result.error.endsWith('paused')?503:result.error.endsWith('denied')?403:409,result.error);
 return result;
}
export function createRecommendationDeliveryRepository(database,env={}){return async(subject,raw,voice=false)=>{
 const input=validate(raw,voice);
 if(!database)throw fail(503,'recommendation_unavailable');
 const enabled=()=>recommendationsEnabled(env,subject)&&(!voice||personalizationControls(env,subject).writes);
 if(input.action==='capability')return {enabled:enabled()};
 if(!enabled()&&!['receipt','cancel'].includes(input.action))throw fail(503,'recommendation_paused');
 const c=await database.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");await guardAccountTransaction(c,subject);
  await c.query("SELECT set_config('origen.recommendations',$1,true)",[String(enabled())]);
  const evidence=voice?{sessionId:input.sessionId,sequence:input.sequence,turnId:input.turnId,transcript:input.transcript}:{};
  const context=voice?await recommendationDeliveryCommand(c,{action:'voice-context',...evidence}):{studentId:input.studentId};
  const studentId=context.studentId,command=body=>recommendationDeliveryCommand(c,{studentId,...evidence,...body});
  const evaluate=body=>recordRecommendationEvaluation(c,env,{studentId,...body});
  const finish=async result=>{await guardAccountTransaction(c,subject);if(!enabled()&&!['receipt','cancel'].includes(input.action))throw fail(503,'recommendation_paused');await c.query('COMMIT');return result;};
  const intent=voice?recommendationSpeechIntent(input.transcript):null;
  if(input.action==='receipt')return await finish(await command({action:'receipt',id:input.id}));
  if(input.action==='cancel')return await finish(await command({action:'cancel',id:input.id}));
  let request,reportedFacts={},preview,result;
  const select=()=>createRecommendationSelector(database,env)(subject,request,{client:c,interaction:interaction(request),reportedFacts});
  if(input.action==='select'){
   await command({action:'cancel',all:true});
   if(voice){
    const intentRequest=recommendationSpeechRequest(input.transcript);
    if(!intentRequest)return await finish({status:'not_requested',instruction:'Follow the current student question. Do not offer or save a recommendation.'});
    request=validateRecommendationSelectionRequest({studentId,language:context.language||'en',intent:context.focus?'revisit_action':'next_action',...intentRequest,focus:context.focus||null,episodes:[],timeZone:input.timeZone});
   }else{
    strict(input.request,['language','intent','goal','process','focus','episodes','timeZone']);
    let focus=input.request.focus;
    if(focus?.kind==='review-response'&&!Object.hasOwn(focus,'organizationId'))focus=(await command({action:'resolve-focus',source:validateReviewResponseReference(focus)})).source;
    request=validateRecommendationSelectionRequest({...input.request,focus,studentId});
    strict(input.answers,['document_requested','document_prepared','submission_reported','decision_pending']);
    if(Object.values(input.answers).some(v=>!['yes','no','unknown'].includes(v)))throw fail(400,'invalid_reported_prerequisite');
    reportedFacts=input.answers;
   }
   const started=performance.now(),receiptId=randomUUID();result=await select();
   await evaluate({event:'considered',id:receiptId,status:result.decision.status,source:result.decision.candidate?.source||null,sourceRevision:result.decision.sourceRevision||null,considered:result.trace?.considered??null,eligible:result.trace?.eligible??null,language:request.language,channel:voice?'voice':'binder',latencyMs:Math.min(60000,Math.round(performance.now()-started))});
   if(result.decision.status!=='recommended')return await finish({status:result.decision.status,reason:result.decision.reason,questionKey:result.clarification?.code||null,question:result.clarification?.question[request.language]||null});
   const d=result.decision,action=d.candidate.action[request.language];
   preview=await command({action:'prepare',id:receiptId,request,reportedFacts,guard:result.guard,source:d.candidate.source,sourceRevision:d.sourceRevision,actionHash:hash(action)});
  }else{
   if(voice&&input.action==='prepare'&&intent!=='prepare'&&intent!=='approve')return await finish({status:'not_requested'});
   if(voice&&input.action==='confirm'&&intent!=='approve')return await finish({status:'approval_required'});
   if(!voice&&input.action==='confirm'){
    const receipt=await command({action:'receipt',id:input.id});if(receipt.status!=='not_saved')return await finish(receipt);
   }
   preview=await command({action:voice&&input.action==='confirm'?'approval':'get',id:input.id,...(voice&&input.action==='confirm'?{accepted:true}:{})});
   request=validateRecommendationSelectionRequest(preview.request);reportedFacts=preview.reportedFacts;
   result=await select();
   if(result.decision.status!=='recommended'||['revision','requestRevision','decisionRevision'].some(k=>result.guard[k]!==preview.guard[k]))throw fail(409,'recommendation_source_changed');
  }
  const d=result.decision,candidate=d.candidate;
  const value={status:'recommended',id:preview.id,expiresAt:preview.expiresAt,action:candidate.action[request.language],explanation:recommendationExplanation(result,request.language),source:candidate.source,policyVersion:d.policyVersion,reviewedAt:candidate.reviewedAt,canAccept:candidate.source.kind!=='accepted-action',instruction:recommendationDecisionInstructions};
  if(input.action==='select')return await finish(value);
  if(input.action==='verify')return await finish({status:'current'});
  if(input.action==='display'){await evaluate({event:'displayed',id:preview.id});return await finish({status:'observed'});}
  const readback=recommendationReadback(value,request.language);
  if(input.action==='prepare'){
   if(!value.canAccept)return await finish({status:'already_saved'});
   await command({action:'bind',readbackHash:hash(normalizeReadback(readback))});return await finish({...value,status:'readback_required',readback});
  }
  if(input.action==='present'){const observed=await command({action:'present',presentationHash:hash(normalizeReadback(input.presentation))});await evaluate({event:'played',id:preview.id});return await finish(observed);}
  if(!value.canAccept)throw fail(409,'recommendation_already_saved');
  const stepId=randomUUID(),lang=request.language;
  // Follow-up voice resolves the student's exact action title. A shared generic
  // title makes distinct recommendations ambiguous and cannot match their
  // spoken wording. Keep a bounded verbatim prefix and retain the full action.
  const plan={studentId,title:lang==='es'?'Mis próximos pasos':'My next steps',goal:'',category:request.process==='office_contact'?'education':'financial',status:'active',summaryIds:[],steps:[{id:stepId,title:value.action.slice(0,200),action:value.action,notes:'',status:'not-started',dueDate:null,sources:[]}]};
  const fromResponse=candidate.source.kind==='review-response'?{source:{kind:'review-response',requestId:candidate.source.requestId,responseVersion:candidate.source.responseVersion},stepId,confirmed:true}:undefined;
  const saved=await createPlanRepository(database,env)(subject,validatePlan({action:'create',requestId:preview.id,plan,...(fromResponse?{fromResponse}:{})}),{client:c});
  const created=saved.plans.find(p=>p.steps.some(s=>s.id===stepId));if(!created)throw fail(409,'recommendation_action_changed');
  const receipt=await command({action:'attach',id:preview.id,planId:created.id,stepId});
  await evaluate({event:'accepted',id:preview.id});
  return await finish({...receipt,instruction:'Saved privately to the canonical plan. No check-in, completion, coordinator sharing or evaluation was authorized. Refresh the binder; do not save again.'});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createRecommendationDeliveryHandler(database,env={}){const run=createRecommendationDeliveryRepository(database,env);return async(req,res,next)=>{
 const path=req.url?.split('?')[0];if(!['/api/recommendations','/api/recommendation-voice'].includes(path))return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>24000)return send(413,{error:'too_large'});}let raw;try{raw=JSON.parse(body);}catch{return send(400,{error:'invalid_recommendation_request'});}return send(200,await run(req.origenIdentity.sub,raw,path.endsWith('-voice')));}
 catch(e){return send([400,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'recommendation_unavailable'});}
};}

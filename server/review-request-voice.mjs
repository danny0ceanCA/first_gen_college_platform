import {createHash} from 'node:crypto';
import {reviewDeliveryEnabled} from './review-request-delivery.mjs';
import {reviewRequestsEnabled,reviewFollowupsEnabled,studentUpdatesEnabled} from './review-requests.mjs';
import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';
import {redactCoordinatorCodes} from '../src/coordinatorCodes.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text=(v,max,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export const reviewVoiceEnabled=env=>env.ORIGEN_REVIEW_REQUEST_VOICE==='true'&&reviewRequestsEnabled(env);
export const normalizeReadback=v=>String(v).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const hash=v=>createHash('sha256').update(v).digest('hex');
export const acceptsReview=v=>/^(yes|yes please|yes approve it|yes send it|yes share it|approve this request|send this request|si|si por favor|si apruebo|si envialo|si envia la solicitud|apruebo esta solicitud)$/.test(normalizeReadback(v));
export function requestsReview(v){
 const s=normalizeReadback(v).replace(/^(please |por favor )/,'').replace(/^(can you |could you |would you |i want you to |i would like you to |i need you to |puedes |podrias |quiero que |me gustaria que |necesito que )/,'').replace(/^(please |por favor )/,'');
 const command=/^(ask|send|share|have|request|tell|pregunta|preguntale|preguntes|pide|pidele|pidas|envia|enviale|envies|comparte|compartelo|compartas|dile|solicita)\b/.test(s);
 // Uncertainty or lack of insurance inside the question is not a retraction.
 const retracted=/\b(dont|don t|do not|no|never) (send|share|ask|envies|compartas|preguntes)\b|\b(not yet|never mind|olvidalo|todavia no|aun no)\b|\bno$/.test(s);
 return command&&!retracted;
}
export const requestsStudentUpdate=v=>requestsReview(v)&&/\b(coordinator|coordinador|coordinadora)\b/.test(normalizeReadback(v));
export function reviewReadback(preview,language,deliveryEnabled=false){
 const p=preview.selection,es=language==='es';
 // Use speakable dates; the full phrase is covered by the readback hash.
 const date=value=>new Intl.DateTimeFormat(es?'es-US':'en-US',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value));
 const end=date(preview.accessExpiresAt),notes=p.entries.map((n,i)=>`${es?'Nota':'Note'} ${i+1}: ${n.content}`).join(' '),related=p.relatedResponse;
 if(p.kind==='student-update'){
  const reference=es?`Se incluye tu pregunta anterior: ${related.question} y la referencia a la respuesta de ${related.coordinatorName} del ${date(related.respondedAt)}, versión ${related.responseVersion}.`:`Your earlier question is included: ${related.question} together with the reference to ${related.coordinatorName}’s response from ${date(related.respondedAt)}, version ${related.responseVersion}.`;
  return es?`Quiero confirmar esta actualización para ${p.coordinatorName}, de ${p.organizationName}, para el estudiante ${p.studentName}. Tus palabras son: ${p.question} ${notes||'No incluye notas.'} ${reference} Esta actualización es reportada por ti, no verificada por la institución. Es una copia separada: corregir o eliminar tu actualización privada no cambia esta copia compartida. Puedes retirar esta solicitud en tu carpeta o aprobar una nueva corrección. No incluye otros reportes privados ni la conversación. El acceso termina el ${end}. ${deliveryEnabled?'Después de aprobarla, se entregará en el espacio de tu coordinador.':'La entrega está en pausa; quedará en espera.'} ¿Apruebas esta actualización exacta, estas notas y esta referencia para este coordinador?`:`Let me confirm this update for ${p.coordinatorName} at ${p.organizationName}, for student ${p.studentName}. Your words are: ${p.question} ${notes||'No notes are included.'} ${reference} This update is student-reported, not institution-verified. It is a separate copy: correcting or deleting your private update does not change this shared copy. You can withdraw this request in your binder or approve a new correction. Other private reports and the conversation are not included. Access ends on ${end}. ${deliveryEnabled?'After approval, it will be delivered to your coordinator’s workspace.':'Delivery is paused; it will stay queued.'} Do you approve this exact update, these notes and this reference for this coordinator?`;
 }
 const connection=related?(es?` Esta es una aclaración sobre la respuesta de ${related.coordinatorName} del ${date(related.respondedAt)}, versión ${related.responseVersion}, a tu pregunta anterior: ${related.question} Solo se incluye esa pregunta y la referencia a esa respuesta; no se incluye la conversación ni otras notas.`:` This is a clarification about ${related.coordinatorName}’s response from ${date(related.respondedAt)}, version ${related.responseVersion}, to your earlier question: ${related.question} Only that question and the response reference are included; the conversation and other notes are not included.`):'';
 return es?`Quiero confirmar esta solicitud para ${p.coordinatorName}, de ${p.organizationName}, para el estudiante ${p.studentName}. La pregunta es: ${p.question} ${notes||'No incluye notas.'}${connection} El acceso termina el ${end}. Puedes retirar la solicitud desde tu carpeta. ${deliveryEnabled?'Después de aprobarla, esta solicitud se entregará en el espacio de tu coordinador.':'La entrega al coordinador aún no está disponible; la solicitud quedará en espera.'} ${related?'¿Apruebas esta pregunta exacta, estas notas y esta referencia para este coordinador?':'¿Apruebas esta pregunta exacta y estas notas para este coordinador?'}`:
 `Let me confirm this request for ${p.coordinatorName} at ${p.organizationName}, for student ${p.studentName}. The question is: ${p.question} ${notes||'No notes are included.'}${connection} Access ends on ${end}. You can withdraw the request in your binder. ${deliveryEnabled?'After approval, this request will be delivered to your coordinator’s workspace.':'Coordinator delivery is not available yet; this request will stay queued.'} ${related?'Do you approve this exact question, these notes and this reference for this coordinator?':'Do you approve this exact question and these notes for this coordinator?'}`;
}
const fields={turn:['language'],options:['topic','query'],prepare:['requestKey','connectionId','question','kind','entries','relatedResponse'],present:['presentation'],confirm:[],close:[]};
export function validateReviewVoice(input){
 if(!input||!Object.hasOwn(fields,input.action)||!uuid(input.sessionId)||Object.keys(input).some(k=>!['action','sessionId',...(input.action==='close'?[]:['sequence','turnId','transcript']),...fields[input.action]].includes(k)))throw fail(400,'invalid_review_voice');
 if(input.action==='close')return input;
 if(!Number.isSafeInteger(input.sequence)||input.sequence<1||!text(input.turnId,128)||!text(input.transcript,8000,true))throw fail(400,'invalid_review_voice');
 if(input.action==='turn'&&!['en','es'].includes(input.language)||input.action==='present'&&!text(input.presentation,8000,true))throw fail(400,'invalid_review_voice');
 if(input.action==='options'&&(input.topic!==undefined&&!['options','transfer','costs','applications'].includes(input.topic)||input.query!==undefined&&!text(input.query,200,true)))throw fail(400,'invalid_review_voice');
 if(input.action==='prepare'&&(!uuid(input.requestKey)||!uuid(input.connectionId)||!text(input.question,2000)||!['question','concern','review','student-update'].includes(input.kind)||!Array.isArray(input.entries)||input.entries.length>3||input.entries.some(e=>!e||Object.keys(e).some(k=>!['id','version'].includes(k))||!uuid(e.id)||!Number.isSafeInteger(e.version)||e.version<1)||new Set(input.entries.map(e=>e.id)).size!==input.entries.length))throw fail(400,'invalid_review_voice');
 if(input.action==='prepare'&&input.kind==='student-update'&&input.relatedResponse===undefined)throw fail(400,'invalid_review_voice');
 return {...input,...(input.relatedResponse!==undefined?{relatedResponse:validateReviewResponseReference(input.relatedResponse)}:{})};
}
async function command(c,input){
 const r=(await c.query('SELECT origen_review_voice_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(r.error)throw fail(r.error.endsWith('paused')?503:r.error.endsWith('unavailable')?404:r.error.endsWith('changed')?409:r.error.startsWith('invalid_')?400:403,r.error);
 return r;
}
export async function openReviewVoiceSession(database,env,studentId){
 if(!database||!reviewVoiceEnabled(env)||typeof studentId!=='string')return undefined;
 try{return await command(database,{action:'open',studentId,enabled:true});}catch(e){if([403,404].includes(e.status))return undefined;throw e;}
}
export function createReviewVoiceRepository(database,env,subject){return async raw=>{
 const input=validateReviewVoice(raw);if(!database)throw fail(503,'review_voice_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");
  await c.query("SELECT set_config('origen.review_followups',$1,true),set_config('origen.student_updates',$2,true)",[String(reviewFollowupsEnabled(env)),String(studentUpdatesEnabled(env,subject))]);
  const enabled=reviewVoiceEnabled(env),base={...input,enabled,accepted:acceptsReview(input.transcript||'')};let result;
  if(input.action==='options'){
   const state=await command(c,{action:'state',sessionId:input.sessionId,enabled});
   if(state.sequence!==input.sequence||state.turn_id!==input.turnId||state.transcript_hash!==hash(input.transcript)||!requestsReview(input.transcript))result={status:'not_requested'};
   else{
    const options=(await c.query('SELECT origen_review_request_command($1::jsonb) AS result',[JSON.stringify({action:'options',studentId:state.student_id,enabled})])).rows[0].result;
    if(options.error)throw fail(403,options.error);
    const eligible=options.entries.filter(e=>(!input.topic||e.topic===input.topic)&&(!input.query||normalizeReadback(e.content).includes(normalizeReadback(input.query))));
    // Notes are only supplied when the caller actually searches for them.
    result={status:'choices',connections:options.connections,entries:input.topic||input.query?eligible.slice(0,20):[],more:eligible.length>20};
   }
  }else if(input.action==='prepare'){
   if(!requestsReview(input.transcript)||input.kind==='student-update'&&!requestsStudentUpdate(input.transcript))result={status:'not_requested'};
   else if(input.transcript.length>2000||redactCoordinatorCodes(input.transcript)!==input.transcript||redactCoordinatorCodes(input.question)!==input.question)result={status:'use_notebook'};
   else{
    result=await command(c,{...base,intent:true});
    if(result.status==='readback_required'){
     const readback=reviewReadback(result.preview,result.request.language,reviewDeliveryEnabled(env));
     if(readback.length>6000)throw fail(409,'review_voice_readback_too_long');
     await command(c,{...base,action:'bind',previewId:result.preview.id,readbackHash:hash(normalizeReadback(readback))});
     result={status:'readback_required',requestId:result.request.id,previewId:result.preview.id,digest:result.preview.digest,expiresAt:result.preview.expiresAt,readback,
      instruction:'Nothing is shared yet. Read the complete readback verbatim in one spoken response, then wait. The app requires completed audible playback and explicit approval in the next user turn. Never omit notes, expiry, recipient or current delivery wording. If interrupted, unclear, or unable to read it exactly, use the notebook controls; never assume consent.'};
    }
   }
  }else result=await command(c,{...base,...(input.action==='present'?{presentationHash:hash(normalizeReadback(input.presentation))}:{})});
  if(input.action==='confirm'&&result.request){const r=result.request;result={status:r.status==='submitted'&&r.publication?.access==='active'?'queued':r.status==='withdrawn'?'withdrawn':'unavailable',requestId:r.id,
   instruction:r.status==='submitted'&&r.publication?.access==='active'?(r.publication.notification==='delivered'?'The request was delivered to the coordinator workspace. Do not infer that it was opened, reviewed or resolved. Do not submit again.':'Approval is saved in the binder and delivery is queued. Do not claim coordinator receipt, review or resolution. Do not submit again.'):'This request is no longer active. Do not claim it was sent, renew it, or retry automatically.'};}
  if(result.status==='approval_required')result.instruction='No approval was recorded. A complete current readback and an explicit immediately following spoken approval are required. Use the binder if playback was interrupted or the request changed.';
  if(result.status==='not_requested')result.instruction='The independently captured student turn does not explicitly request a coordinator review. Do not prepare, submit, or solicit approval. Continue the conversation.';
  if(result.status==='use_notebook')result.instruction='Use the notebook request controls for this selection. No voice approval was recorded.';
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createReviewVoiceHandler(database,env={}){return async(req,res,next)=>{
 if(req.url!=='/api/review-request-voice')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>32768)return send(413,{error:'too_large'});}let input;try{input=validateReviewVoice(JSON.parse(body));}catch{return send(400,{error:'invalid_review_voice'});}return send(200,await createReviewVoiceRepository(database,env,req.origenIdentity.sub)(input));}
 catch(e){return send([400,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'review_voice_unavailable'});}
};}
export async function assertReviewVoiceReady(database,env){
 if(!reviewVoiceEnabled(env))return;
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='098_review_request_voice.sql'")).rows.length||!(await database.query("SELECT has_function_privilege(current_user,'origen_review_voice_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed)throw new Error('review_voice_migration_required');
}

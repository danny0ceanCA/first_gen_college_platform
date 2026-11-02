import {assessOutcomeContext,OUTCOME_ASSESSMENT_RULE_VERSION} from './outcome-assessment.mjs';
import {createHash} from 'node:crypto';
import {withRequestDeadline} from '../src/requestDeadline.mjs';
import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {personalizationControls} from './personalization-controls.mjs';
import {reviewRequestsEnabled} from './review-requests.mjs';
import {allowedRequest} from './origin.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stop=new Set('the this that those these with from about what which when where would could should have does did was were will your their there they them want need please help talk discuss explain told said says response responses advice coordinator coordinators suggestion suggestions information question questions document documents check review have has how can and for you are but not yet she his her him its our who why tell some more just me my is it to of in on at an as be do a i el la los las un una unos unas de del que cual cuales como cuando donde con por para sobre mi mis me tu tus sus su nos nosotros quiero necesito ayuda hablar explicar explicame dijo respuesta respuestas consejo consejos coordinador coordinadora coordinadores pregunta preguntas documento documentos revisar favor puedo puede podria deberia hay es son si no al se lo le y o'.split(' '));
const groups=[
 ['insurance','health','ship','coverage','seguro','salud','cobertura'],['waiver','waivers','exencion','exenciones'],
 ['fafsa','aid','financial','ayuda','financiera'],['scholarship','scholarships','beca','becas'],['tuition','cost','costs','costos','matricula'],
 ['transfer','transferencia'],['course','courses','credit','credits','curso','cursos','credito','creditos'],
 ['college','university','universidad'],['major','career','carrera'],['essay','essays','piq','piqs','ensayo','ensayos'],['application','applications','solicitud','solicitudes'],
];
for(const word of 'get getting find know knowing understand learn look looking say ask asking already something anything thing things really now today also said saber entender tengo hacer ver puedes podemos quisiera algo eso esto'.split(' '))stop.add(word);
export function reviewResponseSearch(query){
 const words=[...new Set(normalize(query).match(/[a-z0-9]+/g)||[])].filter(w=>w.length>=3&&w.length<=64&&!stop.has(w)).slice(0,20);
 const terms=[...new Set(words.flatMap(word=>groups.find(g=>g.includes(word))||[word]))].slice(0,60);
 return {terms};
}
export const reviewResponseContextEnabled=(env={},subject)=>env.ORIGEN_REVIEW_RESPONSE_CONTEXT==='true'&&reviewRequestsEnabled(env)&&personalizationControls(env,subject).retrieval;
function student(value){if(typeof value!=='string'||!value.trim()||value.length>128||/[\x00-\x1f\x7f]/.test(value))throw fail(400,'invalid_review_response_context');return value;}
export function validateReviewResponseContext(input){
 if(!object(input)||Object.keys(input).some(k=>!['studentId','query','focus'].includes(k)))throw fail(400,'invalid_review_response_context');
 const studentId=student(input.studentId);
 if(input.focus!==undefined){if(input.query!==undefined)throw fail(400,'invalid_review_response_context');return {studentId,focus:validateReviewResponseReference(input.focus)};}
 if(typeof input.query!=='string'||input.query.length>1000||/[\x00-\x1f\x7f]/.test(input.query))throw fail(400,'invalid_review_response_context');
 return {studentId,query:input.query};
}
export function validateReviewResponseGuard(value){
 if(!object(value)||Object.keys(value).some(k=>!['source','revision','mode'].includes(k))||!['focus','question'].includes(value.mode)||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision))throw fail(400,'invalid_review_response_context');
 return {source:validateReviewResponseReference(value.source),revision:value.revision,mode:value.mode};
}
const unavailable=reason=>({status:'unavailable',reason});
const command=async(c,input)=>{
 const result=(await c.query('SELECT origen_review_response_context_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error==='invalid_review_response_context'?400:result.error==='review_response_context_paused'?503:result.error==='review_response_context_denied'?403:409,result.error);
 return result;
};
async function transaction(database,subject,env,work,{signal}={}){
 return withRequestDeadline(async abort=>{
  if(!database)throw fail(503,'review_response_context_unavailable');
  const c=await database.connect();let active=false;const outcomeEnabled=env.ORIGEN_OUTCOME_EVIDENCE==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP==='true';
  try{
   abort.throwIfAborted();await c.query('BEGIN');active=true;await c.query("SET LOCAL statement_timeout='700ms'");
   await guardAccountTransaction(c,subject);abort.throwIfAborted();
   if(!reviewResponseContextEnabled(env,subject))return unavailable('paused');
   await c.query("SELECT set_config('origen.review_response_context','true',true),set_config('origen.outcome_context',$1,true),set_config('origen.outcome_rule_version',$2,true)",[env.ORIGEN_OUTCOME_EVIDENCE==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP==='true'?'true':'false',OUTCOME_ASSESSMENT_RULE_VERSION]);
   const result=await work(c,abort);
   abort.throwIfAborted();await guardAccountTransaction(c,subject);
   if(!reviewResponseContextEnabled(env,subject))return unavailable('paused');
   if(outcomeEnabled!==(env.ORIGEN_OUTCOME_EVIDENCE==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP==='true'))return unavailable('source_changed');
   await c.query('COMMIT');active=false;abort.throwIfAborted();return result;
  }finally{if(active)await c.query('ROLLBACK').catch(()=>{});c.release();}
 },{signal,timeoutMs:1000});
}

// Optional voice binding comes from a verified live-memory session and the
// independently captured transcript, never from model arguments or HTTP flags.
export async function loadReviewResponseContext(database,subject,input,env={},options={}){
 const selection=validateReviewResponseContext(input);
 if(!reviewResponseContextEnabled(env,subject))return unavailable('paused');
 const search=selection.focus?null:reviewResponseSearch(selection.query);
 if(search&&!search.terms.length)return {status:'none'};
 return transaction(database,subject,env,async(c,signal)=>{
  let ref=selection.focus;
  if(!ref){
   const found=await command(c,{action:'candidates',studentId:selection.studentId,...search});signal.throwIfAborted();
   if(found.status!=='candidates')return found;
   if(!found.candidates.length)return {status:'none'};
   if(found.truncated||found.candidates.length>1)return {status:'clarification_required',reason:found.truncated?'candidate_limit':'multiple_responses',choices:found.candidates.slice(0,3),instruction:'Ask which coordinator response the student means, or ask them to select it in their binder. Do not choose or combine advice.'};
   ref=found.candidates[0].source;
  }
  const mode=selection.focus?'focus':'question';
  const voice=options.voice?{sessionId:options.voice.sessionId,sequence:options.voice.sequence,turnId:options.voice.turnId,transcriptHash:createHash('sha256').update(options.voice.transcript).digest('hex')}:undefined;
  const result=await command(c,{action:'read',studentId:selection.studentId,source:ref,mode,...(voice?{voice}:{})});
  signal.throwIfAborted();if(result.status!=='retrieved')return result;
  // A second READ COMMITTED statement observes edits/withdrawal during loading.
  const verified=await command(c,{action:'verify',studentId:selection.studentId,...result.guard});
  if(verified.status!=='current')return unavailable('source_changed');
  const {outcomeInputs,...context}=result;const outcomeAssessment=assessOutcomeContext(outcomeInputs);
  return {...context,...(outcomeAssessment?{outcomeAssessment}:{})};
 },options);
}

export async function verifyReviewResponseContext(database,subject,studentId,guard,env={},options={}){
 return verifyReviewResponseContexts(database,subject,studentId,[guard],env,options);
}
export async function verifyReviewResponseContexts(database,subject,studentId,guards,env={},options={}){
 student(studentId);
 if(!Array.isArray(guards)||!guards.length||guards.length>8)throw fail(400,'invalid_review_response_context');
 const expected=guards.map(validateReviewResponseGuard);
 if(!reviewResponseContextEnabled(env,subject))return unavailable('paused');
 return transaction(database,subject,env,async(c,signal)=>{
  for(const guard of expected){signal.throwIfAborted();const result=await command(c,{action:'verify',studentId,...guard});if(result.status!=='current')return result;}
  return {status:'current'};
 },options);
}
export async function assertReviewResponseContextReady(database,env={}){
 if(env.ORIGEN_REVIEW_RESPONSE_CONTEXT!=='true')return;
 const migrated=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='103_review_response_followups.sql'")).rows.length;
 const allowed=migrated&&(await database.query("SELECT has_function_privilege(current_user,'origen_review_response_context_command(jsonb)','EXECUTE') AND has_function_privilege(current_user,'origen_review_response_choice_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed;
 if(!allowed)throw new Error('review_response_context_migration_required');
}

// Student-owned lookup/verification only. The live-memory path derives student
// scope from its session; binder focus uses this same exact lookup.
export function createReviewResponseContextHandler(database,env={}){return async(req,res,next)=>{
 if(req.url!=='/api/review-response-context')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 const abort=new AbortController(),cancel=()=>{if(!res.writableEnded)abort.abort();};req.on?.('aborted',cancel);res.on?.('close',cancel);
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return send(413,{error:'too_large'});}
  let input;try{input=JSON.parse(body);}catch{return send(400,{error:'invalid_review_response_context'});}
  if(!object(input)||!['lookup','verify'].includes(input.action))throw fail(400,'invalid_review_response_context');
  let result;
  if(input.action==='lookup'){const {action,...selection}=input;result=await loadReviewResponseContext(database,req.origenIdentity.sub,selection,env,{signal:abort.signal});}
  else{if(Object.keys(input).some(k=>!['action','studentId','guard','guards'].includes(k))||input.guard!==undefined&&input.guards!==undefined)throw fail(400,'invalid_review_response_context');result=await verifyReviewResponseContexts(database,req.origenIdentity.sub,input.studentId,input.guards??[input.guard],env,{signal:abort.signal});}
  return send(200,result);
 }catch(error){const known=[400,403,409].includes(error.status);return send(known?error.status:503,{error:known?error.message:'review_response_context_unavailable'});}
 finally{req.off?.('aborted',cancel);res.off?.('close',cancel);}
};}

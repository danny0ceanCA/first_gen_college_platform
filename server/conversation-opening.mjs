import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {studentFollowUpEnabled} from './student-follow-up.mjs';
import {rankBinderNextSteps} from './binder-next-step.mjs';
import {followUpOpeningText,normalizedOpening,declinesCheckIn} from '../src/followUpOpening.mjs';
import {allowedRequest} from './origin.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash=text=>createHash('sha256').update(normalizedOpening(text)).digest('hex');
const fail=(status,message)=>Object.assign(Error(message),{status});
export function openingPolicy(input){
 const currentQuestion=Array.isArray(input.continuity)&&input.continuity.some(t=>t?.role==='user'&&typeof t.text==='string'&&t.text.trim());
 const selection=input.workspace?.selection,focus=input.workspaceFocus?.kind==='action'?{planId:input.workspaceFocus.planId,stepId:input.workspaceFocus.stepId}:null;
 const eligible=input.adaptiveEnabled!==false&&!!(input.experience?.usedApp||input.experience?.usedVoice)&&input.onboarding!==true&&!input.continuing&&!input.scopeRestart&&!input.workspaceRefreshOnly&&!input.continuity?.length&&!currentQuestion&&(!input.routeConversations||input.targetConfirmed===true)&&(!selection||['action','topic'].includes(selection));
 const topics=input.workspace?.topic?[input.workspace.topic]:['finance','loans'].includes(input.mode)?['costs']:input.mode==='admissions'?['applications']:['options','transfer'];
 return {eligible,focus,focusTopic:input.workspace?.topic||null,topics,genericEligible:eligible&&!selection};
}
async function transaction(database,subject,env,work){
 if(!database)throw fail(503,'conversation_opening_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3000ms'");await guardAccountTransaction(c,subject);
  if(studentFollowUpEnabled(env,subject))await c.query("SELECT set_config('origen.student_follow_up','true',true)");
  const command=async input=>(await c.query('SELECT origen_conversation_opening_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
  const result=await work(command);await guardAccountTransaction(c,subject);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

// Called only with the authenticated, server-assembled workspace. No select or
// bind operation is exposed through the HTTP handler or model tool definitions.
export async function selectConversationOpening(database,subject,input,{conversationId,memorySessionId,allowFollowUp=false,env={}}={}){
 if(!studentFollowUpEnabled(env,subject))return undefined;
 if(!uuid(conversationId))return {opening:null,reason:'conversation_identity_required'};
 const policy=openingPolicy(input),fallbacks=policy.genericEligible?rankBinderNextSteps(input).slice(0,12):[];
 return transaction(database,subject,env,async command=>{
  const selected=await command({action:'select',conversationId,studentId:input.studentId??null,language:input.language,
   eligible:policy.eligible&&['planning','finance','loans','admissions'].includes(input.mode)&&input.workspace?.available===true,
   allowFollowUp:allowFollowUp===true&&input.role==='student',memorySessionId:uuid(memorySessionId)?memorySessionId:null,focus:policy.focus,focusTopic:policy.focusTopic,topics:policy.topics,
   fallbacks:fallbacks.map(c=>({kind:c.kind,...(c.kind==='action'?{target:{planId:c.evidence?.record?.planId,stepId:c.evidence?.record?.id}}:{})}))});
  if(!studentFollowUpEnabled(env,subject))throw fail(503,'conversation_opening_paused');
  if(selected.status!=='selected')return {opening:null,reason:selected.reason||'unavailable'};
  if(selected.kind!=='student-follow-up')return {opening:fallbacks[selected.fallbackIndex]||null,reason:'reserved'};
  const presentation=followUpOpeningText(selected.candidate.title,input.language);
  const bound=await command({action:'bind',conversationId,studentId:input.studentId,claimId:selected.claimId,presentationHash:hash(presentation)});
  if(bound.status!=='current')return {opening:null,reason:'unavailable'};
  return {opening:{kind:'student-follow-up',...selected.candidate,presentation},reason:'reserved',claim:{studentId:input.studentId,conversationId,claimId:selected.claimId,expiresAt:selected.expiresAt,presentation}};
 });
}

export function validateOpeningEvidence(input){
 const actions={verify:[],release:[],present:['presentation'],defer:['sequence','turnId','transcript']};
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(actions,input.action))throw fail(400,'invalid_opening_evidence');
 const keys=['action','studentId','conversationId','claimId',...actions[input.action]];
 if(Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||!uuid(input.conversationId)||!uuid(input.claimId)||typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128)throw fail(400,'invalid_opening_evidence');
 if(input.action==='present'&&(typeof input.presentation!=='string'||!input.presentation.trim()||input.presentation.length>1000))throw fail(400,'invalid_opening_evidence');
 if(input.action==='defer'&&(!Number.isSafeInteger(input.sequence)||input.sequence<1||input.sequence>2147483647||typeof input.turnId!=='string'||!input.turnId.trim()||input.turnId.length>160||typeof input.transcript!=='string'||input.transcript.length>2000||!declinesCheckIn(input.transcript)))throw fail(400,'invalid_opening_evidence');
 return input;
}
export function createOpeningEvidenceRepository(database,env={}){return async(subject,raw)=>{
 const input=validateOpeningEvidence(raw),{presentation,...command}=input;
 if(presentation!==undefined)command.presentationHash=hash(presentation);
 return transaction(database,subject,env,async run=>{
  const result=await run(command);
  if(['verify','present'].includes(input.action)&&!studentFollowUpEnabled(env,subject))throw fail(503,'conversation_opening_paused');
  return result;
 });
};}
export function createOpeningEvidenceHandler(database,env={}){const run=createOpeningEvidenceRepository(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/conversation-opening')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_opening_evidence'});}return send(200,await run(req.origenIdentity.sub,input));}
 catch(e){return send([400,403,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'conversation_opening_unavailable'});}
};}

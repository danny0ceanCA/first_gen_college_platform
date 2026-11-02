import {assessPrivateEpisodes} from './outcome-assessment.mjs';
import {createFollowUpConversationRepository,validateFollowUpConversation} from './follow-up-conversations.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {allowedRequest} from './origin.mjs';
import {studentFollowUpEnabled,assertStudentFollowUpReady} from './student-follow-up.mjs';
import {validateFollowUpTarget} from '../src/studentFollowUp.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export const outcomeEvidenceEnabled=(env={},subject)=>env.ORIGEN_OUTCOME_EVIDENCE==='true'&&studentFollowUpEnabled(env,subject);
export function validateOutcomeEvidence(input){
 if(['prepare','confirm'].includes(input?.action))return validateFollowUpConversation(input,false,'outcome');
 const fields={definitions:[],load:['studentId','target'],'delete-episode':['studentId','target','id','version']};
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.action!=='string'||!Object.hasOwn(fields,input.action))throw fail(400,'invalid_outcome_evidence');
 const keys=['action',...fields[input.action]];
 if(Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))throw fail(400,'invalid_outcome_evidence');
 if(input.action==='definitions')return {...input};
 if(typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128||/[\x00-\x1f\x7f]/.test(input.studentId))throw fail(400,'invalid_outcome_evidence');
 let target;try{target=validateFollowUpTarget(input.target);}catch{throw fail(400,'invalid_outcome_evidence');}
 if(input.action==='delete-episode'&&(typeof input.id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.id)||!Number.isSafeInteger(input.version)||input.version<1||input.version>2147483647))throw fail(400,'invalid_outcome_evidence');
 return {...input,target};
}
export async function assertOutcomeEvidenceReady(database,env={}){
 if(env.ORIGEN_OUTCOME_EVIDENCE!=='true')return;
 if(!database)throw Error('outcome_evidence_migration_required');
 await assertStudentFollowUpReady(database,{...env,ORIGEN_STUDENT_FOLLOW_UP:'true'});
 const migrated=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name IN ('109_outcome_evidence_foundation.sql','110_student_outcome_recording.sql','111_coordinator_outcome_observations.sql','112_outcome_assessment_context.sql')")).rows.length===4;
 if(!migrated)throw Error('outcome_evidence_migration_required');
 const allowed=(await database.query("SELECT has_function_privilege(current_user,'origen_outcome_evidence_command(jsonb)','EXECUTE') AS allowed")).rows[0]?.allowed;
 if(!allowed)throw Error('outcome_evidence_migration_required');
 for(const fn of ['origen_coordinator_outcome_command(jsonb)','origen_student_outcome_observation_command(jsonb)'])if(!(await database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed",[fn])).rows[0]?.allowed)throw Error('outcome_evidence_migration_required');
 for(const table of ['origen_outcome_review_capabilities','origen_outcome_observations','origen_outcome_observation_disputes','origen_outcome_observation_previews','origen_outcome_definitions','origen_outcome_episodes','origen_outcome_evidence']){
  if((await database.query('SELECT has_table_privilege(current_user,$1,\'SELECT,INSERT,UPDATE,DELETE\') AS allowed',[table])).rows[0]?.allowed)throw Error('outcome_evidence_runtime_isolation_required');
 }
 const helpers=(await database.query("SELECT bool_or(has_function_privilege(current_user,oid,'EXECUTE')) AS allowed FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'origen_outcome_%' AND proname<>'origen_outcome_evidence_command'")).rows[0]?.allowed;
 if(helpers)throw Error('outcome_evidence_runtime_isolation_required');
}
export function createOutcomeEvidenceRepository(database,env={}){return async(subject,raw)=>{
 if(['prepare','confirm'].includes(raw?.action))return createFollowUpConversationRepository(database,env,'outcome')(subject,raw);
 const input=validateOutcomeEvidence(raw);if(!database)throw fail(503,'outcome_evidence_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3000ms'");await guardAccountTransaction(c,subject);
  const result=(await c.query('SELECT origen_outcome_evidence_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
  if(result.error)throw fail(result.error.startsWith('invalid_')?400:result.error.endsWith('_changed')?409:result.error.endsWith('_unavailable')?404:403,result.error);
  await guardAccountTransaction(c,subject);await c.query('COMMIT');
  const episodes=result.episodes?.slice(0,50),ids=new Set(episodes?.map(e=>e.id));
  const evidence=result.evidence?.filter(e=>ids.has(e.episode_id)).slice(0,100);
  const assessments=episodes&&outcomeEvidenceEnabled(env,subject)?assessPrivateEpisodes({...result,episodes,evidence,limited:result.episodes.length>50||result.evidence.length>100||evidence.length!==result.evidence.length}):undefined;
  return {...result,...(assessments?{assessments}:{}),...(episodes?{episodes,evidence,limited:result.episodes.length>50||result.evidence.length>100||evidence.length!==result.evidence.length}:{}),enabled:outcomeEvidenceEnabled(env,subject),canRecord:outcomeEvidenceEnabled(env,subject)&&result.canRecord===true,canAssess:outcomeEvidenceEnabled(env,subject),evaluationEnabled:env.ORIGEN_OUTCOME_EVALUATION==='true'};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createOutcomeEvidenceHandler(database,env={}){const run=createOutcomeEvidenceRepository(database,env);return async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/api/outcome-evidence')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>18000)return send(413,{error:'too_large'});}let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_outcome_evidence'});}return send(200,await run(req.origenIdentity.sub,input));}
 catch(e){return send([400,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'outcome_evidence_unavailable'});}
};}

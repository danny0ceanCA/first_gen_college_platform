import {allowedRequest} from './origin.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {assertOutcomeEvidenceReady} from './outcome-evidence.mjs';
import {validateEvaluationCommand} from '../src/outcomeEvaluation.mjs';
import {qualityRows,evidenceQualityReport} from './outcome-quality.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export const outcomeEvaluationEnabled=env=>env.ORIGEN_OUTCOME_EVALUATION==='true';
const resultOf=async(c,fn,input)=>{
 const result=(await c.query(`SELECT ${fn}($1::jsonb) AS result`,[JSON.stringify(input)])).rows[0].result;
 if(result.error)throw fail(result.error.endsWith('_changed')?409:result.error.endsWith('_paused')?503:result.error.endsWith('_unavailable')?404:result.error.startsWith('invalid_')?400:403,result.error);
 return result;
};
export async function assertOutcomeEvaluationReady(database,env={}){
 if(!outcomeEvaluationEnabled(env))return;
 await assertOutcomeEvidenceReady(database,{...env,ORIGEN_OUTCOME_EVIDENCE:'true'});
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='113_outcome_evaluation_permissions.sql'")).rows.length)throw Error('outcome_evaluation_migration_required');
 for(const fn of ['origen_student_outcome_evaluation_command(jsonb)','origen_service_quality_command(jsonb)'])if(!(await database.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS allowed",[fn])).rows[0]?.allowed)throw Error('outcome_evaluation_migration_required');
 for(const table of ['origen_outcome_evaluation_permissions','origen_outcome_evaluation_previews','origen_outcome_evaluation_capabilities'])if((await database.query("SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[table])).rows[0]?.allowed)throw Error('outcome_evaluation_runtime_isolation_required');
}
export function createOutcomeEvaluationRepository(database,env={}){return async(subject,raw,report=false)=>{
 const input=validateEvaluationCommand(raw,report);if(!database)throw fail(503,'evaluation_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");
  const enabled=outcomeEvaluationEnabled(env);let result;
  if(report){
   const body={...input,action:'load',enabled};
   const bundle=await resultOf(c,'origen_service_quality_command',body);
   const cutoff=new Date(bundle.cutoff).toISOString();
   result=evidenceQualityReport(qualityRows(bundle,new Date(cutoff)),{definitionId:input.definitionId,period:bundle.period,cutoff,limited:bundle.limited});
   const checked=await resultOf(c,'origen_service_quality_command',{...body,action:'verify',revision:bundle.revision});
   if(!checked.current)throw fail(409,'evaluation_changed');
  }else{
   await guardAccountTransaction(c,subject);
   result=await resultOf(c,'origen_student_outcome_evaluation_command',{...input,enabled});
   await guardAccountTransaction(c,subject);
  }
  if((report||['prepare','confirm'].includes(input.action))&&!outcomeEvaluationEnabled(env))throw fail(503,'evaluation_paused');
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createOutcomeEvaluationHandler(database,env={},fetcher=fetch){const run=createOutcomeEvaluationRepository(database,env);return async(req,res,next)=>{
 const path=req.url?.split('?')[0],report=path==='/api/outcome-evaluation-report';if(!report&&path!=='/api/outcome-evaluation')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{
  let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}let input;try{input=validateEvaluationCommand(JSON.parse(raw),report);}catch{return send(400,{error:'invalid_outcome_evaluation'});}
  if(report){
   if(!database||env.ORIGEN_COORDINATOR_ACCOUNTS!=='true'||!outcomeEvaluationEnabled(env))return send(503,{error:'evaluation_paused'});
   await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:'outcome-quality-report',target:input.organizationId,env,fresh:true});
   const trusted=await invitationIdentity(req,env,fetcher);if(trusted.email_verified!==true||!trusted.email?.trim())return send(403,{error:'verified_email_required'});
   return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},()=>run(req.origenIdentity.sub,input,true)));
  }
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(e){return send([400,401,403,404,409,503].includes(e.status)?e.status:503,{error:e.status?e.message:'evaluation_unavailable'});}
};}

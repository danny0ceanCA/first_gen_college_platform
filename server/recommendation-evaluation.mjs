import {allowedRequest} from './origin.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
import {requireStaffAccess} from './staff-access.mjs';
import {invitationIdentity} from './institution-access.mjs';
import {validateRecommendationEvaluation} from '../src/recommendationEvaluation.mjs';
import {recommendationEvaluationRows,recommendationQualityReport} from './recommendation-evaluation-quality.mjs';
export const recommendationEvaluationEnabled=env=>env.ORIGEN_RECOMMENDATION_EVALUATION==='true';
const fail=(status,message)=>Object.assign(Error(message),{status});
async function command(c,fn,input){const r=(await c.query(`SELECT ${fn}($1::jsonb) AS result`,[JSON.stringify(input)])).rows[0].result;if(r.error)throw fail(r.error.endsWith('_changed')?409:r.error.endsWith('_paused')?503:r.error.endsWith('_limited')?429:r.error.startsWith('invalid_')?400:403,r.error);return r;}
export async function recordRecommendationEvaluation(c,env,input){
 if(!recommendationEvaluationEnabled(env))return;
 // Collection failure must not remove guidance from a consenting student.
 await c.query('SAVEPOINT recommendation_evaluation');try{await c.query("SELECT set_config('origen.recommendation_evaluation','true',true)");await c.query('SELECT origen_recommendation_evaluation_record($1::jsonb)',[JSON.stringify(input)]);await c.query('RELEASE SAVEPOINT recommendation_evaluation');}catch{await c.query('ROLLBACK TO SAVEPOINT recommendation_evaluation');await c.query('RELEASE SAVEPOINT recommendation_evaluation');}
}
export async function purgeRecommendationEvaluation(database){if((await database.query("SELECT to_regprocedure('origen_recommendation_evaluation_purge()') AS fn")).rows[0]?.fn)await database.query('SELECT origen_recommendation_evaluation_purge()');}
export async function assertRecommendationEvaluationReady(database,env={}){
 if(!recommendationEvaluationEnabled(env))return;if(!database)throw Error('recommendation_evaluation_migration_required');
 for(const name of ['119_recommendation_evaluation.sql','120_recommendation_evaluation_report.sql'])if(!(await database.query('SELECT 1 FROM origen_schema_migrations WHERE name=$1',[name])).rows.length)throw Error('recommendation_evaluation_migration_required');
 const allowed=['origen_student_recommendation_evaluation(jsonb)','origen_recommendation_evaluation_record(jsonb)','origen_recommendation_evaluation_report(jsonb)'];
 for(const fn of [...allowed,'origen_recommendation_evaluation_scope(uuid,text,uuid)','origen_recommendation_evaluation_view(uuid,text)','origen_recommendation_evaluation_receipt_current(uuid,uuid)','origen_recommendation_evaluation_grant(uuid,uuid,timestamptz)','origen_recommendation_evaluation_after_restore()','origen_recommendation_evaluation_purge()']){
  const r=(await database.query("SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[fn])).rows[0];
  if(!r||r.allowed!==allowed.includes(fn)||r.public_execute)throw Error('recommendation_evaluation_isolation_required');
 }
 for(const suffix of ['permissions','previews','receipts','capabilities','report_budget'])if((await database.query("SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",['origen_recommendation_evaluation_'+suffix])).rows[0]?.allowed)throw Error('recommendation_evaluation_isolation_required');
}
export function createRecommendationEvaluationRepository(database,env={}){return async(subject,raw,report=false)=>{
 const input=validateRecommendationEvaluation(raw,report);if(!database)throw fail(503,'evaluation_unavailable');const c=await database.connect();
 try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");const enabled=recommendationEvaluationEnabled(env);let result;
  if(report){const body={...input,action:'load',enabled},bundle=await command(c,'origen_recommendation_evaluation_report',body);result=recommendationQualityReport(recommendationEvaluationRows(bundle),bundle);await command(c,'origen_recommendation_evaluation_report',{...body,action:'verify',revision:bundle.revision});}
  else{await guardAccountTransaction(c,subject);result=await command(c,'origen_student_recommendation_evaluation',{...input,enabled});await guardAccountTransaction(c,subject);}
  if((report||['prepare','confirm'].includes(input.action))&&!recommendationEvaluationEnabled(env))throw fail(503,'evaluation_paused');await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
};}
export function createRecommendationEvaluationHandler(database,env={},fetcher=fetch){const run=createRecommendationEvaluationRepository(database,env);return async(req,res,next)=>{
 const path=req.url?.split('?')[0],report=path==='/api/recommendation-evaluation-report';if(!report&&path!=='/api/recommendation-evaluation')return next();
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});if(!allowedRequest(req))return send(403,{error:'origin_not_allowed'});if(req.method!=='POST')return send(405,{error:'method_not_allowed'});if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 try{let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>4096)return send(413,{error:'too_large'});}let input;try{input=validateRecommendationEvaluation(JSON.parse(raw),report);}catch{return send(400,{error:'invalid_recommendation_evaluation'});}
  if(report){if(!recommendationEvaluationEnabled(env)||env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')return send(503,{error:'evaluation_paused'});await requireStaffAccess(database,req.origenIdentity,{scope:'institution',action:'recommendation-quality-report',target:input.organizationId,env,fresh:true});const identity=await invitationIdentity(req,env,fetcher);if(identity.email_verified!==true||!identity.email?.trim())return send(403,{error:'verified_email_required'});return send(200,await runAsCoordinatorActor(req.origenIdentity.sub,{issuedAt:req.origenIdentity.iat},()=>run(req.origenIdentity.sub,input,true)));}
  return send(200,await run(req.origenIdentity.sub,input));
 }catch(e){return send([400,401,403,409,429,503].includes(e.status)?e.status:503,{error:e.status?e.message:'evaluation_unavailable'});}
};}

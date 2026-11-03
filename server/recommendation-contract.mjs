import {assertRecommendationEvaluationReady} from './recommendation-evaluation.mjs';
import {validateRecommendationCommand,recommendationContract} from '../src/recommendationContract.mjs';
import {studentFollowUpEnabled,assertStudentFollowUpReady} from './student-follow-up.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
export {recommendationFlags,recommendationConfigurationIssues} from './recommendation-settings.mjs';
export const recommendationsEnabled=(env={},subject)=>env.ORIGEN_RECOMMENDATIONS==='true'&&studentFollowUpEnabled(env,subject);
export async function assertRecommendationContractReady(database,env={}){
 await assertRecommendationEvaluationReady(database,env);
 if(env.ORIGEN_RECOMMENDATIONS!=='true')return;
 if(!database)throw Error('recommendation_contract_migration_required');
 await assertStudentFollowUpReady(database,{...env,ORIGEN_STUDENT_FOLLOW_UP:'true'});
 const migrated=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='114_recommendation_contract.sql'")).rows.length===1;
 if(!migrated)throw Error('recommendation_contract_migration_required');
 const row=(await database.query("SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed, EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid='origen_recommendation_source_command(jsonb)'::regprocedure")).rows[0];
 if(!row?.allowed)throw Error('recommendation_contract_migration_required');
 if(row.public_execute)throw Error('recommendation_contract_isolation_required');
 const library=(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='115_recommendation_library.sql'")).rows.length===1;
 if(!library)throw Error('recommendation_library_migration_required');
 for(const signature of ['origen_recommendation_library_command(jsonb)','origen_recommendation_catalog_command(jsonb)','origen_recommendation_source_v1(jsonb)','origen_recommendation_template_current(uuid)','origen_recommendation_library_grant(text,boolean,boolean,text[],timestamptz)','origen_recommendation_library_after_restore()']){
  const access=(await database.query("SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed, EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[signature])).rows[0];
  const callable=['origen_recommendation_library_command(jsonb)','origen_recommendation_catalog_command(jsonb)'].includes(signature);
  if(!access||access.allowed!==callable||access.public_execute)throw Error('recommendation_library_isolation_required');
 }
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='116_recommendation_selection.sql'")).rows.length)throw Error('recommendation_selection_migration_required');
 const selection=(await database.query("SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=to_regprocedure('origen_recommendation_selection_inputs(jsonb)')")).rows[0];
 if(!selection?.allowed||selection.public_execute)throw Error('recommendation_selection_isolation_required');
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='117_recommendation_acceptance.sql'")).rows.length)throw Error('recommendation_acceptance_migration_required');
 if(!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='118_recommendation_outcome_provenance.sql'")).rows.length)throw Error('recommendation_provenance_migration_required');
 for(const signature of ['origen_recommendation_delivery_command(jsonb)','origen_recommendation_outcomes_export()','origen_recommendation_acceptance_after_restore()','origen_recommendation_purge()']){
  const access=(await database.query("SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[signature])).rows[0];
  if(!access||access.allowed!==['origen_recommendation_delivery_command(jsonb)','origen_recommendation_outcomes_export()'].includes(signature)||access.public_execute)throw Error('recommendation_acceptance_isolation_required');
 }
 for(const name of ['origen_recommendation_previews','origen_plan_recommendations','origen_outcome_recommendation_links'])if((await database.query("SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",[name])).rows[0]?.allowed)throw Error('recommendation_acceptance_isolation_required');
}
// Internal read-only resolver, not an HTTP endpoint or model tool. Resolved
// metadata is transient and must be re-resolved before use in later steps.
export function createRecommendationSourceRepository(database,env={}){return async(subject,raw)=>{
 const input=validateRecommendationCommand(raw),fail=(status,message)=>Object.assign(Error(message),{status});
 if(!recommendationsEnabled(env,subject))throw fail(503,'recommendation_paused');
 if(!database)throw fail(503,'recommendation_unavailable');
 const c=await database.connect();try{
  await c.query('BEGIN');await c.query(`SET LOCAL statement_timeout='${recommendationContract.limits.statementTimeoutMs}ms'`);
  await guardAccountTransaction(c,subject);await c.query("SELECT set_config('origen.recommendations','true',true)");
  const result=(await c.query('SELECT origen_recommendation_source_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
  if(result.error)throw fail(result.error.startsWith('invalid_')?400:result.error.endsWith('_paused')?503:403,result.error);
  await guardAccountTransaction(c,subject);if(!recommendationsEnabled(env,subject))throw fail(503,'recommendation_paused');
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
};}

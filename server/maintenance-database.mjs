import {createDatabase} from './database.mjs';
import {sqlIdentifier} from './account-isolation.mjs';

// A distinct restricted LOGIN, never the HTTP or migration identity.
export function createMaintenanceDatabase(env=process.env,Pool){
 if(!env.DATABASE_URL)return null;
 if(!env.MAINTENANCE_DATABASE_URL)throw new Error('maintenance_database_required');
 const api=new URL(env.DATABASE_URL),maintenance=new URL(env.MAINTENANCE_DATABASE_URL);
 if(decodeURIComponent(api.username)===decodeURIComponent(maintenance.username)||api.hostname!==maintenance.hostname||api.port!==maintenance.port||api.pathname!==maintenance.pathname)throw new Error('separate_maintenance_role_required');
 return createDatabase({...env,DATABASE_URL:env.MAINTENANCE_DATABASE_URL},Pool,{max:1});
}
export const maintenanceReadTables=Object.freeze(['origen_binder_jobs','origen_schema_migrations','origen_accounts','origen_privacy_preferences','origen_closed_accounts','origen_subject_locks','origen_eligibility','origen_permission_calls','origen_permission_events','origen_diagnostic_operations','origen_institution_metrics','origen_family_invites','origen_conversation_summaries','origen_privacy_events','origen_institution_inquiries','origen_institution_outreach_facts','origen_institution_outreach_batches','origen_institution_campaign_metrics','origen_guidance_sessions','origen_ai_executions','origen_profile_observations','origen_plan_revisions','origen_progress_reports','origen_feedback_prompts','origen_institution_report_snapshots','origen_conversation_quality','origen_onboarding_attempts','origen_onboarding_events','origen_admin_issue_reviews','origen_guidance_segments','origen_guidance_events','origen_voice_quality_events','origen_summary_segments']);
export const maintenanceDeleteTables=Object.freeze(['origen_binder_jobs','origen_permission_calls','origen_permission_events','origen_diagnostic_operations','origen_institution_metrics','origen_family_invites','origen_conversation_summaries','origen_privacy_events','origen_institution_inquiries','origen_institution_outreach_facts','origen_institution_outreach_batches','origen_institution_campaign_metrics','origen_guidance_sessions','origen_profile_observations','origen_plan_revisions','origen_progress_reports','origen_feedback_prompts','origen_institution_report_snapshots','origen_conversation_quality','origen_onboarding_attempts','origen_admin_issue_reviews']);
export async function grantMaintenanceAccess(pool,role,{schema='public'}={}){
 const who=sqlIdentifier(role),base=sqlIdentifier(schema),c=await pool.connect();
 try{
  await c.query('BEGIN');const r=(await c.query(`SELECT r.rolcanlogin AND NOT EXISTS(SELECT 1 FROM pg_roles p WHERE pg_has_role(r.oid,p.oid,'MEMBER') AND (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb OR p.rolreplication)) AS safe,
   EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$2 AND pg_has_role(r.oid,t.relowner,'MEMBER')) AS owner FROM pg_roles r WHERE r.rolname=$1`,[role,schema])).rows[0];
  if(!r?.safe||r.owner)throw new Error('restricted_maintenance_role_required');
  await c.query(`REVOKE ALL ON SCHEMA ${base} FROM ${who}; GRANT USAGE ON SCHEMA ${base} TO ${who}`);
  await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${base} FROM ${who}`);
  for(const table of maintenanceReadTables)await c.query(`GRANT SELECT ON ${base}.${sqlIdentifier(table)} TO ${who}`);
  for(const table of maintenanceDeleteTables)await c.query(`GRANT DELETE ON ${base}.${sqlIdentifier(table)} TO ${who}`);
  for(const [table,columns] of [['origen_binder_jobs','status,attempts,attempt_times,available_at,lease_until,lease_token'],['origen_permission_calls','hangup_pending_at,hangup_attempts'],['origen_eligibility','guardian_email,approval_hash,withdrawal_hash'],['origen_guidance_sessions','ended_at,end_reason'],['origen_ai_executions','status,finished_at']])await c.query(`GRANT UPDATE(${columns}) ON ${base}.${sqlIdentifier(table)} TO ${who}`);
  // Existing account locks guard opt-in summary expiry against closure/saves.
  await c.query(`GRANT INSERT,UPDATE ON ${base}.origen_subject_locks TO ${who}`);
  await c.query(`GRANT UPDATE(id) ON ${base}.origen_accounts TO ${who}`);
  await c.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_current_account_id() TO ${who}`);
  if((await c.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_coordinator_maintain()`])).rows[0].fn)await c.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_coordinator_maintain() TO ${who}`);
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export async function assertMaintenanceAccess(pool,{schema='public'}={}){
 const r=(await pool.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication AS powerful,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND pg_has_role(r.oid,c.relowner,'MEMBER')) AS owner,
 has_table_privilege(current_user,$2,'INSERT') AS inserts_content,
 EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS member
 FROM pg_roles r WHERE r.rolname=current_user`,[schema,`${schema}.origen_conversation_summaries`])).rows[0];
 if(!r||r.powerful||r.owner||r.inserts_content||r.member)throw new Error('restricted_maintenance_role_required');
 const allowedUpdates={origen_binder_jobs:['status','attempts','attempt_times','available_at','lease_until','lease_token'],origen_subject_locks:null,origen_accounts:['id'],origen_permission_calls:['hangup_pending_at','hangup_attempts'],origen_eligibility:['guardian_email','approval_hash','withdrawal_hash'],origen_guidance_sessions:['ended_at','end_reason'],origen_ai_executions:['status','finished_at']};
 const tables=(await pool.query(`SELECT c.oid,c.relname,c.relrowsecurity,has_table_privilege(current_user,c.oid,'SELECT') AS reads,has_table_privilege(current_user,c.oid,'INSERT') AS inserts,has_table_privilege(current_user,c.oid,'DELETE') AS deletes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'`,[schema])).rows;
 for(const table of tables){
  if(table.reads!==maintenanceReadTables.includes(table.relname)||table.inserts!==(table.relname==='origen_subject_locks')||table.deletes!==maintenanceDeleteTables.includes(table.relname)||table.reads&&!['origen_schema_migrations','origen_institution_metrics','origen_institution_inquiries','origen_institution_outreach_facts','origen_institution_outreach_batches','origen_institution_campaign_metrics','origen_institution_report_snapshots'].includes(table.relname)&&!table.relrowsecurity)throw new Error('restricted_maintenance_role_required');
  const columns=(await pool.query('SELECT attname,has_column_privilege(current_user,attrelid,attnum,\'UPDATE\') AS updates FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped',[table.oid])).rows;
  const allowed=allowedUpdates[table.relname];
  if(columns.some(column=>column.updates!==(Object.hasOwn(allowedUpdates,table.relname)&&(allowed===null||allowed.includes(column.attname)))))throw new Error('restricted_maintenance_role_required');
 }
 const migration=(await pool.query("SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='041_permission_hangup_progress.sql') AS ready")).rows[0];
 if(!migration?.ready)throw new Error('maintenance_migration_required');
}

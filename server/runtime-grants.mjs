import {sqlIdentifier} from './account-isolation.mjs';
import {coordinatorTables,lineageTables} from './binder-sharing-policy.mjs';

// Run with the migration credential against Origen's dedicated database only.
// Provision a separate LOGIN externally; no passwords are accepted or printed.
export async function grantRuntimeAccess(pool,role,{schema='public'}={}){
 const who=sqlIdentifier(role),base=sqlIdentifier(schema),reporting=sqlIdentifier(`${schema}_reporting`);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows}=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb) AND pg_has_role(r.oid,p.oid,'MEMBER')) AS powerful,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2 AND pg_has_role(r.oid,c.relowner,'MEMBER')) AS owner
   FROM pg_roles r WHERE r.rolname=$1 AND r.rolcanlogin`,[role,schema]);
  if(!rows[0]||rows[0].powerful||rows[0].owner)throw new Error('separate_restricted_runtime_role_required');
  await client.query(`REVOKE CREATE ON SCHEMA ${base} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON SCHEMA ${base},${reporting} FROM ${who}`);
  await client.query(`GRANT USAGE ON SCHEMA ${base},${reporting} TO ${who}`);
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename LIKE 'origen_%'",[schema])).rows;
  for(const {tablename} of tables){
   const table=`${base}.${sqlIdentifier(tablename)}`;
   await client.query(`REVOKE ALL ON TABLE ${table} FROM ${who},PUBLIC`);
   // Phase 1 sharing records have no application privilege. Lineage is written
   // only by source triggers, never by a request or model-supplied classification.
   if(coordinatorTables.includes(tablename))continue;
   if(lineageTables.includes(tablename)){await client.query(`GRANT SELECT ON TABLE ${table} TO ${who}`);continue;}
   if(['origen_telemetry_erasure_outbox','origen_support_case_actors'].includes(tablename))continue;
   if(tablename==='origen_support_cases'){await client.query(`GRANT SELECT,INSERT ON TABLE ${table} TO ${who}`);await client.query(`GRANT UPDATE(status) ON TABLE ${table} TO ${who}`);continue;}
   const permissions=['origen_privacy_events','origen_diagnostic_operations','origen_diagnostic_request_refs'].includes(tablename)?'SELECT,INSERT,DELETE':tablename==='origen_privileged_access_audit'?'INSERT':['origen_schema_migrations','origen_student_links','origen_staff_access_controls','origen_deletion_journal','origen_identity_closures'].includes(tablename)?'SELECT':tablename==='origen_closed_accounts'?'SELECT,INSERT':tablename==='origen_subject_locks'?'SELECT,INSERT,UPDATE':'SELECT,INSERT,UPDATE,DELETE';
   await client.query(`GRANT ${permissions} ON TABLE ${table} TO ${who}`);
  }
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${reporting} FROM ${who},PUBLIC`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${reporting} TO ${who}`);
  await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${base} TO ${who}`);
  for(const signature of ['origen_current_account_id()','origen_shared_profile(text)','origen_update_shared_profile(text,jsonb,boolean)','origen_family_link_command(text,text,text)'])await client.query(`GRANT EXECUTE ON FUNCTION ${base}.${signature} TO ${who}`);
  // Provisioning uses one scoped command; no raw sharing-table access is granted.
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_registration_email_organization(uuid)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_registration_email_organization(uuid) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_admin_approved_directory(jsonb)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_admin_approved_directory(jsonb) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_admin_organization_overview(uuid,integer)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_admin_organization_overview(uuid,integer) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_coordinator_application_command(jsonb)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_coordinator_application_command(jsonb) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_coordinator_command(jsonb)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_coordinator_command(jsonb) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_coordinator_connection_command(jsonb)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_coordinator_connection_command(jsonb) TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_binder_sharing_command(jsonb)`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.origen_binder_sharing_command(jsonb) TO ${who}`);
  for(const fn of ['origen_coordinator_notification_command(jsonb)','origen_coordinator_export()','origen_coordinator_operations_command(jsonb)','origen_coordinator_record_operation(text)','origen_coordinator_feedback_command(jsonb)','origen_coordinator_binder_command(jsonb)','origen_binder_help_command(jsonb)'])if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.${fn}`])).rows[0].fn)await client.query(`GRANT EXECUTE ON FUNCTION ${base}.${fn} TO ${who}`);
  if((await client.query('SELECT to_regprocedure($1) AS fn',[`${base}.origen_coordinator_feedback_v6(jsonb)`])).rows[0].fn)await client.query(`REVOKE ALL ON FUNCTION ${base}.origen_coordinator_feedback_v6(jsonb) FROM ${who},PUBLIC`);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

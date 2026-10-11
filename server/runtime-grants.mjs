import {sqlIdentifier} from './account-isolation.mjs';

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
   const permissions=tablename==='origen_privacy_events'?'SELECT,INSERT,DELETE':tablename==='origen_privileged_access_audit'?'INSERT':['origen_schema_migrations','origen_student_links','origen_staff_access_controls','origen_deletion_journal','origen_identity_closures'].includes(tablename)?'SELECT':tablename==='origen_closed_accounts'?'SELECT,INSERT':tablename==='origen_subject_locks'?'SELECT,INSERT,UPDATE':'SELECT,INSERT,UPDATE,DELETE';
   await client.query(`GRANT ${permissions} ON TABLE ${table} TO ${who}`);
  }
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${reporting} FROM ${who},PUBLIC`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${reporting} TO ${who}`);
  await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${base} TO ${who}`);
  for(const signature of ['origen_current_account_id()','origen_shared_profile(text)','origen_update_shared_profile(text,jsonb,boolean)','origen_family_link_command(text,text,text)'])await client.query(`GRANT EXECUTE ON FUNCTION ${base}.${signature} TO ${who}`);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

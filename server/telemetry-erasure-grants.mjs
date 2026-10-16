import {sqlIdentifier} from './account-isolation.mjs';
export async function grantErasureWorker(pool,role,{schema='public',healthOnly=false}={}){
 const who=sqlIdentifier(role),base=sqlIdentifier(schema),client=await pool.connect();
 try{await client.query('BEGIN');const r=(await client.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2 AND pg_has_role(r.oid,c.relowner,'MEMBER')) AS unsafe FROM pg_roles r WHERE r.rolname=$1 AND r.rolcanlogin`,[role,schema])).rows[0];if(!r||r.unsafe)throw new Error('restricted_erasure_role_required');
  await client.query(`REVOKE ALL ON SCHEMA ${base} FROM ${who};GRANT USAGE ON SCHEMA ${base} TO ${who};REVOKE ALL ON ALL TABLES IN SCHEMA ${base} FROM ${who};REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${base} FROM ${who}`);
  for(const fn of healthOnly?['origen_telemetry_outbox_health()']:['origen_telemetry_outbox_batch()','origen_telemetry_outbox_ack(uuid[])','origen_telemetry_outbox_expire()','origen_telemetry_outbox_health()'])await client.query(`GRANT EXECUTE ON FUNCTION ${base}.${fn} TO ${who}`);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export async function assertErasureWorker(pool,{healthOnly=false}={}){
 const r=(await pool.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) OR has_schema_privilege(current_user,'public','CREATE') OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];if(!r||r.unsafe)throw new Error('restricted_erasure_role_required');
 for(const fn of ['origen_telemetry_outbox_batch()','origen_telemetry_outbox_ack(uuid[])','origen_telemetry_outbox_expire()','origen_telemetry_outbox_health()'])if((await pool.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') AS ok",[fn])).rows[0]?.ok!==(!healthOnly||fn==='origen_telemetry_outbox_health()'))throw new Error('restricted_erasure_role_required');
}

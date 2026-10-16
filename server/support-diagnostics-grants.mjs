import {sqlIdentifier} from './account-isolation.mjs';
export async function grantSupportResolver(pool,role){
 const who=sqlIdentifier(role);
 const row=(await pool.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) OR EXISTS(SELECT 1 FROM pg_class c WHERE pg_has_role(r.oid,c.relowner,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','public_reporting') AND pg_has_role(r.oid,p.proowner,'MEMBER')) AS unsafe FROM pg_roles r WHERE r.rolname=$1 AND r.rolcanlogin`,[role])).rows[0];
 if(!row||row.unsafe)throw new Error('restricted_support_role_required');
 await pool.query(`REVOKE ALL ON SCHEMA public FROM ${who};GRANT USAGE ON SCHEMA public TO ${who};REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${who};REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${who};GRANT EXECUTE ON FUNCTION origen_support_scope(uuid,text,bigint,boolean) TO ${who};ALTER ROLE ${who} SET statement_timeout='2s'`);
}
export async function assertSupportResolver(pool){
 const row=(await pool.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) OR has_schema_privilege(current_user,'public','CREATE') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','public_reporting') AND pg_has_role(r.oid,p.proowner,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','public_reporting') AND c.relkind IN('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR pg_has_role(r.oid,c.relowner,'MEMBER'))) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
 const functions=(await pool.query("SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege(current_user,p.oid,'EXECUTE')")).rows;
 if(!row||row.unsafe||functions.length!==1||functions[0].signature!=='origen_support_scope(uuid,text,bigint,boolean)')throw new Error('restricted_support_role_required');
}

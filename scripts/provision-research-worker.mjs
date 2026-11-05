import pg from 'pg';
// Provision the LOGIN/password separately. This script never accepts or prints it.
if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL required');
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1});
const c=await pool.connect();
try{
 await c.query('BEGIN');
 const role=(await c.query("SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='origen_research_worker'")).rows[0];
 if(!role?.rolcanlogin||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolcreatedb)throw Error('restricted_worker_login_required');
 const inherited=(await c.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='origen_research_worker')")).rows;
 const owned=(await c.query("SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='origen_research_worker')")).rows;
 if(inherited.length||owned.length)throw Error('worker_must_not_inherit_roles_or_own_tables');
 await c.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM origen_research_worker');
 await c.query('REVOKE CREATE ON SCHEMA public FROM origen_research_worker');
 await c.query('GRANT USAGE ON SCHEMA public TO origen_research_worker');
 await c.query('GRANT EXECUTE ON FUNCTION origen_current_account_id() TO origen_research_worker');
 await c.query('GRANT SELECT,UPDATE,DELETE ON origen_voice_research_jobs TO origen_research_worker');
 await c.query('COMMIT');console.log('Research queue grants installed. No student-table access was granted.');
}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}

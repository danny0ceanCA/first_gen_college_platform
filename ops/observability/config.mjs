import pg from 'pg';
export function assertServiceIsolation(env){if(['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','AUTH0_MANAGEMENT_TOKEN','RESEND_API_KEY'].some(key=>env[key]))throw new Error('telemetry_configuration_invalid');}
export function telemetryPool(env,key,Pool=pg.Pool){
 if(!env[key])throw new Error('telemetry_configuration_invalid');const url=new URL(env[key]);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.pathname||url.pathname==='/')throw new Error('telemetry_configuration_invalid');
 const synthetic=env.NODE_ENV==='test'&&env.TELEMETRY_SYNTHETIC_TEST==='true'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 for(const option of ['ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(option);
 const pool=new Pool({connectionString:url.href,...(!synthetic?{ssl:{rejectUnauthorized:true,...(env.TELEMETRY_SSL_CA?{ca:env.TELEMETRY_SSL_CA}:{})}}:{}),max:2,connectionTimeoutMillis:2000,statement_timeout:2000,idleTimeoutMillis:30000});pool.on('error',()=>{});return pool;
}
export function separateDatabases(env,keys){
 const identities=keys.map(key=>{const url=new URL(env[key]);return `${url.hostname}:${url.port||'5432'}${decodeURIComponent(url.pathname)}`;});
 if(new Set(identities).size!==identities.length)throw new Error('separate_telemetry_databases_required');
}
export async function assertTelemetryRole(pool,purpose){
 const row=(await pool.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication AS powerful,
 EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS member,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND pg_has_role(r.oid,c.relowner,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_has_role(r.oid,p.proowner,'MEMBER')) AS owner,
 has_schema_privilege(current_user,'public','CREATE') AS creates FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
 if(!row||row.powerful||row.member||row.owner||row.creates)throw new Error('restricted_telemetry_role_required');
 const expected={ingest:['telemetry_ingest(jsonb)'],retention:['telemetry_maintain()'],erasure:['telemetry_erase(jsonb,bigint)','telemetry_ready(bigint)','telemetry_block()'],query:[],health:[],monitor:['telemetry_monitor_snapshot()'],ledgerWriter:['ledger_append(jsonb)','ledger_page(bigint,bigint)','ledger_generation()'],ledgerReader:['ledger_generation()'],support:['ledger_generation()','support_environment()','support_audit(uuid,text,text,text)','support_register(uuid,uuid,text,text,text,uuid[],timestamptz)','support_authorized(uuid,text,text)','support_revoke(uuid,text)'],ledgerRetention:['ledger_expire()','ledger_generation()']}[purpose];
 if(!expected)throw new Error('invalid_telemetry_role');
 for(const fn of expected)if(!(await pool.query('SELECT has_function_privilege(current_user,$1,\'EXECUTE\') AS ok',[fn])).rows[0]?.ok)throw new Error('restricted_telemetry_role_required');
 const functions=(await pool.query("SELECT p.oid=ANY($1::regprocedure[]) AS permitted,has_function_privilege(current_user,p.oid,'EXECUTE') AS executes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'",[expected])).rows;
 if(functions.some(fn=>fn.executes&&!fn.permitted))throw new Error('restricted_telemetry_role_required');
 const tables=(await pool.query("SELECT c.oid,c.relname,has_table_privilege(current_user,c.oid,'SELECT') OR has_any_column_privilege(current_user,c.oid,'SELECT') AS reads,has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES') AS writes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v')")).rows;
 const readable=purpose==='query'?['telemetry_events_live','telemetry_metrics_live','telemetry_health']:['ingest','erasure','retention','health','monitor'].includes(purpose)?['telemetry_health']:[];
 if(tables.some(t=>t.writes||t.reads!==readable.includes(t.relname)))throw new Error('restricted_telemetry_role_required');
}

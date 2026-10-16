import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import pg from 'pg';

const context=new AsyncLocalStorage();
const fail=()=>Object.assign(new Error('account_scope_mismatch'),{status:403});
const validSubject=value=>typeof value==='string'&&value.trim().length>0&&value.length<=255&&!value.includes('\0');
export const sqlIdentifier=value=>{if(!/^[a-z_][a-z0-9_]{0,52}$/.test(value))throw new Error('invalid_database_identifier');return `"${value}"`;};

// Only verified JWT identity enters here. Request bodies/tool arguments cannot
// choose a subject, database role, reporting path, or retention-job purpose.
export function runAsAccount(identity,work){
 if(!validSubject(identity?.sub))throw fail();
 return context.run(Object.freeze({subject:identity.sub,purpose:'account'}),work);
}
// Public guardian capabilities scope only the matching hashed token's rows.
export function runAsGuardian(hash,work){
 if(context.getStore()||!/^[a-f0-9]{64}$/.test(hash))throw fail();
 return context.run({subject:'',purpose:'guardian',guardianHash:hash},work);
}
// Call only after the server's administrator gate, never from request input.
export function runAsAnalytics(work){
 const current=context.getStore();
 if(!current?.subject)throw fail();
 return context.run({...current,purpose:'analytics'},work);
}
export function runRetentionJob(work){
 if(context.getStore())throw new Error('retention_not_available_in_request');
 return context.run({subject:'',purpose:'retention'},work);
}
export function runOperatorReport(work){
 if(context.getStore())throw new Error('operator_report_not_available_in_request');
 return context.run({subject:'',purpose:'analytics'},work);
}

// One connection/transaction owns its context. SET LOCAL is reset by both
// COMMIT and ROLLBACK; pooled sessions never retain the previous user's scope.
export function isolateDatabase(pool,{schema='public'}={}){
 const base=sqlIdentifier(schema),reporting=sqlIdentifier(`${schema}_reporting`);
 async function connect(){
  const raw=await pool.connect();
  let scope={subject:'',purpose:'none',...context.getStore()},active=false,released=false;
  // SET is a utility statement: unlike SELECT set_config(), it does not acquire
  // a REPEATABLE READ snapshot before a repository takes its serialization lock.
  // node-postgres escapes literals (including quotes/backslashes); none is SQL.
  const configure=()=>raw.query(Object.entries({
   'origen.subject':scope.subject,'origen.subject_hash':scope.subject?createHash('sha256').update(scope.subject).digest('hex'):'',
   'origen.purpose':scope.purpose,'origen.guardian_hash':scope.guardianHash||'',
  }).map(([key,value])=>`SET LOCAL ${key}=${pg.escapeLiteral(value)}`).concat(`SET LOCAL search_path TO ${scope.purpose==='analytics'?`${reporting},${base}`:base}`).join(';'));
  const client={
   isolated:true,
   async setAccountScope(subject){
    if(!active||!validSubject(subject)||scope.subject&&scope.subject!==subject||scope.purpose==='retention')throw fail();
    if(!scope.subject){scope={subject,purpose:'account'};await configure();}
   },
   async query(sql,values){
    if(released)throw new Error('released_database_client');
    const statement=typeof sql==='string'?sql:sql.text;
    if(/^\s*BEGIN(?:\s|;|$)/i.test(statement)){
     if(active)throw new Error('nested_account_transaction');
     const result=await raw.query(sql,values);active=true;
     await configure();return result;
    }
    if(/^\s*(?:COMMIT|ROLLBACK)\s*;?\s*$/i.test(statement)){
     const result=await raw.query(sql,values);active=false;return result;
    }
    if(active)return raw.query(sql,values);
    await client.query('BEGIN');
    try{const result=await raw.query(sql,values);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
   },
   release(){if(released)return;released=true;raw.release(active?new Error('unfinished_account_transaction'):undefined);},
  };
  return client;
 }
 return {isolated:true,connect,async query(...args){const client=await connect();try{return await client.query(...args);}finally{client.release();}},end:()=>pool.end()};
}

// Refuse a credential that defeats RLS or can modify policies/functions. The
// migration owner is intentionally separate and is never used by HTTP requests.
export async function assertRuntimeIsolation(pool,{schema='public'}={}){
 const {rows}=await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb) AND pg_has_role(current_user,p.oid,'MEMBER')) AS powerful,
  has_schema_privilege(current_user,$1,'CREATE') AS can_create,
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ($1,$1||'_reporting') AND c.relname LIKE 'origen_%' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_tables,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname LIKE 'origen_%' AND pg_has_role(current_user,p.proowner,'MEMBER')) AS owns_functions,
  (SELECT count(*)=15 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname IN ('origen_accounts','origen_conversation_summaries','origen_student_links','origen_family_invites','origen_closed_accounts','origen_subject_locks','origen_privileged_access_audit','origen_staff_access_controls','origen_privacy_preferences','origen_deletion_journal','origen_identity_closures','origen_privacy_events','origen_eligibility','origen_permission_events','origen_permission_calls') AND c.relrowsecurity) AS protected,
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='account_id' WHERE n.nspname=$1 AND c.relkind='r' AND NOT c.relrowsecurity) AS unprotected,
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND c.relname LIKE 'origen_%' AND has_table_privilege(current_user,c.oid,'TRUNCATE')) AS can_truncate,
  has_table_privilege(current_user,format('%I.origen_schema_migrations',$1),'INSERT,UPDATE,DELETE') AS can_migrate,
  has_table_privilege(current_user,format('%I.origen_privileged_access_audit',$1),'SELECT,UPDATE,DELETE') OR
  has_table_privilege(current_user,format('%I.origen_staff_access_controls',$1),'INSERT,UPDATE,DELETE') OR has_table_privilege(current_user,format('%I.origen_deletion_journal',$1),'INSERT,UPDATE,DELETE') OR has_table_privilege(current_user,format('%I.origen_identity_closures',$1),'INSERT,UPDATE,DELETE') OR has_table_privilege(current_user,format('%I.origen_privacy_events',$1),'UPDATE') OR EXISTS(SELECT 1 FROM pg_class dc JOIN pg_namespace dn ON dn.oid=dc.relnamespace WHERE dn.nspname=$1 AND dc.relname='origen_diagnostic_operations' AND has_table_privilege(current_user,dc.oid,'UPDATE')) OR EXISTS(SELECT 1 FROM pg_class ec JOIN pg_namespace en ON en.oid=ec.relnamespace WHERE en.nspname=$1 AND ec.relname='origen_telemetry_erasure_outbox' AND has_table_privilege(current_user,ec.oid,'SELECT,INSERT,UPDATE,DELETE')) AS can_alter_controls`,[schema]);
 const row=rows[0];
 if(!row||row.powerful||row.can_create||row.owns_tables||row.owns_functions||row.can_truncate||row.can_migrate||row.can_alter_controls||row.unprotected||!row.protected)throw new Error('restricted_database_runtime_required');
}

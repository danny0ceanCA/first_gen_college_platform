import {randomUUID,randomBytes} from 'node:crypto';
import {guardAccountTransaction} from '../account-guard.mjs';
import {assertPermission} from '../permission-context.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const kinds=new Set(['voice','summary','history','notes','onboarding']);
export const diagnosticOperationsEnabled=env=>env.OBSERVABILITY_OPERATION_LINKS==='true';
const unavailable=reason=>({reason});
async function acquire(database,onLateSettled){
 let timer,expired=false;
 const connecting=database.connect();
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Object.assign(new Error('diagnostic_timeout'),{pendingAcquisition:true}));},250);});
 void connecting.then(client=>{if(expired){client.release();onLateSettled();}},()=>{if(expired)onLateSettled();});
 try{return await Promise.race([connecting,timeout]);}finally{clearTimeout(timer);}
}
export function createDiagnosticOperations(database,{clock=Date.now}={}){
 let active=0;
 return async(subject,{studentId,kind,hint,requestId})=>{
  if(!database||!uuid(hint)||!kinds.has(kind)||studentId!==null&&(typeof studentId!=='string'||!studentId||studentId.length>128))return unavailable('mapping_scope_unavailable');
  if(active>=2)return unavailable('mapping_capacity');
  active++;let client,committed=false,pendingAcquisition=false;
  try{
   client=await acquire(database,()=>{active--;});await client.query('BEGIN');
   await client.query("SET LOCAL statement_timeout = '250ms'");
   await guardAccountTransaction(client,subject);
   const account=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
   if(!account)return unavailable('mapping_scope_unavailable');
   const owner=account.id;
   const remember=async operationId=>{
    if(!uuid(requestId))return;
    if(Number((await client.query('SELECT count(*) AS count FROM origen_diagnostic_request_refs WHERE account_id=$1',[owner])).rows[0].count)>=1000)throw new Error('diagnostic_reference_capacity');
    await client.query('INSERT INTO origen_diagnostic_request_refs(request_id,account_id,operation_id,expires_at) SELECT $1,account_id,operation_id,expires_at FROM origen_diagnostic_operations WHERE operation_id=$2 ON CONFLICT DO NOTHING',[requestId,operationId]);
   };
   if(studentId!==null&&!(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,studentId])).rows.length)return unavailable('mapping_scope_unavailable');
   const existing=(await client.query(`SELECT operation_id,trace_id,created_at FROM origen_diagnostic_operations WHERE account_id=$1 AND kind=$2 AND client_operation_id=$3 AND ${studentId===null?'student_id IS NULL':'student_id=$4'}`,[owner,kind,hint,...(studentId===null?[]:[studentId])])).rows[0];
   if(existing){
    if(clock()-new Date(existing.created_at).getTime()>=86400000)return unavailable('mapping_expired');
    await remember(existing.operation_id);await assertPermission(client);await client.query('COMMIT');committed=true;return {operationId:existing.operation_id,traceId:existing.trace_id};
   }
   const rows=(await client.query('SELECT created_at,expires_at FROM origen_diagnostic_operations WHERE account_id=$1 LIMIT 1001',[owner])).rows;
   if(rows.filter(r=>new Date(r.expires_at).getTime()>clock()).length>=1000||rows.filter(r=>new Date(r.created_at).getTime()>clock()-3600000).length>=100)return unavailable('mapping_capacity');
   const operationId=randomUUID(),traceId=randomBytes(16).toString('hex');
   await client.query('INSERT INTO origen_diagnostic_operations(operation_id,account_id,student_id,kind,client_operation_id,trace_id) VALUES($1,$2,$3,$4,$5,$6)',[operationId,owner,studentId,kind,hint.toLowerCase(),traceId]);
   await remember(operationId);await assertPermission(client);await client.query('COMMIT');committed=true;return {operationId,traceId};
  }catch(error){pendingAcquisition=error?.pendingAcquisition===true;return unavailable('mapping_unavailable');}
  finally{if(client){if(!committed)await client.query('ROLLBACK').catch(()=>{});client.release();}if(!pendingAcquisition)active--;}
 };
}
export async function purgeDiagnosticOperations(database){
 if(!database)return;
 try{await database.query('DELETE FROM origen_diagnostic_operations WHERE expires_at<=now()');}catch(error){if(error.code!=='42P01')throw error;}
}
export async function assertDiagnosticOperationsReady(database){
 if(!database)throw new Error('diagnostic_migration_required');
 const row=(await database.query(`SELECT c.relrowsecurity AS protected,
 has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND has_table_privilege(current_user,c.oid,'DELETE') AS usable,
 has_table_privilege(current_user,c.oid,'UPDATE') AS mutable
 FROM pg_class c WHERE c.oid=to_regclass('origen_diagnostic_operations')`)).rows[0];
 if(!row?.protected||!row.usable||row.mutable)throw new Error('diagnostic_migration_required');
}
export async function assertTelemetryLifecycle(database){
 const row=(await database.query(`SELECT EXISTS(SELECT 1 FROM origen_schema_migrations WHERE name='042_telemetry_erasure_outbox.sql') AS migrated,
 (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN('diagnostic_erasure_before_delete','diagnostic_request_erasure_before_delete') AND tgenabled='O') AS captures,
 has_table_privilege(current_user,'origen_telemetry_erasure_outbox','SELECT,INSERT,UPDATE,DELETE') OR has_function_privilege(current_user,'origen_telemetry_outbox_batch()','EXECUTE') AS broad`)).rows[0];
 if(!row?.migrated||!row.captures||row.broad)throw new Error('telemetry_lifecycle_required');
}

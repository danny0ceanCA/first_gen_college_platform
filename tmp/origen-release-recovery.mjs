// Operator-only recovery. Credentials stay in process memory; output is metadata only.
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {migrateDatabase,databaseReady} from '../server/database.mjs';
import {assertRuntimeIsolation,isolateDatabase} from '../server/account-isolation.mjs';
import {grantRuntimeAccess} from '../server/runtime-grants.mjs';

const serviceId='srv-db02or0u01pc738ktekg',databaseId='dpg-db0806hsrm7s73efcupg-a';
const mode=process.argv[2]||'preflight';
if(!['preflight','apply','verify'].includes(mode))throw new Error('invalid_mode');
let stage='api_access',ownerPool,runtimePool;
const emit=value=>console.log(JSON.stringify(value));
try{
 if(!process.env.RENDER_API_KEY)throw new Error('render_key_unavailable');
 async function api(path,optional=false){
  const response=await fetch(`https://api.render.com/v1/${path}`,{headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(optional&&response.status===404)return null;
  if(!response.ok)throw new Error(`render_http_${response.status}`);
  return response.json();
 }
 const service=await api(`services/${serviceId}`);
 if(service.ownerId!=='tea-ctn17nbv2p9s73ffqo5g'||service.repo!=='https://github.com/danny0ceanCA/first_gen_college_platform')throw new Error('service_target_mismatch');
 const info=await api(`postgres/${databaseId}/connection-info`);
 const runtimeSetting=await api(`services/${serviceId}/env-vars/DATABASE_URL`);
 const caSetting=await api(`services/${serviceId}/env-vars/DATABASE_SSL_CA`,true);
 const ownerURL=new URL(info.externalConnectionString),runtimeURL=new URL(runtimeSetting.value);
 if(ownerURL.pathname!=='/origen_edu_database'||runtimeURL.pathname!==ownerURL.pathname||!ownerURL.hostname.startsWith(databaseId)||!runtimeURL.hostname.startsWith(databaseId))throw new Error('database_target_mismatch');
 if(decodeURIComponent(runtimeURL.username)!=='origen_api'||ownerURL.username===runtimeURL.username)throw new Error('runtime_role_mismatch');
 runtimeURL.hostname=ownerURL.hostname;
 runtimeURL.port=ownerURL.port;
 for(const url of [ownerURL,runtimeURL])for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
 const settings={max:1,connectionTimeoutMillis:10000,statement_timeout:30000,ssl:{rejectUnauthorized:true,...(caSetting?.value?{ca:caSetting.value}:{})}};
 ownerPool=new pg.Pool({...settings,connectionString:ownerURL.href});
 runtimePool=new pg.Pool({...settings,connectionString:runtimeURL.href});
 ownerPool.on('error',()=>emit({event:'owner_connection_error'}));runtimePool.on('error',()=>emit({event:'runtime_connection_error'}));
 stage='database_preflight';
 const identity=(await ownerPool.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 if(identity.database!=='origen_edu_database'||identity.role!=='origen_edu_database_user')throw new Error('migration_identity_mismatch');
 const runtimeIdentity=(await runtimePool.query('SELECT current_user AS role')).rows[0];
 if(runtimeIdentity.role!=='origen_api')throw new Error('runtime_identity_mismatch');
 const directory=new URL('../server/migrations/',import.meta.url);
 const files=(await readdir(directory)).filter(name=>/^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
 const applied=(await ownerPool.query('SELECT name,checksum FROM public.origen_schema_migrations ORDER BY name')).rows;
 const byName=new Map(applied.map(row=>[row.name,row.checksum]));
 const pending=[];
 for(const name of files){
  const sql=(await readFile(new URL(name,directory),'utf8')).replaceAll('\r\n','\n');
  const hash=createHash('sha256').update(sql).digest('hex');
  if(byName.has(name)&&byName.get(name)!==hash)throw new Error('applied_migration_checksum_mismatch');
  if(!byName.has(name))pending.push(name);
 }
 if(pending.some(name=>name!=='039_guardian_permission.sql'))throw new Error('unexpected_pending_migration');
 const tables=(await ownerPool.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('origen_eligibility','origen_permission_events','origen_permission_calls') ORDER BY c.relname")).rows;
 emit({stage,mode,database:identity.database,migrationRole:identity.role,runtimeRole:runtimeIdentity.role,appliedCount:applied.length,pending,guardianTables:tables,appliedChecksumsMatch:true});
 if(mode==='preflight'){
  try{await assertRuntimeIsolation(runtimePool);emit({runtimeIsolation:'passed'});}catch(error){if(error.message!=='restricted_database_runtime_required')throw error;emit({runtimeIsolation:'restricted_database_runtime_required'});}
 }else{
  if(mode==='apply'){
   stage='migration';await migrateDatabase(ownerPool);emit({stage,status:'completed'});
   stage='runtime_grants';await grantRuntimeAccess(ownerPool,'origen_api');emit({stage,status:'completed'});
  }
  stage='runtime_verification';await assertRuntimeIsolation(runtimePool);
  if(!await databaseReady(isolateDatabase(runtimePool)))throw new Error('database_not_ready');
  emit({stage,status:'passed',migration039:true,runtimeIsRestricted:true});
 }
}catch(error){
 const known=/^(?:render_http_\d+|render_key_unavailable|service_target_mismatch|database_target_mismatch|runtime_role_mismatch|migration_identity_mismatch|runtime_identity_mismatch|applied_migration_checksum_mismatch|unexpected_pending_migration|restricted_database_runtime_required|database_not_ready)$/;
 emit({stage,status:'failed',reason:known.test(error.message)?error.message:'operation_failed',code:typeof error.code==='string'?error.code:undefined});
 process.exitCode=1;
}finally{await Promise.allSettled([ownerPool?.end(),runtimePool?.end()]);}

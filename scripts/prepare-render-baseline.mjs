// Operator-only, pinned Origen target. Credentials stay in memory; no deploy or user-content queries.
import {randomBytes,createHash} from 'node:crypto';
import {createDatabase,migrateDatabase} from '../server/database.mjs';
import {grantRuntimeAccess} from '../server/runtime-grants.mjs';
import {assertRuntimeIsolation} from '../server/account-isolation.mjs';
import {grantMaintenanceAccess,assertMaintenanceAccess} from '../server/maintenance-database.mjs';
import {assertProductionConfig} from '../server/production-config.mjs';
const target=Object.freeze({workspace:'tea-ctn17nbv2p9s73ffqo5g',service:'srv-db02or0u01pc738ktekg',database:'dpg-db0806hsrm7s73efcupg-a',name:'origen_edu_database',repo:'https://github.com/danny0ceanCA/first_gen_college_platform'});
const flags=Object.freeze({OBSERVABILITY_OPERATION_LINKS:'false',OBSERVABILITY_EXPORT:'false',OBSERVABILITY_DETAILED_SPANS:'false',SUPPORT_DIAGNOSTICS_ENABLED:'false',DIAGNOSTIC_AGENT_ENABLED:'false',DIAGNOSTIC_RUNNER_ENABLED:'false'});
const safe=code=>{throw Object.assign(new Error(code),{safeCode:code});};
let stage='configuration';const pools=[];
async function api(path,{method='GET',body}={}){
 const response=await fetch(`https://api.render.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)safe(`render_http_${response.status}`);const raw=await response.text();if(Buffer.byteLength(raw)>2*1024*1024)safe('render_response_limit');return raw?JSON.parse(raw):null;
}
async function environment(){const result=new Map();let cursor;for(let page=0;page<10;page++){
 const rows=await api(`services/${target.service}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);if(!Array.isArray(rows))safe('invalid_environment_response');
 for(const {envVar} of rows){if(typeof envVar?.key!=='string'||typeof envVar.value!=='string'||result.has(envVar.key))safe('invalid_environment_response');result.set(envVar.key,envVar.value);}
 if(rows.length<100)return result;cursor=rows.at(-1)?.cursor;if(typeof cursor!=='string'||cursor.length>2048)safe('invalid_environment_cursor');
 }safe('environment_page_limit');}
function url(value){let u;try{u=new URL(value);}catch{safe('invalid_database_target');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||decodeURIComponent(u.pathname)!=='/'+target.name||!u.hostname.startsWith(target.database)||!u.username||!u.password)safe('invalid_database_target');return u;}
// Only verified public-host TLS is used from this operator process. Never borrow render-internal mode locally.
function externalPool(value){const p=createDatabase({DATABASE_URL:value,NODE_ENV:'production'},undefined,{max:1});pools.push(p);return p;}
const fingerprint=rows=>createHash('sha256').update(JSON.stringify([...rows].sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
try{
 if(!process.env.RENDER_API_KEY||!['inspect','apply','verify'].includes(process.argv[2]))safe('operator_configuration_required');
 const mode=process.argv[2];stage='target_verification';
 const [service,db,connection,recovery]=await Promise.all([api(`services/${target.service}`),api(`postgres/${target.database}`),api(`postgres/${target.database}/connection-info`),api(`postgres/${target.database}/recovery`)]);
 if(service.id!==target.service||service.ownerId!==target.workspace||service.repo!==target.repo||db.id!==target.database||db.owner?.id!==target.workspace||db.databaseName!==target.name||db.status!=='available')safe('target_mismatch');
 const env=await environment(),admin=url(connection.externalConnectionString),runtime=url(env.get('DATABASE_URL'));
 if(decodeURIComponent(runtime.username)===decodeURIComponent(admin.username))safe('application_uses_owner_login');
 const owner=externalPool(admin.href),runtimeUrl=new URL(admin.href);runtimeUrl.username=runtime.username;runtimeUrl.password=runtime.password;
 stage='schema_inspection';const applied=(await owner.query('SELECT name FROM origen_schema_migrations ORDER BY name')).rows.map(r=>r.name);
 const operatorIdentity=(await owner.query('SELECT current_database() AS db,current_user AS role')).rows[0];if(operatorIdentity.db!==target.name||operatorIdentity.role!==decodeURIComponent(admin.username))safe('database_identity_mismatch');
 let maintenance=env.get('MAINTENANCE_DATABASE_URL')?url(env.get('MAINTENANCE_DATABASE_URL')):null;
 if(maintenance&&(maintenance.hostname!==runtime.hostname||maintenance.port!==runtime.port||maintenance.pathname!==runtime.pathname))safe('maintenance_target_mismatch');
 const role=maintenance?decodeURIComponent(maintenance.username):'origen_maintenance';if(!/^[a-z_][a-z0-9_]{0,52}$/.test(role)||role===decodeURIComponent(runtime.username)||role===decodeURIComponent(admin.username))safe('invalid_maintenance_role');
 const roleExists=(await owner.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS exists',[role])).rows[0].exists;
 if(mode==='inspect'){process.stdout.write(JSON.stringify({stage:'inspected',service:service.id,autoDeploy:service.autoDeploy,branch:service.branch,database:db.id,recoveryStatus:recovery.recoveryStatus,latestMigration:applied.at(-1),maintenanceConfigured:Boolean(maintenance),maintenanceRoleExists:roleExists,migrationSecretInApi:Boolean(env.get('MIGRATION_DATABASE_URL'))})+'\n');}
 else{
  if(mode==='apply'){
   if(recovery.recoveryStatus!=='AVAILABLE')safe('verified_recovery_required');
   if(roleExists&&!maintenance)safe('unmanaged_maintenance_role');
   stage='migrations';await owner.query("SET lock_timeout='5s'");await migrateDatabase(owner);
   stage='runtime_grants';await grantRuntimeAccess(owner,decodeURIComponent(runtime.username));
   if(!roleExists){stage='maintenance_login';const password=randomBytes(32).toString('hex');await owner.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);maintenance=new URL(runtime.href);maintenance.username=role;maintenance.password=password;}
   stage='maintenance_grants';await grantMaintenanceAccess(owner,role);
  }else if(!maintenance)safe('maintenance_not_configured');
  stage='permission_verification';const runtimePool=externalPool(runtimeUrl.href),maintenanceUrl=new URL(admin.href);maintenanceUrl.username=maintenance.username;maintenanceUrl.password=maintenance.password;const cleanupPool=externalPool(maintenanceUrl.href);
  await assertRuntimeIsolation(runtimePool);await assertMaintenanceAccess(cleanupPool);
  const candidate=Object.fromEntries(env);Object.assign(candidate,flags,{MAINTENANCE_DATABASE_URL:maintenance.href,NODE_ENV:'production',RENDER:'true'});assertProductionConfig(candidate);
  if(mode==='apply'){
   stage='save_only_environment';const current=await environment();if(fingerprint(current)!==fingerprint(env))safe('environment_changed_retry');
   const next=new Map(current);for(const [k,v] of Object.entries(flags))next.set(k,v);next.set('MAINTENANCE_DATABASE_URL',maintenance.href);
   await api(`services/${target.service}/env-vars`,{method:'PUT',body:[...next].map(([key,value])=>({key,value}))});
  }
  stage='final_verification';const saved=await environment();
  if(!saved.get('MAINTENANCE_DATABASE_URL')||Object.entries(flags).some(([k,v])=>saved.get(k)!==v)||saved.get('MIGRATION_DATABASE_URL'))safe('saved_environment_mismatch');
  const after=(await owner.query('SELECT name FROM origen_schema_migrations ORDER BY name')).rows.map(r=>r.name);
  process.stdout.write(JSON.stringify({stage:'verified',service:target.service,database:target.database,latestMigration:after.at(-1),runtimeIsolation:true,maintenanceIsolation:true,productionConfiguration:true,disabledFlags:Object.keys(flags),environmentSaved:true,deploymentTriggered:false,credentialFilesWritten:false})+'\n');
 }
}catch(error){process.stderr.write(JSON.stringify({stage,status:'setup_incomplete',code:error.safeCode??(/^[A-Z0-9]{5}$/.test(error.code??'')?`postgres_${error.code}`:'verification_failed'),credentialsPrinted:false})+'\n');process.exitCode=1;}
finally{await Promise.all(pools.map(p=>p.end()));}

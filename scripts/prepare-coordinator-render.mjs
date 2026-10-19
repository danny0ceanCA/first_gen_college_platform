// Operator-only preparation for the existing Origen deployment. No secrets or
// user content are printed or written. Environment edits are saved without deploy.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createDatabase,migrateDatabase} from '../server/database.mjs';
import {grantRuntimeAccess} from '../server/runtime-grants.mjs';
import {grantMaintenanceAccess} from '../server/maintenance-database.mjs';
import {assertProductionConfig} from '../server/production-config.mjs';
import {coordinatorFlags} from '../server/binder-sharing-policy.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
import {isolateDatabase,runRetentionJob} from '../server/account-isolation.mjs';
import {maintainCoordinators} from '../server/coordinator-notifications.mjs';

const target={workspace:'tea-ctn17nbv2p9s73ffqo5g',service:'srv-db02or0u01pc738ktekg',frontend:'srv-db02o8ou01pc738krjb0',database:'dpg-db0806hsrm7s73efcupg-a',name:'origen_edu_database',repo:'https://github.com/danny0ceanCA/first_gen_college_platform'};
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
let stage='configuration';const pools=[];
async function api(path,{method='GET',body}={}){
 const response=await fetch(`https://api.render.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail(`render_http_${response.status}`);const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)fail('response_limit');return text?JSON.parse(text):null;
}
async function environment(id=target.service){
 const result=new Map();let cursor;
 for(let i=0;i<10;i++){
  const rows=await api(`services/${id}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
  if(!Array.isArray(rows))fail('invalid_environment');
  for(const {envVar} of rows){if(typeof envVar?.key!=='string'||typeof envVar.value!=='string'||result.has(envVar.key))fail('invalid_environment');result.set(envVar.key,envVar.value);}
  if(rows.length<100)return result;cursor=rows.at(-1)?.cursor;if(typeof cursor!=='string'||cursor.length>2048)fail('invalid_cursor');
 }fail('environment_page_limit');
}
const fingerprint=env=>createHash('sha256').update(JSON.stringify([...env].sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
function databaseUrl(value){
 let url;try{url=new URL(value);}catch{fail('invalid_database_target');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.startsWith(target.database)||decodeURIComponent(url.pathname)!=='/'+target.name||!url.username||!url.password)fail('invalid_database_target');return url;
}
function pool(url){const p=createDatabase({DATABASE_URL:url.href,NODE_ENV:'production'},undefined,{max:1});pools.push(p);return p;}
async function legacyModule(revision,name){
 if(!/^[a-f\d]{40}$/.test(revision))fail('invalid_live_revision');
 const cwd=resolve('.');
 let source;try{source=execFileSync('git',['-c',`safe.directory=${cwd.replaceAll('\\','/')}`,'show',`${revision}:server/${name}`],{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']});}catch{fail('live_revision_unavailable_locally');}
 source=source.replace(/from\s+(['"])([^'"]+)\1/g,(match,quote,spec)=>{
  const absolute=spec.startsWith('.')?new URL('../server/'+spec,import.meta.url).href:spec.startsWith('node:')?spec:import.meta.resolve(spec);return `from ${JSON.stringify(absolute)}`;
 });
 return import('data:text/javascript,'+encodeURIComponent(source));
}
try{
 const [mode,output]=process.argv.slice(2);if(!process.env.RENDER_API_KEY||!['inspect','apply','verify'].includes(mode))fail('operator_configuration_required');
 if(output){try{await readFile(output);fail('output_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}}
 stage='target-verification';
 const [service,frontend,db,connection,recovery,deploys]=await Promise.all([api(`services/${target.service}`),api(`services/${target.frontend}`),api(`postgres/${target.database}`),api(`postgres/${target.database}/connection-info`),api(`postgres/${target.database}/recovery`),api(`services/${target.service}/deploys?limit=1`)]);
 if(service.id!==target.service||service.ownerId!==target.workspace||service.repo!==target.repo||service.branch!=='main'||frontend.ownerId!==target.workspace||frontend.repo!==target.repo||frontend.branch!=='main'||db.id!==target.database||db.owner?.id!==target.workspace||db.databaseName!==target.name||db.status!=='available')fail('target_mismatch');
 const live=deploys[0]?.deploy||deploys[0];if(live?.status!=='live')fail('stable_live_deployment_required');
 const env=await environment(),webEnv=await environment(target.frontend),admin=databaseUrl(connection.externalConnectionString),runtime=databaseUrl(env.get('DATABASE_URL')),maintenance=databaseUrl(env.get('MAINTENANCE_DATABASE_URL'));
 const roles=[admin.username,runtime.username,maintenance.username].map(decodeURIComponent);if(new Set(roles).size!==3||env.has('MIGRATION_DATABASE_URL'))fail('separate_existing_roles_required');
 if(runtime.hostname!==maintenance.hostname||runtime.port!==maintenance.port)fail('maintenance_target_mismatch');
 const candidate={...Object.fromEntries(env),NODE_ENV:'production',RENDER:'true',...Object.fromEntries(coordinatorFlags.map(k=>[k,'false']))};assertProductionConfig(candidate);
 const webApi=webEnv.get('VITE_API_URL');if(!['https://origen-edu.onrender.com','https://api.origenedu.ai'].includes(webApi?.replace(/\/$/,''))||webEnv.get('VITE_AUTH0_DOMAIN')!==candidate.AUTH0_DOMAIN||webEnv.get('VITE_AUTH0_AUDIENCE')!==candidate.AUTH0_AUDIENCE||!webEnv.get('VITE_AUTH0_CLIENT_ID'))fail('frontend_configuration_mismatch');
 const owner=pool(admin),runtimeExternal=new URL(admin),maintenanceExternal=new URL(admin);runtimeExternal.username=runtime.username;runtimeExternal.password=runtime.password;maintenanceExternal.username=maintenance.username;maintenanceExternal.password=maintenance.password;
 const app=pool(runtimeExternal),cleanup=pool(maintenanceExternal);
 const identity=(await owner.query('SELECT current_database() AS name,current_user AS role')).rows[0];if(identity.name!==target.name||identity.role!==decodeURIComponent(admin.username))fail('database_identity_mismatch');
 const before=(await owner.query('SELECT name FROM origen_schema_migrations ORDER BY name')).rows.map(r=>r.name);
 // Verify the currently deployed code's role checks as well as the candidate.
 const oldRuntime=await legacyModule(live.commit.id,'account-isolation.mjs'),oldMaintenance=await legacyModule(live.commit.id,'maintenance-database.mjs');
 await oldRuntime.assertRuntimeIsolation(app);await oldMaintenance.assertMaintenanceAccess(cleanup);
 if(mode==='inspect'){
  console.log(JSON.stringify({stage:'inspected',latestMigration:before.at(-1),recoveryStatus:recovery.recoveryStatus,recoveryStartsAt:recovery.startsAt,legacyRolesValid:true,frontendConfiguration:true,coordinatorFlags:Object.fromEntries(coordinatorFlags.map(k=>[k,env.get(k)==='true'?'enabled':'disabled']))}));
 }else{
  if(mode==='apply'){
   if(recovery.recoveryStatus!=='AVAILABLE'||!Number.isFinite(Date.parse(recovery.startsAt)))fail('recovery_required');
   stage='migrations';await owner.query("SET lock_timeout='5s'; SET statement_timeout='120s'");await migrateDatabase(owner);
   stage='runtime-grants';await grantRuntimeAccess(owner,decodeURIComponent(runtime.username));
   stage='maintenance-grants';await grantMaintenanceAccess(owner,decodeURIComponent(maintenance.username));
  }
  stage='database-readiness';const readiness=await checkCoordinatorDatabase(app,cleanup,{env:candidate});if(!readiness.passed){console.log(JSON.stringify({failedChecks:readiness.checks.filter(c=>!c.passed).map(c=>c.id)}));fail('database_readiness_failed');}
  await oldRuntime.assertRuntimeIsolation(app);await oldMaintenance.assertMaintenanceAccess(cleanup);
  stage='maintenance-rehearsal';const lifecycle=await runRetentionJob(()=>maintainCoordinators(isolateDatabase(cleanup)));
  if(mode==='apply'){
   stage='save-disabled-flags';const current=await environment();if(fingerprint(current)!==fingerprint(env))fail('environment_changed_retry');
   const next=new Map(current);for(const flag of coordinatorFlags)next.set(flag,'false');
   await api(`services/${target.service}/env-vars`,{method:'PUT',body:[...next].map(([key,value])=>({key,value}))});
  }
  stage='final-verification';const saved=await environment();if(coordinatorFlags.some(k=>saved.get(k)!=='false'))fail('disabled_flags_not_saved');
  const unrelated=map=>new Map([...map].filter(([k])=>!coordinatorFlags.includes(k)));if(fingerprint(unrelated(saved))!==fingerprint(unrelated(env)))fail('unrelated_environment_changed');
  const finalDeploys=await api(`services/${target.service}/deploys?limit=1`),finalDeploy=finalDeploys[0]?.deploy||finalDeploys[0];if(finalDeploy?.id!==live.id||finalDeploy.status!=='live')fail('deployment_changed');
  const health=await fetch(service.serviceDetails.url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(15000)}),web=await fetch(frontend.serviceDetails.url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!health.ok||!web.ok)fail('live_health_failed');await health.arrayBuffer();await web.arrayBuffer();
  const after=(await owner.query('SELECT name FROM origen_schema_migrations ORDER BY name')).rows.map(r=>r.name);
  const report={schemaVersion:1,kind:'coordinator-production-preparation',checkedAt:new Date().toISOString(),service:target.service,database:target.database,previousMigration:before.at(-1),latestMigration:after.at(-1),migrationsApplied:after.filter(n=>!before.includes(n)),databaseReadiness:readiness,legacyRuntimeCompatible:true,legacyMaintenanceCompatible:true,productionConfiguration:true,frontendConfiguration:true,coordinatorMaintenance:lifecycle,disabledFlags:Object.fromEntries(coordinatorFlags.map(k=>[k,false])),unrelatedEnvironmentPreserved:true,existingCredentialsPreserved:true,migrationCredentialInApi:false,recoveryStatus:recovery.recoveryStatus,recoveryStartsAt:recovery.startsAt,liveDeployment:{id:live.id,commit:live.commit.id,unchanged:true},apiHealth:true,frontendHealth:true,deploymentTriggered:false,credentialFilesWritten:false};
  if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
 }
}catch(error){console.error(JSON.stringify({stage,status:'preparation_incomplete',code:error.safeCode??(/^[A-Z0-9]{5}$/.test(error.code??'')?`postgres_${error.code}`:'verification_failed'),credentialsPrinted:false}));process.exitCode=1;}
finally{await Promise.all(pools.map(p=>p.end()));}

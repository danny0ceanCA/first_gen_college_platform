// Operator-only activation. Credentials stay in memory; output contains no user content.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createDatabase} from '../server/database.mjs';
import {assertRuntimeIsolation} from '../server/account-isolation.mjs';
import {assertProductionConfig} from '../server/production-config.mjs';
import {personalizationControls} from '../server/personalization-controls.mjs';

const target={workspace:'tea-ctn17nbv2p9s73ffqo5g',service:'srv-db02or0u01pc738ktekg',database:'dpg-db0806hsrm7s73efcupg-a',name:'origen_edu_database'};
const changes={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_RETRIEVAL:'true',ORIGEN_PERSONALIZATION_LIVE_WRITES:'true',ORIGEN_PERSONALIZATION_ADAPTIVE:'true',ORIGEN_PERSONALIZATION_EXTRACTION:'true'};
const coordinatorFlags=['ORIGEN_COORDINATOR_ACCOUNTS','ORIGEN_COORDINATOR_LINKING','ORIGEN_COORDINATOR_VOICE_LINKING','ORIGEN_COORDINATOR_FEEDBACK','ORIGEN_COORDINATOR_BINDER_VIEWING','ORIGEN_BINDER_SHARING'];
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const fingerprint=entries=>createHash('sha256').update(JSON.stringify([...entries].sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
async function api(path,method='GET',body){
 const response=await fetch('https://api.render.com/v1/'+path,{method,headers:{Authorization:'Bearer '+process.env.RENDER_API_KEY,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail('render_http_'+response.status);
 const text=await response.text();return text?JSON.parse(text):null;
}
async function environment(){
 const entries=new Map();let cursor;
 for(let i=0;i<10;i++){
  const rows=await api(`services/${target.service}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
  if(!Array.isArray(rows))fail('invalid_environment');
  for(const {envVar} of rows){if(typeof envVar?.key!=='string'||typeof envVar.value!=='string'||entries.has(envVar.key))fail('invalid_environment');entries.set(envVar.key,envVar.value);}
  if(rows.length<100)return entries;cursor=rows.at(-1)?.cursor;if(!cursor)fail('invalid_cursor');
 }fail('environment_limit');
}
let database,stage='inspect';
try{
 const [mode='inspect',output]=process.argv.slice(2);if(!['inspect','apply','verify'].includes(mode))fail('invalid_mode');
 if(!process.env.RENDER_API_KEY)fail('render_credential_required');
 const service=await api('services/'+target.service);
 if(service.ownerId!==target.workspace||service.name!=='Origen Edu'||service.repo!=='https://github.com/danny0ceanCA/first_gen_college_platform'||service.branch!=='main')fail('service_identity_mismatch');
 const env=await environment();
 if(coordinatorFlags.some(flag=>env.get(flag)==='true'))fail('coordinator_settings_changed');
 const candidate={...Object.fromEntries(env),...changes,NODE_ENV:'production',RENDER:'true'};assertProductionConfig(candidate);
 const connection=await api(`postgres/${target.database}/connection-info`);
 const external=new URL(connection.externalConnectionString),runtime=new URL(env.get('DATABASE_URL'));
 if(!external.hostname.startsWith(target.database)||!runtime.hostname.startsWith(target.database)||decodeURIComponent(external.pathname)!=='/'+target.name||decodeURIComponent(runtime.pathname)!=='/'+target.name)fail('database_identity_mismatch');
 external.username=runtime.username;external.password=runtime.password;
 database=createDatabase({DATABASE_URL:external.href,NODE_ENV:'production'},undefined,{max:1});
 stage='database-readiness';await assertRuntimeIsolation(database);
 const migrations=(await database.query("SELECT name FROM origen_schema_migrations WHERE name>='044' AND name<'048' ORDER BY name")).rows.map(row=>row.name);
 if(migrations.length!==4)fail('personalization_migrations_missing');
 const tables=['origen_student_memories','origen_memory_batches','origen_memory_scopes','origen_live_memory_sessions','origen_live_memory_receipts'];
 const readiness=(await database.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,row_security_active(c.oid) AS enforced,
 has_table_privilege(c.oid,'SELECT') AND has_table_privilege(c.oid,'INSERT') AND has_table_privilege(c.oid,'UPDATE') AND has_table_privilege(c.oid,'DELETE') AS permissions
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])`,[tables])).rows;
 // The runtime is a non-owner without BYPASSRLS, verified above. Check actual
 // row-security enforcement for that role, rather than requiring owner-only FORCE.
 if(readiness.length!==tables.length||readiness.some(row=>!row.rls||!row.enforced||!row.permissions)){console.log(JSON.stringify({memoryReadiness:readiness}));fail('memory_table_readiness_failed');}
 const indexes=(await database.query("SELECT count(*)::int AS count FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('origen_history_search','origen_memory_search','origen_note_search') AND i.indisvalid")).rows[0].count;
 if(indexes!==3)fail('history_indexes_missing');
 const latest=async()=>{const rows=await api(`services/${target.service}/deploys?limit=1`);return rows[0]?.deploy;};
 const live=await latest();if(live?.status!=='live')fail('stable_live_deployment_required');
 const health=await fetch(service.serviceDetails.url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!health.ok)fail('api_unhealthy');await health.arrayBuffer();
 const before=Object.fromEntries(Object.keys(changes).map(key=>[key,env.get(key)??null]));
 let deployment;
 if(mode==='apply'){
  stage='save-settings';const current=await environment();if(fingerprint(current)!==fingerprint(env))fail('environment_changed_retry');
  const same=await latest();if(same.id!==live.id||same.status!=='live')fail('deployment_changed_retry');
  const next=new Map(current);for(const [key,value] of Object.entries(changes))next.set(key,value);
  await api(`services/${target.service}/env-vars`,'PUT',[...next].map(([key,value])=>({key,value})));
  const saved=await environment();if(Object.entries(changes).some(([key,value])=>saved.get(key)!==value))fail('settings_not_saved');
  const unrelated=map=>[...map].filter(([key])=>!(key in changes));
  if(fingerprint(unrelated(saved))!==fingerprint(unrelated(env)))fail('unrelated_environment_changed');
  stage='deploy';deployment=await api(`services/${target.service}/deploys`,'POST',{clearCache:'do_not_clear',commitId:live.commit.id});
 }
 if(mode==='verify'&&Object.entries(changes).some(([key,value])=>env.get(key)!==value))fail('activation_settings_mismatch');
 const report={kind:'personalization-activation',mode,checkedAt:new Date().toISOString(),databaseReadiness:{migrations,indexes,protectedTables:readiness,runtimeIsolation:true},previousSettings:before,settings:mode==='inspect'?before:changes,capabilities:personalizationControls(mode==='inspect'?Object.fromEntries(env):candidate,'synthetic-readiness-subject'),coordinatorFeaturesDisabled:true,unrelatedSettingsPreserved:true,apiHealthy:true,liveDeployment:{id:live.id,status:live.status,revision:live.commit.id},previousLiveRevision:live.commit.id,deploymentId:deployment?.id,deploymentStatus:deployment?.status,liveEvaluationPerformed:false,productionUserRecordsChanged:false};
 if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({stage,status:'incomplete',code:error.safeCode||'verification_failed',credentialsPrinted:false}));process.exitCode=1;}
finally{await database?.end();}

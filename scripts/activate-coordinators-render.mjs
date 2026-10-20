// Operator-only activation for the existing deployment. Never prints credentials.
// Save first, then push the release to main; Render's auto-deploy activates it.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createDatabase} from '../server/database.mjs';
import {assertProductionConfig} from '../server/production-config.mjs';
import {coordinatorFlags} from '../server/binder-sharing-policy.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';

const target={workspace:'tea-ctn17nbv2p9s73ffqo5g',service:'srv-db02or0u01pc738ktekg',frontend:'srv-db02o8ou01pc738krjb0',database:'dpg-db0806hsrm7s73efcupg-a',name:'origen_edu_database',repo:'https://github.com/danny0ceanCA/first_gen_college_platform'};
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const fingerprint=map=>createHash('sha256').update(JSON.stringify([...map].sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
const pools=[];let stage='configuration';
async function api(path,method='GET',body){
 const response=await fetch(`https://api.render.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail(`render_http_${response.status}`);return response.json();
}
async function environment(){
 const result=new Map();let cursor;
 for(let i=0;i<10;i++){
  const rows=await api(`services/${target.service}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
  if(!Array.isArray(rows))fail('invalid_environment');
  for(const {envVar} of rows){if(typeof envVar?.key!=='string'||typeof envVar.value!=='string'||result.has(envVar.key))fail('invalid_environment');result.set(envVar.key,envVar.value);}
  if(rows.length<100)return result;cursor=rows.at(-1)?.cursor;if(!cursor)fail('invalid_cursor');
 }fail('environment_page_limit');
}
async function deployment(id){const rows=await api(`services/${id}/deploys?limit=1`);const d=rows[0]?.deploy;if(!d)fail('deployment_missing');return {id:d.id,status:d.status,revision:d.commit?.id};}
function databaseUrl(value){
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.startsWith(target.database)||decodeURIComponent(url.pathname)!=='/'+target.name||!url.username||!url.password)fail('database_mismatch');
 return url;
}
try{
 const [mode,output,revision]=process.argv.slice(2);
 if(!process.env.RENDER_API_KEY||!['save','status','verify'].includes(mode)||mode==='verify'&&!/^[a-f\d]{40}$/.test(revision||''))fail('operator_configuration_required');
 const [service,frontend,env]=await Promise.all([api(`services/${target.service}`),api(`services/${target.frontend}`),environment()]);
 for(const resource of [service,frontend])if(resource.ownerId!==target.workspace||resource.repo!==target.repo||resource.branch!=='main')fail('target_mismatch');
 const before=Object.fromEntries(coordinatorFlags.map(k=>[k,env.get(k)]));
 const candidate={...Object.fromEntries(env),...Object.fromEntries(coordinatorFlags.map(k=>[k,'true'])),NODE_ENV:'production',RENDER:'true'};
 assertProductionConfig(candidate);
 let readiness;
 if(mode!=='status'){
  stage='database-readiness';
  const connection=await api(`postgres/${target.database}/connection-info`),external=databaseUrl(connection.externalConnectionString);
  const makePool=key=>{const internal=databaseUrl(env.get(key)),url=new URL(external);url.username=internal.username;url.password=internal.password;const pool=createDatabase({DATABASE_URL:url.href,NODE_ENV:'production'},undefined,{max:1});pools.push(pool);return pool;};
  readiness=await checkCoordinatorDatabase(makePool('DATABASE_URL'),makePool('MAINTENANCE_DATABASE_URL'),{env:candidate});
  if(!readiness.passed){console.log(JSON.stringify({failedChecks:readiness.checks.filter(c=>!c.passed).map(c=>c.id)}));fail('database_readiness_failed');}
 }
 const initial=await deployment(target.service);
 if(mode==='save'){
  if(initial.status!=='live')fail('stable_deployment_required');
  stage='save-flags';const current=await environment();if(fingerprint(current)!==fingerprint(env))fail('environment_changed_retry');
  const next=new Map(current);for(const key of coordinatorFlags)next.set(key,'true');
  await api(`services/${target.service}/env-vars`,'PUT',[...next].map(([key,value])=>({key,value})));
 }
 stage='verification';const saved=await environment();
 const unrelated=map=>new Map([...map].filter(([key])=>!coordinatorFlags.includes(key)));
 if(fingerprint(unrelated(saved))!==fingerprint(unrelated(env)))fail('unrelated_environment_changed');
 if(coordinatorFlags.some(k=>saved.get(k)!=='true'))fail('activation_settings_missing');
 const [backend,web]=await Promise.all([deployment(target.service),deployment(target.frontend)]);
 const health={};
 for(const [name,url] of [['api',service.serviceDetails.url+'/healthz'],['readiness',service.serviceDetails.url+'/readyz'],['frontend','https://origenedu.ai/']]){
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});health[name]=response.ok;await response.arrayBuffer();
 }
 if(mode==='verify'&&(backend.status!=='live'||web.status!=='live'||backend.revision!==revision||web.revision!==revision||Object.values(health).some(v=>!v)))fail('release_not_live');
 const report={kind:'coordinator-activation',mode,checkedAt:new Date().toISOString(),previousSettings:before,settings:Object.fromEntries(coordinatorFlags.map(k=>[k,saved.get(k)])),databaseReadiness:readiness,deployments:{api:backend,frontend:web},health,unrelatedSettingsPreserved:true,credentialsPrinted:false,deploymentTriggered:false,liveProviderWorkflowTested:false,studentPilotEnrollmentChanged:false};
 if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({stage,status:'activation_incomplete',code:error.safeCode||'verification_failed',credentialsPrinted:false}));process.exitCode=1;}
finally{await Promise.all(pools.map(pool=>pool.end()));}

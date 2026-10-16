import {readFile,writeFile,rename,lstat,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {telemetryPool,assertServiceIsolation,assertTelemetryRole} from './config.mjs';
import {assertErasureWorker} from '../../server/telemetry-erasure-grants.mjs';
import {checkHealth} from './health.mjs';
import {assertFreshStore} from './store.mjs';
import {shadowTick} from './alerts.mjs';
export async function collectSnapshot({telemetry,ledger,application,now=Date.now()}){
 const health=await checkHealth({telemetry,ledger,application,now});let rows=[];
 try{await assertFreshStore(telemetry,ledger);rows=(await telemetry.query('SELECT telemetry_monitor_snapshot() AS snapshot')).rows[0].snapshot;await assertFreshStore(telemetry,ledger);}catch{if(!health.reasons.includes('telemetry_unavailable'))health.reasons.push('telemetry_unavailable');rows=[];}
 return {version:1,at:new Date(now).toISOString(),environment:(await telemetry.query('SELECT environment FROM telemetry_health').catch(()=>({rows:[]}))).rows[0]?.environment??'test',rows,health:health.reasons,syntheticFailures:0,privacyEscapes:0,dropWindow:null,baseline:null};
}
export async function monitorOnce({telemetry,ledger,application,stateFile,environment,probeFile,now=Date.now()}){
 if(!['production','staging','test','development'].includes(environment))throw Error('monitor_unavailable');
 const parent=dirname(resolve(stateFile)),st=await lstat(parent);if(st.isSymbolicLink()||await realpath(parent)!==parent||process.platform!=='win32'&&(st.mode&0o077))throw Error('monitor_unavailable');
 let state;try{const s=await lstat(stateFile);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw Error();state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('monitor_unavailable');}
 const snapshot=await collectSnapshot({telemetry,ledger,application,now});
 const unconfiguredSignals=['synthetic-probes','privacy-boundary-probes','five-minute-drop-denominator','prior-release-baseline'];
 if(probeFile){const st=await lstat(probeFile);if(!st.isFile()||st.isSymbolicLink()||st.size>4096||await realpath(probeFile)!==resolve(probeFile)||process.platform!=='win32'&&(st.mode&0o022))throw Error('monitor_unavailable');const p=JSON.parse(await readFile(probeFile,'utf8'));
  if(Object.keys(p).sort().join(',')!=='at,baseline,dropWindow,privacyEscapes,syntheticFailures,version'||p.version!==1||!Number.isFinite(Date.parse(p.at))||Math.abs(Date.parse(p.at)-now)>90000)throw Error('monitor_unavailable');
  for(const k of ['syntheticFailures','privacyEscapes','dropWindow','baseline'])snapshot[k]=p[k];unconfiguredSignals.length=0;if(p.dropWindow===null)unconfiguredSignals.push('five-minute-drop-denominator');if(p.baseline===null)unconfiguredSignals.push('prior-release-baseline');
 }
 // Expected environment is operator configuration, never an outage fallback or model input.
 if(!snapshot.health.includes('telemetry_unavailable')&&snapshot.environment!==environment)throw Error('monitor_unavailable');snapshot.environment=environment;
 const result=shadowTick(snapshot,state,now),tmp=stateFile+'.next';
 await writeFile(tmp,JSON.stringify(result.state),{flag:'wx',mode:0o600});await rename(tmp,stateFile);
 return {version:1,mode:'shadow',healthy:snapshot.health.length===0,...result,unconfiguredSignals};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const pools=[];try{
 assertServiceIsolation(process.env);const telemetry=telemetryPool(process.env,'TELEMETRY_MONITOR_DATABASE_URL'),ledger=telemetryPool(process.env,'LEDGER_READER_DATABASE_URL'),application=telemetryPool(process.env,'APPLICATION_ERASURE_HEALTH_DATABASE_URL');pools.push(telemetry,ledger,application);
 await assertTelemetryRole(telemetry,'monitor');await assertTelemetryRole(ledger,'ledgerReader');await assertErasureWorker(application,{healthOnly:true});
 const result=await monitorOnce({telemetry,ledger,application,stateFile:process.env.OBSERVABILITY_MONITOR_STATE_FILE,environment:process.env.TELEMETRY_ENVIRONMENT,probeFile:process.env.OBSERVABILITY_MONITOR_PROBE_FILE});process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.healthy)process.exitCode=1;
}catch{process.stdout.write('{"version":1,"mode":"shadow","status":"monitor_unavailable"}\n');process.exitCode=1;}finally{await Promise.all(pools.map(p=>p.end()));}}

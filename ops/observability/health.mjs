import {pathToFileURL} from 'node:url';
import {telemetryPool,assertTelemetryRole} from './config.mjs';
import {assertFreshStore} from './store.mjs';
import {assertErasureWorker} from '../../server/telemetry-erasure-grants.mjs';
export async function checkHealth({telemetry,ledger,application,now=Date.now()}={}){
 const reasons=[];try{const health=await assertFreshStore(telemetry,ledger);
  if(!health.last_canary_at||now-new Date(health.last_canary_at).getTime()>300000)reasons.push('canary_stale');
  if(!health.last_expiry_at||now-new Date(health.last_expiry_at).getTime()>7200000)reasons.push('expiry_stale');
  if(Number(health.erasure_pending)>0&&health.oldest_erasure_at&&now-new Date(health.oldest_erasure_at).getTime()>3600000)reasons.push('erasure_backlog');
  if(application){const row=(await application.query('SELECT * FROM origen_telemetry_outbox_health()')).rows[0];if(Number(row?.pending)>0&&now-new Date(row.oldest).getTime()>3600000)reasons.push('erasure_backlog');}
 }catch{reasons.push('telemetry_unavailable');}
 return {healthy:reasons.length===0,reasons};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pools=[];try{const telemetry=telemetryPool(process.env,'TELEMETRY_HEALTH_DATABASE_URL'),ledger=telemetryPool(process.env,'LEDGER_READER_DATABASE_URL'),application=telemetryPool(process.env,'APPLICATION_ERASURE_HEALTH_DATABASE_URL');pools.push(telemetry,ledger,application);await assertTelemetryRole(telemetry,'health');await assertTelemetryRole(ledger,'ledgerReader');await assertErasureWorker(application,{healthOnly:true});const result=await checkHealth({telemetry,ledger,application});process.stdout.write(JSON.stringify(result)+'\n');if(!result.healthy)process.exitCode=1;}catch{process.stdout.write('{"healthy":false,"reasons":["telemetry_unavailable"]}\n');process.exitCode=1;}finally{await Promise.all(pools.map(pool=>pool.end()));}
}

import {pathToFileURL} from 'node:url';
import {telemetryPool,assertTelemetryRole,separateDatabases,assertServiceIsolation} from './config.mjs';
export async function startRetention(env=process.env){
 assertServiceIsolation(env);
 separateDatabases(env,['TELEMETRY_RETENTION_DATABASE_URL','LEDGER_RETENTION_DATABASE_URL']);
 const telemetry=telemetryPool(env,'TELEMETRY_RETENTION_DATABASE_URL'),ledger=telemetryPool(env,'LEDGER_RETENTION_DATABASE_URL');
 try{
 await assertTelemetryRole(telemetry,'retention');await assertTelemetryRole(ledger,'ledgerRetention');let busy=false;
 const tick=async()=>{if(busy)return;busy=true;try{await telemetry.query('SELECT telemetry_maintain()');await ledger.query('SELECT ledger_expire()');}finally{busy=false;}};
 await tick();const timer=setInterval(()=>{void tick().catch(()=>{});},60000);return {tick,close:async()=>{clearInterval(timer);await Promise.all([telemetry.end(),ledger.end()]);}};
 }catch(error){await Promise.all([telemetry.end(),ledger.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const worker=await startRetention();process.on('SIGTERM',()=>{void worker.close();});process.on('SIGINT',()=>{void worker.close();});}catch{process.stderr.write('Telemetry retention startup failed.\n');process.exitCode=1;}}

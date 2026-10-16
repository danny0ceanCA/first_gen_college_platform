import {telemetryPool,assertTelemetryRole,separateDatabases,assertServiceIsolation} from './config.mjs';
import {pathToFileURL} from 'node:url';
import {assertErasureWorker} from '../../server/telemetry-erasure-grants.mjs';
export async function replayLedger(telemetry,ledger,{after='0'}={}){
 await telemetry.query('SELECT telemetry_block()');const generation=(await ledger.query('SELECT ledger_generation() AS generation')).rows[0].generation;
 let cursor=after;for(;;){const rows=(await ledger.query('SELECT * FROM ledger_page($1,$2)',[cursor,generation])).rows;if(!rows.length)break;
  await telemetry.query('SELECT telemetry_erase($1::jsonb,$2)',[JSON.stringify(rows.filter(r=>r.kind!=='case').map(r=>({environment:r.environment,kind:r.kind,reference:r.reference,expiresAt:new Date(r.expires_at).toISOString()}))),generation]);cursor=rows.at(-1).sequence;
 }
 await telemetry.query('SELECT telemetry_ready($1)',[generation]);return generation;
}
export function createErasureWorker({application,telemetry,ledger}={}){
 let busy=false,closed=false,lastGeneration;
 return {
  async tick(){if(busy||closed)return;busy=true;try{
   const rows=(await application.query('SELECT * FROM origen_telemetry_outbox_batch()')).rows;
   if(rows.length)await ledger.query('SELECT ledger_append($1::jsonb)',[JSON.stringify(rows.map(({kind,reference})=>({kind,reference})))]);
   const generation=(await ledger.query('SELECT ledger_generation() AS generation')).rows[0].generation;
   const health=(await telemetry.query('SELECT * FROM telemetry_health')).rows[0];
   if(lastGeneration!==String(generation)||!health?.ready||String(health.ledger_generation)!==String(generation)){await replayLedger(telemetry,ledger,{after:health?.ready?health.ledger_generation:'0'});lastGeneration=String(generation);}
   if(rows.length)await application.query('SELECT origen_telemetry_outbox_ack($1::uuid[])',[rows.map(r=>r.id)]);
   await application.query('SELECT origen_telemetry_outbox_expire()');return {delivered:rows.length,generation};
  }finally{busy=false;}},
  stop(){closed=true;},
 };
}
export async function startErasureWorker(env=process.env){
 assertServiceIsolation(env);
 separateDatabases(env,['APPLICATION_ERASURE_DATABASE_URL','TELEMETRY_ERASURE_DATABASE_URL','LEDGER_WRITER_DATABASE_URL']);
 const application=telemetryPool(env,'APPLICATION_ERASURE_DATABASE_URL'),telemetry=telemetryPool(env,'TELEMETRY_ERASURE_DATABASE_URL'),ledger=telemetryPool(env,'LEDGER_WRITER_DATABASE_URL');
 try{
 await assertTelemetryRole(telemetry,'erasure');await assertTelemetryRole(ledger,'ledgerWriter');
 // The application login receives only the four outbox/health routines.
 await assertErasureWorker(application);
 const worker=createErasureWorker({application,telemetry,ledger});await worker.tick();const timer=setInterval(()=>{void worker.tick().catch(()=>{});},1000);timer.unref();
 return {tick:worker.tick,close:async()=>{clearInterval(timer);worker.stop();await Promise.all([application.end(),telemetry.end(),ledger.end()]);}};
 }catch(error){await Promise.all([application.end(),telemetry.end(),ledger.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const worker=await startErasureWorker();const alive=setInterval(()=>{},60000);process.on('SIGTERM',()=>{clearInterval(alive);void worker.close();});process.on('SIGINT',()=>{clearInterval(alive);void worker.close();});}catch{process.stderr.write('Telemetry erasure startup failed.\n');process.exitCode=1;}}

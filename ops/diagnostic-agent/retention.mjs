import {pathToFileURL} from 'node:url';
import {telemetryPool,assertServiceIsolation} from '../observability/config.mjs';
import {assertAgentRole} from './audit.mjs';
export async function startAgentRetention(env=process.env,{onFailure=()=>{}}={}){
 assertServiceIsolation(env);const pool=telemetryPool(env,'AGENT_RETENTION_DATABASE_URL');let busy=false,stopped=false;
 const tick=async()=>{if(busy||stopped)return;busy=true;try{await pool.query('SELECT agent_expire()');}finally{busy=false;}};
 try{await assertAgentRole(pool,'retention');await tick();const timer=setInterval(()=>{void tick().catch(()=>{stopped=true;clearInterval(timer);onFailure();});},60000);timer.unref();return {tick,close:async()=>{stopped=true;clearInterval(timer);await pool.end();}};}catch(error){await pool.end();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let job,alive;try{job=await startAgentRetention(process.env,{onFailure:()=>{process.stderr.write('Diagnostic retention failed.\n');process.exitCode=1;clearInterval(alive);void job.close();}});alive=setInterval(()=>{},60000);const stop=()=>{clearInterval(alive);void job.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);}catch{process.stderr.write('Diagnostic retention startup failed.\n');process.exitCode=1;}}

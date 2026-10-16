import {createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateWireEvent,validateMetric,environments} from '../../server/observability/wire.mjs';
import {assertFreshStore} from './store.mjs';
import {telemetryPool,assertTelemetryRole,separateDatabases,assertServiceIsolation} from './config.mjs';
const digest=value=>createHash('sha256').update(value).digest();
export function createIngest({pool,ledger,token,previousToken,previousUntil,environment,clock=Date.now}={}){
 if(typeof token!=='string'||token.length<32||!environments.includes(environment)||previousToken&&(previousToken.length<32||!Number.isFinite(Date.parse(previousUntil))||Date.parse(previousUntil)>clock()+86400000))throw new Error('telemetry_configuration_invalid');
 const current=digest(token),previous=previousToken?digest(previousToken):null;let minute=-1,count=0;
 return async(req,res)=>{
  const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(!req.socket?.encrypted)return send(426,'tls_required');
  if(req.method!=='POST'||req.url!=='/v1/batch')return send(404,'not_found');
  const authorization=req.headers.authorization;
  if(typeof authorization!=='string'||authorization.length>512||!authorization.startsWith('Bearer '))return send(401,'authentication_required');
  const supplied=digest(authorization.slice(7));if(!timingSafeEqual(current,supplied)&&!(previous&&clock()<Date.parse(previousUntil)&&timingSafeEqual(previous,supplied)))return send(401,'authentication_required');
  const nowMinute=Math.floor(clock()/60000);if(nowMinute!==minute){minute=nowMinute;count=0;}if(++count>60){res.setHeader('Retry-After','60');return send(429,'rate_limited');}
  if(req.headers['content-type']!=='application/json')return send(415,'json_required');
  const chunks=[];let size=0,timer;
  try{
   const reading=(async()=>{for await(const chunk of req){size+=chunk.length;if(size>262144)throw Object.assign(Error(),{status:413});chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));})();
   const batch=await Promise.race([reading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{status:408})),2000);})]);clearTimeout(timer);
   if(!batch||batch.schemaVersion!==1||Object.keys(batch).length!==3||!Array.isArray(batch.events)||!Array.isArray(batch.metrics)||batch.events.length+batch.metrics.length<1||batch.events.length+batch.metrics.length>100)throw Object.assign(Error(),{status:400});
   batch.events=batch.events.map(validateWireEvent);batch.metrics=batch.metrics.map(validateMetric);
   for(const item of [...batch.events,...batch.metrics])if(item.environment!==environment||Date.parse(item.time||item.interval)<clock()-600000||Date.parse(item.time||item.interval)>clock()+60000)throw Object.assign(Error(),{status:400});
   await assertFreshStore(pool,ledger);await pool.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify(batch)]);return send(202);
  }catch(error){clearTimeout(timer);if(error.message==='telemetry_rate_limited'){res.setHeader('Retry-After',String(Math.max(1,60-Math.floor(clock()/1000)%60)));return send(429,'rate_limited');}return send([400,408,413].includes(error.status)?error.status:error instanceof SyntaxError||error.message?.startsWith('invalid_telemetry_')?400:503,'telemetry_unavailable');}
 };
}
export async function startIngest(env=process.env){
 assertServiceIsolation(env);
 if(!env.OBSERVABILITY_DEPLOYMENT_RECORD)throw new Error('telemetry_configuration_invalid');
 separateDatabases(env,['TELEMETRY_DATABASE_URL','LEDGER_READER_DATABASE_URL']);
 const pool=telemetryPool(env,'TELEMETRY_DATABASE_URL'),ledger=telemetryPool(env,'LEDGER_READER_DATABASE_URL');let server;
 try{await assertTelemetryRole(pool,'ingest');await assertTelemetryRole(ledger,'ledgerReader');await assertFreshStore(pool,ledger);
  if((await pool.query('SELECT environment FROM telemetry_health')).rows[0]?.environment!==env.TELEMETRY_ENVIRONMENT)throw new Error('telemetry_configuration_invalid');
  server=createServer({cert:await readFile(env.TELEMETRY_TLS_CERT_FILE),key:await readFile(env.TELEMETRY_TLS_KEY_FILE),minVersion:'TLSv1.2',maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},createIngest({pool,ledger,token:env.OBSERVABILITY_INGEST_TOKEN,previousToken:env.OBSERVABILITY_PREVIOUS_TOKEN,previousUntil:env.OBSERVABILITY_PREVIOUS_UNTIL,environment:env.TELEMETRY_ENVIRONMENT}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.PORT||3002),'0.0.0.0',resolve);});return {server,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.all([pool.end(),ledger.end()]);}};
 }catch(error){await Promise.all([pool.end(),ledger.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const app=await startIngest();let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void app.close();};process.on('SIGTERM',stop);process.on('SIGINT',stop);}catch{process.stderr.write('Telemetry ingest startup failed.\n');process.exitCode=1;}}

import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createInvestigator} from './gateway.mjs';
import {createAuthority,createEvidenceReader} from './store.mjs';
import {telemetryPool,assertTelemetryRole,separateDatabases,assertServiceIsolation} from '../observability/config.mjs';
import {assertSupportResolver} from '../../server/support-diagnostics-grants.mjs';
import {capabilityEnabled} from '../diagnostic-controls.mjs';

export function gatewayAuthenticator(env,jwks){
 if(!env.DIAGNOSTICS_AUDIENCE||!env.AUTH0_AUDIENCE||env.DIAGNOSTICS_AUDIENCE===env.AUTH0_AUDIENCE||!/^[a-z0-9.-]+$/.test(env.AUTH0_DOMAIN||''))throw Error('support_configuration_invalid');
 const keys=jwks||createRemoteJWKSet(new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`),{timeoutDuration:2000});
 return async token=>(await jwtVerify(token,keys,{issuer:`https://${env.AUTH0_DOMAIN}/`,audience:env.DIAGNOSTICS_AUDIENCE,algorithms:['RS256']})).payload;
}
export function createGatewayHandler({investigator,authenticate,machineSubjects=[],machineEnabled=()=>true,clock=Date.now}){
 const buckets=new Map();let minute=-1,total=0;
 return async(req,res)=>{
  let machine=false;
  const send=(status,body)=>{if(status===200&&machine&&req.url!=='/v1/revoke'&&!machineEnabled()){status=403;body={error:'support_unavailable'};}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body));};
  if(!req.socket?.encrypted)return send(426,{error:'tls_required'});
  if(req.method!=='POST'||!['/v1/capabilities','/v1/evidence','/v1/revoke','/v1/validate'].includes(req.url))return send(404,{error:'not_found'});
  const at=clock(),m=Math.floor(at/60000);if(m!==minute){minute=m;total=0;}if(++total>600)return send(429,{error:'rate_limited'});
  let timer;
  try{
   const token=/^Bearer ([\w.-]+)$/.exec(req.headers.authorization||'')?.[1];if(!token||token.length>8192)throw Error();
   const actor=await authenticate(token);
   machine=machineSubjects.includes(actor?.sub);
   if(typeof actor?.sub!=='string'||!Array.isArray(actor.permissions)||!actor.permissions.includes('observability:investigate'))throw Error();
   if(machineSubjects.includes(actor.sub)&&req.url!=='/v1/revoke'&&!machineEnabled())throw Error();
   for(const [key,bucket] of buckets)if(bucket.until<=at)buckets.delete(key);
   let bucket=buckets.get(actor.sub);if(!bucket){if(buckets.size>=1000)return send(429,{error:'rate_limited'});bucket={until:at+60000,count:0};buckets.set(actor.sub,bucket);}if(++bucket.count>30)return send(429,{error:'rate_limited'});
   if(req.headers['content-type']!=='application/json')throw Error();
   const reading=(async()=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12288)throw Error();chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString());})();
   const input=await Promise.race([reading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2000);})]);
   if(!input||typeof input!=='object'||Array.isArray(input))throw Error();
   if(req.url==='/v1/capabilities'){
    if(Object.keys(input).some(k=>!['caseId','purpose','recipient'].includes(k))||input.recipient&&input.recipient!==actor.sub&&!machineSubjects.includes(input.recipient))throw Error();
    return send(200,await investigator.issue(actor,input));
   }
   if(req.url==='/v1/evidence'){if(Object.keys(input).some(k=>!['capability','query'].includes(k)))throw Error();return send(200,await investigator.evidence(actor,input.capability,input.query));}
   if(Object.keys(input).join(',')!=='capability')throw Error();
   if(req.url==='/v1/validate')return send(200,await investigator.validate(actor,input.capability));
   await investigator.revoke(actor,input.capability);return send(200,{ok:true});
  }catch{return send(403,{error:'support_unavailable'});}finally{clearTimeout(timer);}
 };
}
export async function startGateway(env=process.env){
 assertServiceIsolation(env);
 if(env.SUPPORT_GATEWAY_ENABLED!=='true'||!env.OBSERVABILITY_DEPLOYMENT_RECORD||!env.DIAGNOSTICS_AUDIENCE||!env.AUTH0_AUDIENCE||env.DIAGNOSTICS_AUDIENCE===env.AUTH0_AUDIENCE||!/^[a-z0-9.-]+$/.test(env.AUTH0_DOMAIN||''))throw Error('support_configuration_invalid');
 separateDatabases(env,['APPLICATION_SUPPORT_DATABASE_URL','TELEMETRY_QUERY_DATABASE_URL','SUPPORT_CONTROL_DATABASE_URL']);
 const application=telemetryPool(env,'APPLICATION_SUPPORT_DATABASE_URL'),telemetry=telemetryPool(env,'TELEMETRY_QUERY_DATABASE_URL'),control=telemetryPool(env,'SUPPORT_CONTROL_DATABASE_URL');
 let investigator,server;
 try{
  await assertSupportResolver(application);await assertTelemetryRole(telemetry,'query');await assertTelemetryRole(control,'support');
  for(const pool of [application,telemetry,control])if((await pool.query('SELECT pg_is_in_recovery() AS replica')).rows[0]?.replica!==false)throw Error('support_primary_required');
  const authority=createAuthority({application,telemetry,control,ledger:control});
  const health=await authority.fresh();if(health.environment!==env.TELEMETRY_ENVIRONMENT)throw Error('support_configuration_invalid');
  investigator=createInvestigator({authority,readEvidence:createEvidenceReader(telemetry),signingKey:await readFile(env.SUPPORT_SIGNING_KEY_FILE,'utf8'),publicKey:await readFile(env.SUPPORT_VERIFY_KEY_FILE,'utf8'),audience:env.DIAGNOSTICS_AUDIENCE,environment:env.TELEMETRY_ENVIRONMENT,sourceRoot:env.SUPPORT_SOURCE_ROOT,machineSubjects:(env.SUPPORT_MACHINE_SUBJECTS||'').split(',').filter(Boolean),gatewayRevision:env.RENDER_GIT_COMMIT||env.APPLICATION_REVISION});
  const authenticate=gatewayAuthenticator(env);
  server=createServer({cert:await readFile(env.SUPPORT_TLS_CERT_FILE),key:await readFile(env.SUPPORT_TLS_KEY_FILE),minVersion:'TLSv1.2',maxHeaderSize:12288,requestTimeout:5000,headersTimeout:5000},createGatewayHandler({investigator,authenticate,machineSubjects:(env.SUPPORT_MACHINE_SUBJECTS||'').split(',').filter(Boolean),machineEnabled:()=>capabilityEnabled(env.DIAGNOSTIC_AGENT_CONTROL_FILE)}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.PORT||3003),'0.0.0.0',resolve);});
  return {server,close:async()=>{investigator.close();server.closeAllConnections();await new Promise(r=>server.close(r));await Promise.all([application.end(),telemetry.end(),control.end()]);}};
 }catch(error){investigator?.close();await Promise.all([application.end(),telemetry.end(),control.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const app=await startGateway();let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void app.close();};process.on('SIGTERM',stop);process.on('SIGINT',stop);}catch{process.stderr.write('Support gateway startup failed.\n');process.exitCode=1;}}

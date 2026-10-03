import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createAIHandler} from './ai.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createFinanceResearchHandler} from './finance-research.mjs';
import {createAdmissionsResearchHandler} from './admissions-research.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createDiagnosticHandler,diagnosticRecord} from './diagnostics.mjs';
import {createDatabase,migrateDatabase,databaseReady} from './database.mjs';
import {createHistoryHandler} from './history.mjs';
import {createFamilyHandler} from './family.mjs';
import {instrumentRequest,safeErrorCode} from './api-logging.mjs';

export function createApp(env=process.env,verify,database=null,writeLog=record=>console.log(JSON.stringify(record))){
 const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 const domain=env.AUTH0_DOMAIN,audience=env.AUTH0_AUDIENCE;
 const jwks=domain?createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)):null;
 const authenticate=verify||(async token=>{if(!jwks||!audience)throw new Error('Authentication not configured');return (await jwtVerify(token,jwks,{issuer:`https://${domain}/`,audience,algorithms:['RS256']})).payload;});
 const log=input=>writeLog(diagnosticRecord(input));
 const handlers=[createFamilyHandler(database),createHistoryHandler(database),createSummaryHandler(env,fetch,database),createDiagnosticHandler(log),createFinanceResearchHandler(env,fetch,log),createAdmissionsResearchHandler(env,fetch,log),createProfileVoiceHandler(env,fetch,log,database),createAIHandler(env)];
 const buckets=new Map();
 const previewPaths=new Set(['/api/profile-voice','/api/finance-research','/api/admissions-research','/api/voice-diagnostics','/api/conversation-summary']);
 let previewStarts={count:0,reset:0};
 return async(req,res)=>{
  instrumentRequest(req,res,writeLog);
  const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(req.url==='/healthz'&&req.method==='GET')return send(200);
  if(req.url==='/readyz'&&req.method==='GET')return await databaseReady(database)?send(200):send(503,'database_not_ready');
  if(!req.url?.startsWith('/api/'))return send(404,'not_found');
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return send(403,'origin_not_allowed');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','X-Request-ID');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Origen-Session, X-Camino-Session');
   res.writeHead(204);return res.end();
  }
  if(req.method!=='POST')return send(405,'method_not_allowed');
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  const path=req.url.split('?')[0];
  const preview=!req.headers.authorization&&env.ALLOW_PREVIEW_VOICE==='true'&&!!origin&&previewPaths.has(path);
  if(!token&&!preview)return send(401,'authentication_required');
  let identity;
  if(!preview){try{identity=await authenticate(token);if(!identity.sub)throw new Error();}catch{return send(401,'invalid_token');}}
  const now=Date.now();for(const [key,value] of buckets)if(value.reset<now)buckets.delete(key);
  // Anonymous preview traffic shares a capped bucket; no untrusted client IP headers.
  const bucketKey=preview?'anonymous-preview':`account:${identity.sub}`;
  const bucket=buckets.get(bucketKey)||{count:0,reset:now+60000};buckets.set(bucketKey,bucket);
  if(++bucket.count>120){res.setHeader('Retry-After','60');return send(429,'rate_limited');}
  if(preview&&path==='/api/profile-voice'){
   if(previewStarts.reset<now)previewStarts={count:0,reset:now+60000};
   if(++previewStarts.count>5){res.setHeader('Retry-After','60');return send(429,'rate_limited');}
  }
  req.origenAuthorized=!preview;
  req.origenPreview=preview;
  req.origenIdentity=identity;
  let i=0;const next=()=>{const handler=handlers[i++];return handler?handler(req,res,next):send(404,'not_found');};
  try{await next();}catch(error){req.log({event:'api_error',level:'error',code:safeErrorCode(error)});if(!res.headersSent)send(500,'server_error');else res.end();}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const key of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS'])if(!process.env[key])throw new Error(`Missing ${key}`);
 const database=createDatabase();
 try{
  if(database){await migrateDatabase(database);console.log('Origen database migrations are up to date.');}
  else console.warn('DATABASE_URL is not set; persistent storage is unavailable.');
  const server=createServer(createApp(process.env,undefined,database));
  server.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Origen API listening'));
  let stopping=false;
  const shutdown=()=>{
   if(stopping)return;stopping=true;
   const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
   server.close(async()=>{try{await database?.end();}finally{clearTimeout(deadline);}});
  };
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
 }catch{
  console.error('Origen database initialization failed. Check DATABASE_URL and database availability.');
  await database?.end();process.exitCode=1;
 }
}

import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createAIHandler} from './ai.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createFinanceResearchHandler} from './finance-research.mjs';
import {createAdmissionsResearchHandler} from './admissions-research.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createDiagnosticHandler,diagnosticRecord} from './diagnostics.mjs';

export function createApp(env=process.env,verify){
 const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 const domain=env.AUTH0_DOMAIN,audience=env.AUTH0_AUDIENCE;
 const jwks=domain?createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)):null;
 const authenticate=verify||(async token=>{if(!jwks||!audience)throw new Error('Authentication not configured');return (await jwtVerify(token,jwks,{issuer:`https://${domain}/`,audience,algorithms:['RS256']})).payload;});
 const log=input=>console.log(JSON.stringify(diagnosticRecord(input)));
 const handlers=[createSummaryHandler(env),createDiagnosticHandler(log),createFinanceResearchHandler(env,fetch,log),createAdmissionsResearchHandler(env,fetch,log),createProfileVoiceHandler(env,fetch,log),createAIHandler(env)];
 const buckets=new Map();
 return async(req,res)=>{
  const send=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error?{error}:{ok:true}));};
  if(req.url==='/healthz'&&req.method==='GET')return send(200);
  if(!req.url?.startsWith('/api/'))return send(404,'not_found');
  const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return send(403,'origin_not_allowed');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Origen-Session, X-Camino-Session');
   res.writeHead(204);return res.end();
  }
  if(req.method!=='POST')return send(405,'method_not_allowed');
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token)return send(401,'authentication_required');
  let identity;try{identity=await authenticate(token);if(!identity.sub)throw new Error();}catch{return send(401,'invalid_token');}
  const now=Date.now();for(const [key,value] of buckets)if(value.reset<now)buckets.delete(key);
  const bucket=buckets.get(identity.sub)||{count:0,reset:now+60000};buckets.set(identity.sub,bucket);
  if(++bucket.count>120){res.setHeader('Retry-After','60');return send(429,'rate_limited');}
  req.origenAuthorized=true;
  let i=0;const next=()=>{const handler=handlers[i++];return handler?handler(req,res,next):send(404,'not_found');};
  try{await next();}catch{if(!res.headersSent)send(500,'server_error');else res.end();}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const key of ['AUTH0_DOMAIN','AUTH0_AUDIENCE','ALLOWED_ORIGINS'])if(!process.env[key])throw new Error(`Missing ${key}`);
 createServer(createApp()).listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Origen API listening'));
}

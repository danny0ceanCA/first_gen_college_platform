// Test-only transport: real HTTP handlers, migrations, RLS and runtime grants.
// The only replaced service is Auth0 identity verification. Never mount in app.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {retrievalFixture} from '../history-retrieval-fixture.mjs';
import {createCoordinatorHandler} from '../coordinator-access.mjs';
import {createInstitutionHandler} from '../institutions.mjs';
import {MFA_TIME_CLAIM} from '../staff-access.mjs';
import {AUTH_TIME_CLAIM} from '../recent-auth.mjs';
import {coordinatorFlags} from '../binder-sharing-policy.mjs';
import {createCoordinatorConnectionsHandler} from '../coordinator-connections.mjs';
import {createCoordinatorBindersHandler} from '../coordinator-binders.mjs';
import {createCoordinatorFeedbackHandler} from '../coordinator-feedback.mjs';
import {createCoordinatorNotificationsHandler} from '../coordinator-notifications.mjs';

export async function coordinatorRegistrationFixture(options){
 const f=await retrievalFixture(options),transportSecret=randomUUID(),actors=new Map();let server;
 const close=async()=>{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});await f.close();};
 try{
  const env={AUTH0_DOMAIN:'registration.synthetic',...Object.fromEntries(coordinatorFlags.map(k=>[k,'true'])),INSTITUTION_REVIEWER_SUBJECTS:'reviewer'};
  const actor=(sub,options={})=>actors.set(sub,{mfa:true,verified:true,reviewer:sub==='reviewer',...options});
  for(const sub of ['applicant','owner','reviewer','invited','legacy'])actor(sub);
  const provider=async(_url,options)=>{
   const sub=options.headers.Authorization?.replace('Bearer ','')||options.headers.authorization?.replace('Bearer ',''),config=actors.get(sub);
   if(config?.providerError)throw new Error('synthetic_identity_outage');
   if(config?.providerDelayMs)await new Promise(r=>setTimeout(r,Math.min(config.providerDelayMs,1000)));
   options.signal?.throwIfAborted();
   return new Response(JSON.stringify({sub,email:`${sub}@example.test`,email_verified:config?.verified===true,given_name:sub}),{status:200});
  };
  const handlers=[createCoordinatorHandler(f.db,env,provider),createInstitutionHandler(f.db,env,provider),createCoordinatorConnectionsHandler(f.db,env,provider),createCoordinatorBindersHandler(f.db,env,provider),createCoordinatorFeedbackHandler(f.db,env,provider),createCoordinatorNotificationsHandler(f.db,env,provider)];
  server=createServer((req,res)=>{
   const sub=req.headers['x-synthetic-actor'],config=actors.get(sub);
   if(req.headers['x-synthetic-secret']!==transportSecret||!config){res.writeHead(401);return res.end();}
   // Stress-test an uncertain response after the real handler has committed.
   if(req.headers['x-synthetic-drop-response']==='true')res.end=()=>{res.destroy();return res;};
   const now=Math.floor(Date.now()/1000);req.origenAuthorized=true;
   // Test-controlled claims model expiry, refresh and malformed provider proof.
   // These overrides are never accepted from an HTTP body or production token.
   const claims=typeof config.claims==='function'?config.claims(now):config.claims||{};
   req.origenIdentity={iat:now,permissions:config.reviewer?['manage:institutions']:[],...(config.mfa?{[MFA_TIME_CLAIM]:now,[AUTH_TIME_CLAIM]:now}:{}),...claims,sub};
   req.headers.authorization=`Bearer ${sub}`;
   f.as(sub,async()=>{let i=0;const next=()=>i<handlers.length?handlers[i++](req,res,next):(res.writeHead(404),res.end());await next();}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(sub,path,input)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':transportSecret},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
  const call=async(sub,path,input)=>{const r=await request(sub,path,input);if(r.status!==200)throw Object.assign(new Error(r.body.error),{status:r.status});return r.body;};
  return {...f,base,transportSecret,env,actor,request,call,close};
 }catch(e){await close();throw e;}
}

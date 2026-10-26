import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationIdentity} from './institution-access.mjs';
import {createTrustedIdentityLookup} from './trusted-identity.mjs';
import {createCoordinatorHandler} from './coordinator-access.mjs';
import {Readable} from 'node:stream';

const req={headers:{authorization:'Bearer synthetic-token'},origenIdentity:{sub:'synthetic-user'}};
const env={AUTH0_DOMAIN:'identity.example.test'};
test('temporary Auth0 failures do not demand another login or email verification',async()=>{
 for(const status of [429,500,502,503]){
  await assert.rejects(invitationIdentity(req,env,async()=>Response.json({error:'temporary'},{status})),{status:503,message:'identity_verification_unavailable'});
 }
});
test('invalid credentials and mismatched identities remain denied',async()=>{
 for(const status of [401,403])await assert.rejects(invitationIdentity(req,env,async()=>Response.json({}, {status})),{status:403,message:'invitation_email_required'});
 await assert.rejects(invitationIdentity(req,env,async()=>Response.json({sub:'another-user',email_verified:true})),{status:403});
});
const profile={sub:'synthetic-user',email:'synthetic@example.test',email_verified:true};
test('concurrent and sequential workspace loads reuse one verified lookup',async()=>{
 const lookup=createTrustedIdentityLookup();let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const fetcher=async()=>{calls++;await gate;return Response.json(profile);};
 const requests=Array.from({length:30},()=>lookup(req,env,fetcher));release();
 const results=await Promise.all(requests);assert.equal(calls,1);assert.ok(results.every(r=>r.sub===profile.sub));
 assert.deepEqual(await lookup(req,env,fetcher),profile);assert.equal(calls,1);
 assert.throws(()=>{results[0].email='forged@example.test';},TypeError);
});
test('cache expires after one minute and never extends access-token lifetime',async()=>{
 let clock=100000,calls=0;const lookup=createTrustedIdentityLookup({now:()=>clock});
 const fetcher=async()=>{calls++;return Response.json(profile);};
 await lookup(req,env,fetcher);clock+=59999;await lookup(req,env,fetcher);assert.equal(calls,1);
 clock++;await lookup(req,env,fetcher);assert.equal(calls,2);
 const expiring={...req,headers:{authorization:'Bearer expiring'},origenIdentity:{sub:profile.sub,exp:161}};
 await lookup(expiring,env,fetcher);clock=161001;await lookup(expiring,env,fetcher);assert.equal(calls,4);
});
test('tokens, accounts and issuers never share verified identity results',async()=>{
 const lookup=createTrustedIdentityLookup();let calls=0;const fetcher=async()=>{calls++;return Response.json(profile);};
 await lookup(req,env,fetcher);
 await lookup({...req,headers:{authorization:'Bearer other-token'}},env,fetcher);
 await lookup(req,{AUTH0_DOMAIN:'second.example.test'},fetcher);
 await assert.rejects(lookup({...req,origenIdentity:{sub:'another-user'}},env,fetcher),{status:403});
 assert.equal(calls,4);
});
test('transient failures, malformed responses and unverified email are not cached',async()=>{
 for(const initial of ['rate-limit','network','json','unverified']){
  const lookup=createTrustedIdentityLookup();let calls=0;
  const fetcher=async()=>{if(++calls>1)return Response.json(profile);if(initial==='network')throw Error('network');if(initial==='rate-limit')return Response.json({}, {status:429});if(initial==='json')return new Response('invalid json');return Response.json({...profile,email_verified:false});};
  if(initial==='unverified')assert.equal((await lookup(req,env,fetcher)).email_verified,false);
  else await assert.rejects(lookup(req,env,fetcher),{status:503,message:'identity_verification_unavailable'});
  assert.equal((await lookup(req,env,fetcher)).email_verified,true);assert.equal(calls,2);
 }
});
test('verified-profile cache has bounded capacity',async()=>{
 const lookup=createTrustedIdentityLookup({maxEntries:2});let calls=0;const fetcher=async()=>{calls++;return Response.json(profile);};
 for(const token of ['one','two','three','one'])await lookup({...req,headers:{authorization:`Bearer ${token}`}},env,fetcher);
 assert.equal(calls,4);
});
test('coordinator endpoint preserves temporary verification error without touching database',async()=>{
 const handler=createCoordinatorHandler({query:()=>assert.fail('verification must finish first')},{...env,ORIGEN_COORDINATOR_ACCOUNTS:'true'},async()=>Response.json({}, {status:429}));
 const request=Readable.from([JSON.stringify({action:'application-status'})]);Object.assign(request,{url:'/api/coordinator-access',method:'POST',headers:{...req.headers,'content-type':'application/json'},origenIdentity:req.origenIdentity,origenAuthorized:true});
 let status,body;await handler(request,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>assert.fail('wrong route'));
 assert.equal(status,503);assert.deepEqual(body,{error:'identity_verification_unavailable'});
});

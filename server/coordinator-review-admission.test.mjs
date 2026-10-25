import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createReviewAdmission,isReviewDiscovery,isReviewWork,reviewAdmissionFor} from './coordinator-review-admission.mjs';
import {createCoordinatorHandler} from './coordinator-access.mjs';
import {runAsAccount} from './account-isolation.mjs';
import {MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';

test('review limiter releases once and discovery classification stays read-only',()=>{
 const gate=createReviewAdmission(1),release=gate.acquire();assert.equal(gate.acquire(),null);release();release();
 const next=gate.acquire();assert.equal(typeof next,'function');assert.equal(gate.acquire(),null);next();
 for(const action of ['applications','application-organizations','organization-queue'])assert.equal(isReviewDiscovery(action),true);
 for(const action of ['approve-application','withdraw-application','suspend-organization','disable-member','revoke-code','overview'])assert.equal(isReviewDiscovery(action),false);
 assert.throws(()=>createReviewAdmission(0));assert.throws(()=>createReviewAdmission(5));
});

test('approval endpoints share capacity while access removal remains available',()=>{
 const database={},a=reviewAdmissionFor(database),b=reviewAdmissionFor(database);
 assert.equal(a,b);assert.notEqual(a,reviewAdmissionFor({}));
 const releaseA=a.acquire(),releaseB=b.acquire();assert.equal(a.acquire(),null);
 for(const action of ['queue','verify','publish','request-changes','review-affiliation','approve-organization','approve-application','decline-application'])assert.equal(isReviewWork(action),true);
 for(const action of ['suspend-organization','disable-member','revoke-code','withdraw-application'])assert.equal(isReviewWork(action),false);
 releaseA();releaseB();
});

test('150 simultaneous review reads admit two, shed the rest before DB/auth-provider work, and recover',{timeout:10000},async()=>{
 let release,entered=0,peak=0,active=0,providerCalls=0,controls=0;
 const hold=new Promise(r=>release=r);
 const database={async query(sql){
  if(sql.includes('origen_staff_access_controls')){controls++;return {rows:[]};}
  if(sql.includes('origen_privileged_access_audit'))return {rows:[]};
  assert.ok(sql.includes('origen_coordinator_application_command'));entered++;active++;peak=Math.max(peak,active);
  try{await hold;return {rows:[{result:{organizations:[]}}]};}finally{active--;}
 }};
 let failProvider=false;
 const handler=createCoordinatorHandler(database,{ORIGEN_COORDINATOR_ACCOUNTS:'true',AUTH0_DOMAIN:'synthetic.example'},async()=>{providerCalls++;if(failProvider)throw Error('synthetic outage');return new Response(JSON.stringify({sub:'reviewer',email:'reviewer@example.test',email_verified:true}));});
 const seconds=Math.floor(Date.now()/1000),identity={sub:'reviewer',iat:seconds,permissions:['manage:institutions'],[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds};
 const invoke=async()=>{
  const req=Readable.from([JSON.stringify({action:'application-organizations',id:randomUUID()})]);
  Object.assign(req,{url:'/api/coordinator-access',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic'},origenAuthorized:true,origenIdentity:identity});
  const response={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=JSON.parse(body);}};
  await runAsAccount(identity,()=>handler(req,response,()=>assert.fail('unexpected route')));return response;
 };
 const work=Array.from({length:150},()=>invoke());
 while(entered<2)await new Promise(r=>setImmediate(r));
 assert.equal(controls,2);assert.equal(providerCalls,2);assert.equal(peak,2);release();
 const results=await Promise.all(work),denied=results.filter(r=>r.status===429);
 assert.equal(results.filter(r=>r.status===200).length,2);assert.equal(denied.length,148);
 for(const r of denied){assert.deepEqual(r.body,{error:'coordinator_review_busy'});assert.equal(r.headers['Retry-After'],'2');assert.equal(r.headers['Cache-Control'],'no-store');}
 failProvider=true;assert.equal((await invoke()).status,503);assert.equal((await invoke()).status,503);
 failProvider=false;assert.equal((await invoke()).status,200);assert.equal(active,0);
});

// Explicit, bounded local stress run. Real handlers, SQL, RLS and migrations;
// synthetic Auth0 identities. Never sends traffic to production or Auth0.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {coordinatorRegistrationFixture} from '../server/fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const count=Number(option('--users','120')),concurrency=Number(option('--concurrency','80')),pool=Number(option('--pool','5'));
const seed=Number(option('--seed','20261020'));if(!Number.isInteger(seed)||seed<1||seed>0xffffffff)throw Error('seed must be a positive 32-bit integer');
const output=option('--output',null);let url;try{url=new URL(process.env.DATABASE_TEST_URL);}catch{}
if(!args.includes('--disposable-database')||!output||!url||!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||![count,concurrency,pool].every(Number.isInteger)||count<10||count>500||concurrency<2||concurrency>150||pool<2||pool>30)throw Error('Use a disposable loopback DATABASE_TEST_URL, --disposable-database --output <new-directory>; users 10–500, concurrency 2–150, pool 2–30.');
await mkdir(resolve(output));
const report={users:count,concurrency,pool,seed,startedAt:new Date().toISOString(),syntheticAuth0:true,scenarios:[],passed:false},timings=[];
let randomState=seed;const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return (randomState>>>0)/4294967296;};
const f=await coordinatorRegistrationFixture({runtimePoolSize:pool,productionTimeouts:true}),api='/api/coordinator-access',institutions='/api/institutions';
let current,active=0,peak=0;
async function send(sub,path,input,{allowed=[200],drop=false}={}){
 const start=performance.now();active++;peak=Math.max(peak,active);let status='transport';
 try{
  const r=await fetch(f.base+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':f.transportSecret,...(drop?{'x-synthetic-drop-response':'true'}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  status=r.status;const body=await r.json();
  assert.ok(allowed.includes(status),`${input.action}: unexpected ${status} ${body.error||''}`);
  return {status,body};
 }catch(e){if(drop&&status==='transport')return {status,body:{}};throw e;}
 finally{active--;current.samples.push(performance.now()-start);current.statuses[status]=(current.statuses[status]||0)+1;}
}
async function batch(tasks,limit=concurrency){tasks=[...tasks];for(let i=tasks.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[tasks[i],tasks[j]]=[tasks[j],tasks[i]];}let next=0;const failures=[];await Promise.all(Array.from({length:Math.min(limit,tasks.length)},async()=>{while(next<tasks.length){const i=next++;try{await tasks[i]();}catch(e){failures.push(e.message);}}}));assert.deepEqual(failures,[]);}
async function scenario(name,work){current={name,samples:[],statuses:{},passed:false};const start=performance.now();try{await work();current.passed=true;}catch(e){current.failure=e.message;throw e;}finally{const sorted=current.samples.sort((a,b)=>a-b),durationMs=performance.now()-start;timings.push(...sorted);const item={name,passed:current.passed,requests:sorted.length,statuses:current.statuses,durationMs:Math.round(durationMs),p50Ms:Math.round(sorted[Math.floor(sorted.length*.5)]||0),p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]||0),maxMs:Math.round(sorted.at(-1)||0),...(current.failure?{failure:current.failure}:{})};report.scenarios.push(item);console.log(JSON.stringify(item));}}
const users=Array.from({length:count},(_,i)=>({sub:`stress-${i}`,application:null,org:null}));
const submission=u=>({action:'submit-application',displayName:`Synthetic Advisor ${u.sub}`,organizationName:`Synthetic Center ${u.sub}`,organizationWebsite:'https://example.test/',jobRole:'Advisor'});
for(const u of users)f.actor(u.sub);
const cmd=(sub,input,options)=>send(sub,api,input,options),inst=(sub,input,options)=>send(sub,institutions,input,options);
try{
 await scenario('duplicate applications across isolated accounts',async()=>{
  await batch(users.flatMap(u=>Array.from({length:4},()=>async()=>{const a=(await cmd(u.sub,submission(u))).body.application;if(u.application)assert.equal(a.id,u.application.id);assert.equal(a.email,`${u.sub}@example.test`);u.application=a;})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_applications')).rows[0].n,count);
 });
 await scenario('organization retries and response lost after commit',async()=>{
  await batch(users.map(u=>async()=>{await inst(u.sub,signupOrganization(u.application,'Synthetic services.',u.application.id,true),{drop:true});}));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,count,'Every dropped response occurred after registration committed');
  await batch(users.flatMap(u=>Array.from({length:3},()=>async()=>{const r=await inst(u.sub,{...signupOrganization(u.application,'Synthetic services.',u.application.id,true),registrationKey:randomUUID()});const id=r.body.registeredInstitutionId;if(u.org)assert.equal(id,u.org);u.org=id;})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,count);
  await batch(users.map(u=>async()=>{const r=await inst(u.sub,{action:'signup-status',applicationId:u.application.id});assert.equal(r.body.organization.id,u.org);}));
 });
 await scenario('submissions, organization verification and independent pilot approval',async()=>{
  await batch(users.flatMap(u=>Array.from({length:2},()=>()=>inst(u.sub,{action:'submit',id:u.org,revision:1}))));
  await batch(users.map(u=>()=>inst('reviewer',{action:'verify',id:u.org,revision:1,note:'Synthetic affiliation check.'})));
  await batch(users.map(u=>()=>cmd('reviewer',{action:'approve-organization',id:u.org})));
 });
 await scenario('competing application decisions commit once',async()=>{
  await batch(users.flatMap(u=>Array.from({length:4},()=>()=>cmd('reviewer',{action:'approve-application',id:u.application.id,institutionId:u.org,reviewNote:'Synthetic independent review.'},{allowed:[200,409]}))));
  assert.equal(current.statuses[200],count);assert.equal(current.statuses[409],count*3);
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_profiles WHERE status='active'")).rows[0].n,count);
 });
 await scenario('workspace reads, rotation contention and account isolation',async()=>{
  await batch(users.flatMap(u=>[()=>cmd(u.sub,{action:'overview'}),async()=>{assert.equal((await cmd(u.sub,{action:'profile',id:u.org})).body.profile.status,'active');},()=>cmd(u.sub,{action:'rotate-code',id:u.org}),()=>inst(u.sub,{action:'signup-status',applicationId:users[(users.indexOf(u)+1)%count].application.id},{allowed:[409]})]));
  await batch(Array.from({length:concurrency},()=>()=>cmd(users[0].sub,{action:'rotate-code',id:users[0].org})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_codes WHERE revoked_at IS NULL')).rows[0].n,count);
 });
 await scenario('stale edits cannot overwrite newer organization changes',async()=>{
  const u=users[0],org=(await inst(u.sub,{action:'signup-status',applicationId:u.application.id})).body.organization;
  await batch(Array.from({length:concurrency},(_,i)=>()=>inst(u.sub,{action:'save',id:u.org,revision:org.revision,page:{...org.page,description:`Correction ${i}`}},{allowed:[200,409]})));
  assert.equal(current.statuses[200],2); // initial read + one winning edit
  assert.equal(current.statuses[409],concurrency-1);
 });
 await scenario('review queue and organization pagination at admitted concurrency two',async()=>{
  const u={sub:'pagination'};f.actor(u.sub);u.application=(await cmd(u.sub,submission(u))).body.application;
  await f.owner.query("INSERT INTO origen_institution_members SELECT id,'pagination','outreach' FROM origen_institutions");
  await batch(Array.from({length:concurrency},()=>async()=>{const r=await cmd('reviewer',{action:'application-organizations',id:u.application.id});assert.equal(r.body.organizations.length,Math.min(51,count));}),2);
  let after='',seen=new Set();do{const list=(await cmd('reviewer',{action:'application-organizations',id:u.application.id,after})).body.organizations;for(const o of list.slice(0,50)){assert.ok(!seen.has(o.id));seen.add(o.id);}after=list.length>50?list[49].id:'';}while(after);assert.equal(seen.size,count);
 });
 await scenario('withdrawal, late registration and stale retries',async()=>{
  const racers=Array.from({length:40},(_,i)=>({sub:`withdraw-${i}`}));for(const u of racers)f.actor(u.sub);
  await batch(racers.map(u=>async()=>{u.application=(await cmd(u.sub,submission(u))).body.application;}));
  await batch(racers.flatMap(u=>[()=>inst(u.sub,signupOrganization(u.application,'Synthetic.',u.application.id,true),{allowed:[200,409]}),()=>cmd(u.sub,{action:'withdraw-application',id:u.application.id})]));
  await batch(racers.map(u=>async()=>{const replacement=(await cmd(u.sub,submission(u))).body.application;assert.notEqual(replacement.id,u.application.id);await cmd(u.sub,{action:'withdraw-application',id:u.application.id},{allowed:[409]});assert.equal((await cmd(u.sub,{action:'application-status'})).body.application.id,replacement.id);}));
 });
 await scenario('pending owner activation races against withdrawal and reapplication',async()=>{
  const u={sub:'pending-owner'};f.actor(u.sub);u.application=(await cmd(u.sub,submission(u))).body.application;
  u.org=(await inst(u.sub,signupOrganization(u.application,'Synthetic.',u.application.id,true))).body.registeredInstitutionId;
  await inst(u.sub,{action:'submit',id:u.org,revision:1});await inst('reviewer',{action:'verify',id:u.org,revision:1,note:'Synthetic.'});await cmd('reviewer',{action:'approve-organization',id:u.org});
  for(let round=0;round<12;round++){
   await batch([()=>cmd(u.sub,{action:'withdraw-application',id:u.application.id}),...Array.from({length:12},()=>()=>cmd(u.sub,{action:'enable-member',id:u.org,subject:u.sub},{allowed:[403]}))]);
   u.application=(await cmd(u.sub,submission(u))).body.application;
  }
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_profiles WHERE auth0_subject=$1 AND status='active'",[u.sub])).rows[0].n,0);
 });
 await scenario('invalid, unverified and non-MFA requests fail closed under load',async()=>{
  f.actor('no-mfa',{mfa:false});f.actor('unverified',{verified:false});
  await batch(Array.from({length:concurrency},()=>async()=>{await cmd('no-mfa',{action:'applications'},{allowed:[403]});await cmd('unverified',submission({sub:'unverified'}),{allowed:[403]});await cmd('applicant',{action:'withdraw-application'},{allowed:[400]});await cmd('applicant',{action:'approve-application',id:randomUUID(),institutionId:users[0].org,reviewNote:'Forged',administrator:true},{allowed:[403]});}),2);
 });
 await scenario('invitation replays and competing review, withdrawal and membership removal',async()=>{
  const owner=users[0],racers=Array.from({length:40},(_,i)=>({sub:`invite-${i}`}));for(const u of racers)f.actor(u.sub);
  await batch(racers.map(u=>async()=>{u.application=(await cmd(u.sub,submission(u))).body.application;u.token=(await inst(owner.sub,{action:'invite',id:owner.org,email:`${u.sub}@example.test`,role:'outreach'})).body.token;}));
  const before=current.statuses[200];
  await batch(racers.flatMap(u=>Array.from({length:5},()=>()=>inst(u.sub,{action:'accept-invite',token:u.token},{allowed:[200,410]}))));
  assert.equal(current.statuses[200]-before,racers.length);assert.equal(current.statuses[410],racers.length*4);
  await batch(racers.flatMap(u=>[
   ()=>cmd('reviewer',{action:'approve-application',id:u.application.id,institutionId:owner.org,reviewNote:'Synthetic.'},{allowed:[200,403,409]}),
   ()=>cmd('reviewer',{action:'decline-application',id:u.application.id,reviewNote:'Synthetic.'},{allowed:[200,409]}),
   ()=>cmd(u.sub,{action:'withdraw-application',id:u.application.id}),
   ()=>inst(owner.sub,{action:'remove-member',id:owner.org,subject:u.sub}),
  ]));
  for(const u of racers){assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_profiles WHERE auth0_subject=$1',[u.sub])).rows[0].n,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institution_members WHERE auth0_subject=$1',[u.sub])).rows[0].n,0);}
 });
 await scenario('suspension wins over code rotation and owner reactivation',async()=>{
  await batch(users.slice(1,41).flatMap(u=>[
   ()=>cmd(u.sub,{action:'rotate-code',id:u.org},{allowed:[200,403]}),
   ()=>cmd('reviewer',{action:'suspend-organization',id:u.org}),
   ()=>cmd(u.sub,{action:'enable-member',id:u.org,subject:u.sub},{allowed:[200,403]}),
  ]));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_profiles p JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id WHERE o.status='suspended' AND p.status='active'")).rows[0].n,0);
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_codes c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id WHERE o.status='suspended' AND c.revoked_at IS NULL")).rows[0].n,0);
 });
 await scenario('identity-provider outage and delayed recovery do not create partial applications',async()=>{
  const delayed=Array.from({length:40},(_,i)=>({sub:`identity-${i}`}));
  for(const u of delayed)f.actor(u.sub,{providerError:true});
  await batch(delayed.map(u=>()=>cmd(u.sub,submission(u),{allowed:[503]})));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_applications WHERE auth0_subject LIKE 'identity-%'")).rows[0].n,0);
  for(const u of delayed)f.actor(u.sub,{providerDelayMs:80+Math.floor(random()*120)});
  await batch(delayed.flatMap(u=>Array.from({length:3},()=>async()=>{const a=(await cmd(u.sub,submission(u))).body.application;if(u.application)assert.equal(u.application.id,a.id);u.application=a;})));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_applications WHERE auth0_subject LIKE 'identity-%'")).rows[0].n,40);
 });
 // No test operation publishes student content or creates student connections.
 for(const table of ['origen_binder_connections','origen_binder_share_grants','origen_binder_publications'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 report.passed=true;
}catch(e){report.failure=e.message;process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();report.peakHttpRequests=peak;report.totalRequests=report.scenarios.reduce((n,s)=>n+s.requests,0);
 timings.sort((a,b)=>a-b);report.latencyMs={p50:Math.round(timings[Math.floor(timings.length*.5)]||0),p95:Math.round(timings[Math.floor(timings.length*.95)]||0),max:Math.round(timings.at(-1)||0)};
 await f.close();await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,totalRequests:report.totalRequests,peakHttpRequests:peak,output}));
}

// Local-only MFA boundary and interrupted-registration stress harness.
// Exercises real handlers, migrations and restricted DB grants. Auth0 is simulated.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {coordinatorRegistrationFixture} from '../server/fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {MFA_TIME_CLAIM as MFA,staffAuthenticationError,staffHash} from '../server/staff-access.mjs';
import {AUTH_TIME_CLAIM as AUTH} from '../server/recent-auth.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const output=option('--output',''),concurrency=Number(option('--concurrency',64)),pool=Number(option('--pool',4));
const url=new URL(process.env.DATABASE_TEST_URL||'');
if(!args.includes('--disposable-database')||!output||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['postgres:','postgresql:'].includes(url.protocol)||!Number.isInteger(concurrency)||concurrency<2||concurrency>120||!Number.isInteger(pool)||pool<2||pool>20)throw Error('Explicit disposable loopback database, new output directory, concurrency 2–120 and pool 2–20 required');
await mkdir(output);
const report={syntheticAuth0:true,realOtpEnrollment:false,concurrency,pool,requests:0,peak:0,scenarios:[],passed:false};
const f=await coordinatorRegistrationFixture({runtimePoolSize:pool,productionTimeouts:true});
const api='/api/coordinator-access',institutions='/api/institutions',users=Array.from({length:48},(_,i)=>({sub:`mfa-${i}`}));
let active=0,current;
const require=createRequire(import.meta.url),challenge=require('../auth0/staff-mfa-action.cjs'),proof=require('../auth0/recent-auth-action.cjs');
async function send(sub,path,input,status=200,error){
 const started=performance.now();active++;report.peak=Math.max(report.peak,active);report.requests++;
 try{
  const response=await fetch(f.base+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':f.transportSecret},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const body=await response.json();current.statuses[response.status]=(current.statuses[response.status]||0)+1;
  assert.equal(response.status,status,`${sub} ${input.action}: ${JSON.stringify(body)}`);
  if(error)assert.equal(body.error,error);return body;
 }finally{active--;current.times.push(performance.now()-started);}
}
const cmd=(sub,input,status,error)=>send(sub,api,input,status,error),inst=(sub,input,status,error)=>send(sub,institutions,input,status,error);
async function batch(tasks){let next=0;const failures=[];await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{while(next<tasks.length){const i=next++;try{await tasks[i]();}catch(e){failures.push(e.message);}}}));assert.deepEqual(failures,[]);}
async function scenario(name,work){current={name,statuses:{},times:[],passed:false};try{await work();current.passed=true;}catch(e){current.failure=e.message;throw e;}finally{const times=current.times.sort((a,b)=>a-b),item={name,passed:current.passed,requests:times.length,statuses:current.statuses,p95Ms:Math.round(times[Math.floor(times.length*.95)]||0),maxMs:Math.round(times.at(-1)||0),...(current.failure?{failure:current.failure}:{})};report.scenarios.push(item);console.log(JSON.stringify(item));}}
try{
 await scenario('Action ordering: enrollment is not proof; only completed MFA grants claims',async()=>{
  const calls=[],claims={},api={authentication:{enrollWith:x=>calls.push(['enroll',x]),challengeWith:x=>calls.push(['challenge',x])},accessToken:{setCustomClaim:(k,v)=>claims[k]=v}};
  const transaction={acr_values:['http://schemas.openid.net/pape/policies/2007/06/multi-factor']};
  await challenge.onExecutePostLogin({transaction:{},user:{}},api);assert.equal(calls.length,0);
  await challenge.onExecutePostLogin({transaction,user:{}},api);assert.equal(calls.at(-1)[0],'enroll');
  const time=new Date().toISOString();
  await proof.onExecutePostLogin({session:{authenticated_at:time},authentication:{methods:[{name:'pwd',timestamp:time}]}},api);assert.equal(claims[MFA],undefined);
  await challenge.onExecutePostLogin({transaction,user:{enrolledFactors:[{type:'otp'}]}},api);assert.equal(calls.at(-1)[0],'challenge');
  await proof.onExecutePostLogin({session:{authenticated_at:time},authentication:{methods:[{name:'mfa',timestamp:time}]}},api);assert.equal(claims[MFA],Math.floor(Date.parse(time)/1000));
  const old=new Date(Date.now()-3600000).toISOString();await proof.onExecutePostLogin({transaction:{protocol:'oauth2-refresh-token'},session:{authenticated_at:old},authentication:{methods:[{name:'mfa',timestamp:old}]}},api);assert.equal(claims[MFA],Math.floor(Date.parse(old)/1000));
  const now=1800000000000,n=now/1000;
  for(const [age,fresh,expected] of [[300,true,null],[301,true,null],[43200,true,null],[43201,true,'staff_mfa_required'],[43200,false,null],[43201,false,'staff_mfa_required']])assert.equal(staffAuthenticationError({[MFA]:n-age,[AUTH]:n-age},{now,fresh}),expected);
 });
 await scenario('first-time applicants can save applications but interrupted MFA cannot register organizations',async()=>{
  for(const u of users)f.actor(u.sub,{mfa:false});
  await batch(users.map(u=>async()=>{u.application=(await cmd(u.sub,{action:'submit-application',displayName:`Synthetic ${u.sub}`,organizationName:`Synthetic Center ${u.sub}`,organizationWebsite:'https://example.test/',jobRole:'Advisor'})).application;u.registration=signupOrganization(u.application,'Synthetic college guidance.',u.application.id,true);}));
  await batch(users.flatMap(u=>Array.from({length:4},()=>async()=>{await inst(u.sub,u.registration,403,'staff_mfa_required');await cmd(u.sub,{action:'overview'},403,'staff_mfa_required');})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,0);
 });
 await scenario('fresh MFA resumes duplicate organization registration once per application',async()=>{
  for(const u of users)f.actor(u.sub);
  await batch(users.flatMap(u=>Array.from({length:3},()=>async()=>{const result=await inst(u.sub,u.registration);if(u.id)assert.equal(u.id,result.registeredInstitutionId);u.id=result.registeredInstitutionId;})));
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,users.length);
  await batch(users.map(u=>()=>inst(u.sub,{action:'submit',id:u.id,revision:1})));
  for(const u of users)f.actor(u.sub,{claims:n=>({[MFA]:n-43201,[AUTH]:n-43201})});
  await batch(users.map(u=>()=>inst(u.sub,{action:'signup-status',applicationId:u.application.id},403,'staff_mfa_required')));
  for(const u of users)f.actor(u.sub);
  await batch(users.map(u=>async()=>{const org=(await inst(u.sub,{action:'signup-status',applicationId:u.application.id})).organization;assert.equal(org.id,u.id);assert.equal(org.status,'submitted');}));
 });
 await scenario('expired reviewer MFA cannot approve; fresh verification recovers independent review',async()=>{
  f.actor('reviewer',{claims:n=>({[MFA]:n-43201})});
  await batch(users.map(u=>()=>inst('reviewer',{action:'verify',id:u.id,revision:1,note:'Synthetic.'},403,'staff_mfa_required')));
  f.actor('reviewer');
  await batch(users.map(u=>()=>inst('reviewer',{action:'verify',id:u.id,revision:1,note:'Synthetic independent review.'})));
  await batch(users.map(u=>()=>cmd('reviewer',{action:'approve-organization',id:u.id})));
  f.actor('reviewer',{claims:n=>({[AUTH]:n-43201})});
  await batch(users.map(u=>()=>cmd('reviewer',{action:'approve-application',id:u.application.id,institutionId:u.id,reviewNote:'Synthetic.'},403,'reauthentication_required')));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_applications WHERE status='approved'")).rows[0].n,0);
  f.actor('reviewer');
  await batch(users.map(u=>()=>cmd('reviewer',{action:'approve-application',id:u.application.id,institutionId:u.id,reviewNote:'Synthetic.'})));
 });
 const cases=[
  ['missing MFA',n=>({[MFA]:undefined}),'staff_mfa_required','staff_mfa_required'],
  ['missing authentication',n=>({[AUTH]:undefined}),'reauthentication_required','reauthentication_required'],
  ['future MFA',n=>({[MFA]:n+3600}),'staff_mfa_required','staff_mfa_required'],
  ['future authentication',n=>({[AUTH]:n+3600}),'reauthentication_required','reauthentication_required'],
  ['string MFA',n=>({[MFA]:String(n)}),'staff_mfa_required','staff_mfa_required'],
  ['null MFA',n=>({[MFA]:null}),'staff_mfa_required','staff_mfa_required'],
  ['zero MFA',n=>({[MFA]:0}),'staff_mfa_required','staff_mfa_required'],
  ['fractional MFA',n=>({[MFA]:n-.5}),'staff_mfa_required','staff_mfa_required'],
  ['fresh token with expired MFA',n=>({[MFA]:n-43201}),'staff_mfa_required','staff_mfa_required'],
  ['fresh MFA with expired login',n=>({[AUTH]:n-43201}),'reauthentication_required','reauthentication_required'],
  ['expired read MFA',n=>({[MFA]:n-43201}),'staff_mfa_required','staff_mfa_required'],
  ['expired read login',n=>({[AUTH]:n-43201}),'reauthentication_required','reauthentication_required'],
  ['amr and user metadata cannot replace signed custom proof',n=>({[MFA]:undefined,amr:['mfa'],user_metadata:{[MFA]:n}}),'staff_mfa_required','staff_mfa_required'],
  ['verification older than five minutes remains valid',n=>({[MFA]:n-3600,[AUTH]:n-3600}),null,null],
  ['fresh completed proof',n=>({}),null,null],
 ];
 for(const [name,claims,readError,writeError] of cases)await scenario(name,async()=>{
  for(const u of users)f.actor(u.sub,{claims});
  const before=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_codes')).rows[0].n;
  await batch(users.flatMap(u=>[
   ()=>cmd(u.sub,{action:'profile',id:u.id},readError?403:200,readError),
   ()=>inst(u.sub,{action:'signup-status',applicationId:u.application.id},readError?403:200,readError),
   ()=>cmd(u.sub,{action:'rotate-code',id:u.id,mfa:true,auth_time:Math.floor(Date.now()/1000)},writeError?403:200,writeError),
  ]));
  const after=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_codes')).rows[0].n;
  assert.equal(after-before,writeError?0:users.length);
 });
 await scenario('blocked and revoked staff tokens stay denied after fresh MFA',async()=>{
  for(const u of users)f.actor(u.sub);
  for(const u of users)await f.owner.query("INSERT INTO origen_staff_access_controls(subject_hash,blocked,token_valid_after) VALUES($1,true,now()-interval '1 hour')",[staffHash(u.sub)]);
  await batch(users.flatMap(u=>[()=>cmd(u.sub,{action:'overview'},403,'staff_access_revoked'),()=>cmd(u.sub,{action:'rotate-code',id:u.id},403,'staff_access_revoked'),()=>inst(u.sub,{action:'signup-status',applicationId:u.application.id},403,'staff_access_revoked')]));
  await f.owner.query("UPDATE origen_staff_access_controls SET blocked=false,token_valid_after=now()-interval '10 minutes'");
  for(const u of users)f.actor(u.sub,{claims:n=>({iat:n-3600})});
  await batch(users.map(u=>()=>cmd(u.sub,{action:'overview'},403,'staff_access_revoked')));
  for(const u of users)f.actor(u.sub);
  await batch(users.map(u=>()=>cmd(u.sub,{action:'overview'})));
 });
 report.passed=true;
}catch(e){report.failure=e.message;process.exitCode=1;}
finally{await f.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,requests:report.requests,peak:report.peak,output}));}

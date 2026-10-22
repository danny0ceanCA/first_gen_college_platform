// Controlled overload against real disposable PostgreSQL and HTTP handlers.
// A temporary test-only audit-table lock holds the two admitted requests so
// overload behavior is repeatable. This is not an unimpeded throughput benchmark.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setTimeout as pause} from 'node:timers/promises';
import {coordinatorRegistrationFixture} from '../server/fixtures/coordinator-registration.mjs';
const args=process.argv.slice(2),output=args[args.indexOf('--output')+1];let url;
try{url=new URL(process.env.DATABASE_TEST_URL);}catch{}
if(!args.includes('--disposable-database')||!args.includes('--output')||!output||!url||!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Use a dedicated loopback DATABASE_TEST_URL, --disposable-database --output <new-report.json>.');
const f=await coordinatorRegistrationFixture({runtimePoolSize:5,productionTimeouts:true});let gate,work=[],released=false;
const release=async()=>{if(gate&&!released){released=true;await gate.query('ROLLBACK');gate.release();}};
try{
 gate=await f.owner.connect();await gate.query('BEGIN');await gate.query('LOCK TABLE origen_privileged_access_audit IN SHARE MODE');
 const completed=[];
 work=Array.from({length:150},()=>{const start=performance.now();return f.request('reviewer','/api/coordinator-access',{action:'applications'}).then(r=>{const result={status:r.status,code:r.body.error||null,durationMs:performance.now()-start};completed.push(result);return result;});});
 const deadline=Date.now()+12000;while(completed.length<148&&Date.now()<deadline)await pause(10);
 assert.equal(completed.length,148,'exactly two requests remain admitted behind the test barrier');assert.ok(completed.every(r=>r.status===429&&r.code==='coordinator_review_busy'));
 await release();const results=await Promise.all(work);assert.equal(results.filter(r=>r.status===200).length,2);assert.equal(results.filter(r=>r.status===503).length,0);
 const recoveryStart=performance.now();assert.equal((await f.request('reviewer','/api/coordinator-access',{action:'applications'})).status,200);
 const shed=results.filter(r=>r.status===429).map(r=>r.durationMs).sort((a,b)=>a-b),p=q=>Math.round(shed[Math.ceil(shed.length*q)-1]);
 const report={kind:'controlled-coordinator-review-overload',generatedAt:new Date().toISOString(),postgres:true,syntheticIdentityProvider:true,requests:150,applicationPool:5,admitted:2,shed:148,unexpected503:0,shedLatencyMs:{p50:p(.5),p95:p(.95),max:Math.round(shed.at(-1))},nextReadMs:Math.round(performance.now()-recoveryStart),passed:true,limitations:'Per-process admission under an artificial database wait. No production/Auth0 traffic, no cross-process quota or demonstrated root cause for historical REVIEW-BURST-001.'};
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{await release();await Promise.allSettled(work);await f.close();}

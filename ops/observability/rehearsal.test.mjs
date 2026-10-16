import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {runRehearsals,diagnose,scenarios} from './rehearsal.mjs';
import {evaluate,shadowTick} from './alerts.mjs';
import {detailedSpansEnabled} from '../../server/observability/collection-policy.mjs';
import {capabilityEnabled} from '../diagnostic-controls.mjs';
import {agentFixture} from '../diagnostic-agent/test-fixture.mjs';
const now=Date.now(),release='a'.repeat(40);
const row=()=>({service:'origen-api',release,coverage:'best_effort',apiRequests:0,apiErrors:0,summaryFailures:0,hangupOldestMs:0,supervisorFailures:0});
const snapshot=()=>({version:1,at:new Date(now).toISOString(),environment:'test',rows:[row()],health:[],syntheticFailures:0,privacyEscapes:0,dropWindow:null,baseline:null});
test('eleven synthetic faults produce bounded private evidence and honest diagnoses',async()=>{const result=await runRehearsals();assert.equal(result.results.length,11);assert.equal(result.correctDiagnoses,11);assert.equal(result.unknownConclusions,1);assert.equal(result.costUsd,0);assert.ok(result.bytes<65536);assert.equal(scenarios.every(s=>s.recovery&&s.cleanup),true);assert.equal(diagnose([]),'unknown');assert.equal(diagnose([{event:'summary.generate.finished',outcome:'completed'}]),'unknown');assert.equal(diagnose([{event:'api_request',httpStatus:200}]),'unknown');});
test('alerts enforce sample counts, server save failures, hangup thresholds and independent health',()=>{
 let s=snapshot();s.rows[0].apiRequests=19;s.rows[0].apiErrors=19;assert.equal(evaluate(s,now).length,0);s.rows[0].apiRequests=20;assert.equal(evaluate(s,now)[0].family,'api-errors');
 s=snapshot();s.rows[0].summaryFailures=2;assert.equal(evaluate(s,now).length,0);s.rows[0].summaryFailures=3;assert.equal(evaluate(s,now)[0].family,'summary-persistence');
 s=snapshot();s.rows[0].hangupOldestMs=30001;assert.equal(evaluate(s,now)[0].family,'permission-termination');
 s=snapshot();s.health=['canary_stale','expiry_stale','erasure_backlog'];assert.deepEqual(evaluate(s,now).map(r=>r.family),['telemetry-pipeline','expiry-deletion']);
 s=snapshot();s.syntheticFailures=3;s.privacyEscapes=1;assert.equal(evaluate(s,now).at(-1).action,'disable_affected_path');
 s=snapshot();s.dropWindow={durationMs:300000,accepted:980,dropped:20};assert.equal(evaluate(s,now)[0].family,'telemetry-pipeline');s.dropWindow.durationMs=299999;assert.equal(evaluate(s,now).length,0);
});
test('shadow incidents deduplicate per release/family, resolve and reopen; gaps reset seven day review',()=>{
 const s=snapshot();s.rows[0].summaryFailures=3;const first=shadowTick(s,undefined,now);assert.equal(first.alerts.length,1);assert.equal(first.alerts[0].mode,'shadow');assert.equal(first.shadowReviewDue,false);
 s.at=new Date(now+60000).toISOString();const second=shadowTick(s,first.state,now+60000);assert.equal(second.alerts.length,0);assert.equal(second.state.incidents[0].id,first.alerts[0].incidentId);assert.throws(()=>shadowTick(s,second.state,now+60000));
 s.rows[0].summaryFailures=0;s.at=new Date(now+120000).toISOString();const resolved=shadowTick(s,second.state,now+120000);assert.equal(resolved.resolved.length,1);
 s.rows[0].summaryFailures=3;s.rows[0].release='b'.repeat(40);s.at=new Date(now+240001).toISOString();const reopened=shadowTick(s,resolved.state,now+240001);assert.equal(reopened.state.observations,1);assert.notEqual(reopened.alerts[0].incidentId,first.alerts[0].incidentId);
});
test('malformed snapshots, private fields, future time and false baseline regressions are rejected',()=>{
 const s=snapshot();assert.throws(()=>evaluate({...s,transcript:'private'},now));assert.throws(()=>evaluate({...s,at:new Date(now+100000).toISOString()},now));assert.throws(()=>evaluate({...s,rows:[{...s.rows[0],userId:'private'}]},now));
 s.baseline={release:'b'.repeat(40),requests:1000,errors:1};Object.assign(s.rows[0],{apiRequests:1000,apiErrors:200,coverage:'complete'});assert.ok(evaluate(s,now).some(r=>r.family==='release-regression'));s.rows[0].coverage='best_effort';assert.ok(!evaluate(s,now).some(r=>r.family==='release-regression'));
});
test('independent live switches fail closed and agent revocation erases context without altering audit',async()=>{
 const parent=await realpath(tmpdir()),root=await mkdtemp(join(parent,'origen-phase8-')),file=join(root,'agent.json'),runner=join(root,'runner.json');const f=await agentFixture();
 try{
  const enabled=path=>writeFile(path,JSON.stringify({version:1,enabled:true,expiresAt:new Date(Date.now()+60000).toISOString()}));assert.equal(capabilityEnabled(file),false);await enabled(file);await enabled(runner);assert.equal(capabilityEnabled(file),true);
  const {startInvestigation}=await import('../diagnostic-agent/broker.mjs');const b=await startInvestigation({...f.options,enabled:()=>capabilityEnabled(file)});
  await writeFile(file,JSON.stringify({version:1,enabled:false,expiresAt:new Date(Date.now()+60000).toISOString()}));await b.poll();assert.equal(b.signal.aborted,true);assert.equal(b.stats().contextEntries,0);assert.equal(capabilityEnabled(runner),true);assert.ok(f.state.audits.length>0);await b.close();
  await enabled(file);assert.equal(capabilityEnabled(file,Date.now()+120000),false);
 }finally{await f.close();const path=await realpath(root);assert.equal(dirname(path),parent);assert.ok(path.includes('origen-phase8-'));await rm(path,{recursive:true,force:true});}
});
test('expanded sampling requires explicit bounded start and expiry and automatically expires',()=>{const env={OBSERVABILITY_DETAILED_SPANS:'true',OBSERVABILITY_DETAIL_STARTED_AT:new Date(now-1000).toISOString(),OBSERVABILITY_DETAIL_EXPIRES_AT:new Date(now+60000).toISOString()};assert.equal(detailedSpansEnabled(env,now),true);assert.equal(detailedSpansEnabled(env,now+60001),false);assert.equal(detailedSpansEnabled({OBSERVABILITY_DETAILED_SPANS:'true'},now),false);assert.equal(detailedSpansEnabled({...env,OBSERVABILITY_DETAIL_EXPIRES_AT:new Date(now+7200000).toISOString()},now),false);});
test('seven days of actual minute observations is a review gate, never automatic paging',()=>{let state,result;const s=snapshot();for(let i=0;i<=10080;i++){const at=now+i*60000;s.at=new Date(at).toISOString();result=shadowTick(s,state,at);state=result.state;if(i<10080)assert.equal(result.shadowReviewDue,false);}assert.equal(result.shadowReviewDue,true);assert.equal(result.alerts.length,0);});
test('gateway switch rejects machine reads including late results while leaving revocation available',async()=>{
 const {createGatewayHandler}=await import('../diagnostics-gateway/service.mjs');const {Readable}=await import('node:stream');let on=true,called=0;
 const handler=createGatewayHandler({authenticate:async()=>({sub:'synthetic-machine',permissions:['observability:investigate']}),machineSubjects:['synthetic-machine'],machineEnabled:()=>on,investigator:{evidence:async()=>{called++;on=false;return {synthetic:true};},revoke:async()=>{called++;}}});
 async function request(url){const req=Object.assign(Readable.from([JSON.stringify({capability:'synthetic'})]),{socket:{encrypted:true},method:'POST',url,headers:{authorization:'Bearer synthetic','content-type':'application/json'}});const res={writeHead(status){this.status=status;},end(body){this.body=body;}};await handler(req,res);return res;}
 assert.equal((await request('/v1/evidence')).status,403);assert.equal(called,1);assert.equal((await request('/v1/evidence')).status,403);assert.equal(called,1);assert.equal((await request('/v1/revoke')).status,200);assert.equal(called,2);
});

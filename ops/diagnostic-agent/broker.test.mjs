import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentFixture} from './test-fixture.mjs';
import {startInvestigation} from './broker.mjs';
import {syntheticDiagnosis} from './demo.mjs';
import {createProtocol} from './protocol.mjs';
import {runAgent} from './agent.mjs';
import {fail} from './contracts.mjs';
test('seeded synthetic failure yields an uncertain sourced diagnosis without claiming a fix',async()=>{const result=await syntheticDiagnosis();assert.equal(result.report.suspectedFailure,'storage-failure');assert.equal(result.report.observedEvents.length,1);assert.equal(result.report.uncertainty,'medium');assert.doesNotMatch(JSON.stringify(result),/fixed|repaired/i);});
test('all fixed tools enforce scope, validate references and leave independent intent/completion receipts',async()=>{
 const f=await agentFixture();try{const b=await f.start();await assert.rejects(startInvestigation(f.options),{safeCode:'investigation_busy'});
  assert.equal((await b.call('get_incident',{})).data.caseId,f.scope.id);
  await assert.rejects(b.call('get_timeline',{operationId:randomUUID()}),{safeCode:'scope_denied'});await assert.rejects(b.call('get_request',{requestId:randomUUID()}),{safeCode:'scope_denied'});
  const timeline=await b.call('get_timeline',{operationId:f.scope.operations[0]});assert.equal(timeline.data.verifiedFacts.length,2);
  assert.equal((await b.call('get_request',{requestId:f.requestId})).data.verifiedFacts.length,2);
  assert.equal((await b.call('get_metrics',{metricSet:'provider'})).data.aggregateMetrics.population,'service_environment');
  assert.equal((await b.call('get_release',{revision:f.revision})).data.lockDigest,'b'.repeat(64));
  assert.match((await b.call('get_runbook',{name:'summary-save'})).data.text,/Synthetic/);
  assert.equal((await b.call('read_source',{revision:f.revision,path:'server/summary.mjs'})).data.instructions,'untrusted_data');
  assert.equal((await b.call('propose_reproduction',{scenario:'summary-save-failure',testProfile:'voice-summary'})).data.execution,'not_authorized');
  const completed=f.state.audits.filter(a=>a.phase==='completion');assert.ok(completed.length>=10);for(const row of completed)assert.ok(f.state.audits.some(a=>a.callId===row.callId&&a.phase==='intent'));
  assert.doesNotMatch(JSON.stringify(f.state.audits),/summary\.mjs|Synthetic|operationId|text|arguments|prompt/);
 }finally{await f.close();}
});
test('audit failure prevents access and completion failure withholds output and clears context',async()=>{
 const f=await agentFixture();try{f.state.auditDown=true;await assert.rejects(f.start());assert.equal(f.state.fetches,0);f.state.auditDown=false;const b=await f.start();const before=f.state.fetches;f.state.auditDown=true;await assert.rejects(b.call('get_timeline',{operationId:f.scope.operations[0]}),{safeCode:'diagnostics_unavailable'});assert.equal(f.state.fetches,before);assert.equal(b.stats().contextEntries,0);}finally{await f.close();}
 const g=await agentFixture();try{const b=await g.start();g.state.completionDown=true;await assert.rejects(b.call('get_incident',{}),{safeCode:'diagnostics_unavailable'});assert.equal(b.stats().status,'revoked');assert.equal(g.state.reports.size,0);}finally{await g.close();}
});
test('call, time and cumulative byte budgets stop with a partial report and no extra agent',async()=>{
 for(const budget of ['calls','time','bytes']){const f=await agentFixture({...(budget==='bytes'?{sourceText:'// synthetic\n'+' '.repeat(15000)}:{})});try{const b=await f.start();if(budget==='time'){f.state.now+=600001;await b.poll();}else if(budget==='calls'){for(let i=0;i<29;i++)await b.call('get_incident',{});await assert.rejects(b.call('get_incident',{}),{safeCode:'budget_exhausted'});}else{
   for(let i=0;i<29&&b.stats().status==='running';i++){try{await b.call('read_source',{revision:f.revision,path:'server/summary.mjs'});}catch(error){assert.equal(error.safeCode,'budget_exhausted');}}assert.ok(b.stats().bytes>131072-20480);assert.ok(b.stats().calls<30);}
  if(b.stats().status==='running')await assert.rejects(b.call('get_incident',{}));assert.equal(b.stats().status,'partial');assert.equal(b.signal.aborted,true);const report=await b.getReport();assert.equal(report.report.status,'partial');assert.ok(report.report.missingEvidence.includes('budget-exhausted'));assert.equal(b.stats().contextEntries,0);
 }finally{await f.close();}}
});
test('revocation invalidates pending results, reports and model context; protocol cannot expose new capabilities',async()=>{
 const f=await agentFixture();try{const b=await f.start(),rpc=createProtocol(b);assert.equal((await rpc({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})).result.tools.length,8);assert.equal((await rpc({jsonrpc:'2.0',id:2,method:'shell',params:{command:'whoami'}})).error.message,'protocol_denied');f.state.revoked=true;await b.poll();assert.equal(b.signal.aborted,true);assert.equal(b.stats().contextEntries,0);await assert.rejects(b.call('get_incident',{}));}finally{await f.close();}
});
test('revocation while evidence or a model adapter is pending aborts the run and releases no result',async()=>{
 const f=await agentFixture();try{const b=await f.start();let release,entered;const started=new Promise(r=>{entered=r;});f.options.gateway.evidence=async()=>{entered();return new Promise(r=>{release=r;});};const pending=b.call('get_timeline',{operationId:f.scope.operations[0]});await started;f.state.revoked=true;await b.poll();const rejection=assert.rejects(pending);release(f.makePacket({kind:'timeline',operationId:f.scope.operations[0]}));await rejection;assert.equal(b.stats().contextEntries,0);}finally{await f.close();}
 const g=await agentFixture();try{const b=await g.start();let release,entered,context;const started=new Promise(r=>{entered=r;});const pending=runAgent(b,async input=>{context=input.context;entered();return new Promise(r=>{release=r;});});await started;g.state.revoked=true;await b.poll();await assert.rejects(pending);assert.equal(context.length,0);release({type:'tool',name:'get_incident',arguments:{}});await Promise.resolve();}finally{await g.close();}
});
test('oversized initial evidence produces a partial report without sending the packet to a model',async()=>{
 const f=await agentFixture();try{f.options.gateway.evidence=async()=>{throw fail('budget_exhausted');};const b=await f.start();assert.equal(b.stats().status,'partial');assert.equal((await b.getReport()).report.suspectedFailure,'insufficient-evidence');}finally{await f.close();}
});

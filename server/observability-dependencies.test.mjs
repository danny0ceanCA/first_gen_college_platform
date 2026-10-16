import test from 'node:test';
import assert from 'node:assert/strict';
import {providerOperation,databaseOperation,detectStaleAttempts,sampledOperation} from './observability/dependencies.mjs';
import {createDiagnosticContext} from './observability/context.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
import {createMetrics} from './observability/metrics.mjs';
import {permissionFetch} from './permission-execution.mjs';
import {permissionContext} from './permission-context.mjs';

const capture=()=>{const events=[];return {events,log:(event,context)=>events.push(diagnosticRecord(event,context))};};
test('provider headers and bodies are separate, usage is normalized, and private values never cross the boundary',async()=>{
 const c=capture(),signal=AbortSignal.timeout(1000);let received;
 const request=providerOperation('summary.generate',async(url,options)=>{received={url,options};return new Response(JSON.stringify({usage:{input_tokens:12,output_tokens:3,total_tokens:15,private:'PRIVATE'},output:'PRIVATE'}));},{model:'private model name',...c});
 const response=await request('https://private.invalid/student?secret=PRIVATE',{signal,body:'PRIVATE'});
 assert.equal(c.events.length,0);assert.equal(received.options.signal,signal);
 await response.json();const event=c.events.find(e=>e.event==='provider.operation.finished');
 assert.equal(event.outcome,'completed');assert.equal(event.model,'other');assert.equal(event.inputTokens,12);assert.equal(event.usageState,'reported');assert.ok(event.requestMs>=0&&event.bodyMs>=0);
 assert.ok(!JSON.stringify(c.events).includes('PRIVATE'));assert.ok(!JSON.stringify(c.events).includes('private.invalid'));
});
test('provider failures, cancellation, timeout and missing usage have one honest terminal outcome',async()=>{
 for(const status of [429,500,503]){const c=capture();await providerOperation('finance.lookup',async()=>new Response('PRIVATE',{status}),c)('secret',{});assert.equal(c.events.filter(e=>e.event==='provider.operation.finished').length,1);assert.equal(c.events[0].httpStatus,status);assert.equal(c.events[0].outcome,'failed');}
 for(const name of ['TimeoutError','AbortError']){const c=capture();await assert.rejects(providerOperation('voice.negotiate',async()=>{throw Object.assign(new Error('PRIVATE'),{name});},c)('secret',{}));assert.equal(c.events[0].code,name==='TimeoutError'?'timeout':'aborted');}
 const c=capture(),response=await providerOperation('summary.review',async()=>new Response('{}'),c)('secret',{});await response.json();assert.equal(c.events[0].usageState,'unknown');assert.equal(c.events[0].inputTokens,undefined);
 const silent=await providerOperation('summary.review',async()=>new Response('{}'),{log:()=>{throw Error('sink down');}})('secret',{});assert.deepEqual(await silent.json(),{});
});
test('permission revocation after headers still rejects the body and is recorded as body-stage failure',async()=>{
 let allowed=true;const db={query:async()=>({rows:[{status:allowed?'adult':'revoked',revision:1}]})};
 const c=capture();await permissionContext.run({subject:'PRIVATE',revision:1,signal:new AbortController().signal},async()=>{
  const guarded=permissionFetch(db,{},async()=>new Response('{}'));
  const response=await providerOperation('summary.generate',guarded,c)('https://api.openai.com/v1/responses',{});allowed=false;
  await assert.rejects(response.json(),e=>e.status===403);
 });
 assert.equal(c.events[0].outcome,'failed');assert.equal(c.events[0].failureStage,'body');assert.equal(c.events[0].code,'permission_required');assert.ok(!JSON.stringify(c.events).includes('PRIVATE'));
});
test('database acquisition, execution and commit failures stay distinct and release exactly once',async()=>{
 const c=capture();await assert.rejects(databaseOperation({connect:async()=>{throw Object.assign(Error('SQL PRIVATE'),{code:'53300'});}},'history.save',c));assert.equal(c.events[0].code,'postgres_53300');assert.ok(c.events[0].acquireMs>=0);
 let released=0;const d=capture(),client=await databaseOperation({connect:async()=>({query:async sql=>{if(sql==='COMMIT')throw Object.assign(Error('SQL PRIVATE'),{code:'40001'});return {rowCount:2};},release(){released++;}})},'notes.save',d);
 await client.query('BEGIN');await client.query('SELECT PRIVATE');await assert.rejects(client.query('COMMIT'));await client.query('ROLLBACK');client.release();client.release();assert.equal(released,1);assert.equal(d.events[0].outcome,'failed');assert.equal(d.events[0].code,'postgres_40001');assert.ok(d.events[0].commitMs>=0);assert.ok(!JSON.stringify(d.events).includes('PRIVATE'));
});
test('stale bodies become unknown once; sampling and metric labels cannot be chosen by callers',async()=>{
 const c=capture();const response=await providerOperation('summary.generate',async()=>new Response('{}'),c)('secret',{});
 assert.ok(detectStaleAttempts(Date.now()+600000)>=1);await response.json();assert.equal(c.events.filter(e=>e.event==='provider.operation.finished').length,1);assert.equal(c.events[0].outcome,'unknown');
 const ctx=createDiagnosticContext().snapshot();assert.equal(sampledOperation(ctx),sampledOperation(ctx));
 const m=createMetrics();for(let i=0;i<2000;i++)m.observe('api',`PRIVATE-${i}`,'failed',1);assert.equal(m.snapshot().series.length,0);m.observe('api','api.chat','failed',251);assert.equal(m.snapshot().series[0].buckets[3],1);
});

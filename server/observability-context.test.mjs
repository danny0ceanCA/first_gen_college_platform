import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDiagnosticContext,currentDiagnosticContext,withDiagnosticSpan,runDiagnosticJob} from './observability/context.mjs';
import {instrumentRequest} from './api-logging.mjs';
import {createMetadata} from './observability/event-schema.mjs';
import {runAsAccount} from './account-isolation.mjs';
import {permissionContext} from './permission-context.mjs';
import {createDiagnosticHints,responseReference} from '../src/diagnosticClient.mjs';
import {createBrowserPrivacy} from '../src/browserPrivacy.mjs';

test('parallel requests and child spans preserve separate frozen snapshots and permission context',async()=>{
 const a=createDiagnosticContext({requestId:'a'}),b=createDiagnosticContext({requestId:'b'});
 await Promise.all([a,b].map((ctx,i)=>runAsAccount({sub:String(i)},()=>permissionContext.run({subject:String(i)},()=>ctx.run(async()=>{
  const root=currentDiagnosticContext();assert.ok(Object.isFrozen(root));
  await withDiagnosticSpan(async()=>{await new Promise(r=>setTimeout(r,5));const child=currentDiagnosticContext();assert.equal(child.requestId,root.requestId);assert.equal(child.traceId,root.traceId);assert.notEqual(child.spanId,root.spanId);assert.equal(child.parentSpanId,root.spanId);assert.equal(permissionContext.getStore().subject,String(i));});
  assert.equal(currentDiagnosticContext(),root);
  await runDiagnosticJob(()=>assert.notEqual(currentDiagnosticContext().traceId,root.traceId));
 })))));
 assert.equal(currentDiagnosticContext(),undefined);
});

test('finish/close callbacks retain request snapshots after async storage has exited',async()=>{
 const logs=[],metadata=createMetadata({NODE_ENV:'test'});
 const fixtures=Array.from({length:2},()=>{
  const res=Object.assign(new EventEmitter(),{statusCode:200,setHeader(){},end(){},writableFinished:true});const req={url:'/api/family',method:'POST'};
  const context=instrumentRequest(req,res,r=>logs.push(r),()=>{},metadata);return {req,res,context};
 });
 await Promise.all(fixtures.map(f=>f.context.run(async()=>{await Promise.resolve();f.req.log({event:'database_error'});}))) ;
 for(const f of fixtures){f.res.emit('finish');f.res.emit('close');}
 assert.equal(logs.length,4);for(const f of fixtures){const related=logs.filter(r=>r.requestId===f.req.requestId);assert.equal(related.length,2);assert.equal(related[0].traceId,related[1].traceId);}
});

test('browser hints are stable only within an operation, student and private session',()=>{
 const privacy=createBrowserPrivacy(),hint=createDiagnosticHints(privacy);privacy.start('first',{fresh:true});
 const a=hint('summary','a','same');assert.equal(hint('summary','a','same'),a);assert.notEqual(hint('summary','b','same'),a);assert.notEqual(hint('notes','a','same'),a);
 privacy.forget({studentId:'a'});assert.notEqual(hint('summary','a','same'),a);
 privacy.stop();privacy.start('second',{fresh:true});assert.notEqual(hint('summary','a','same'),a);
 assert.equal(responseReference(new Response(null,{headers:{'X-Request-ID':'private-user-name'}})),undefined);privacy.destroy();
});

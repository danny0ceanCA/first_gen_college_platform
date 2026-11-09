import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {diagnosticRecord,clientDiagnosticRecord,createMetadata,MAX_EVENT_BYTES} from './observability/event-schema.mjs';
import {serverEvents,clientEvents} from './observability/event-catalog.mjs';
import {safeErrorCode} from './observability/error-codes.mjs';
import {loggingPolicyIssues,checkLoggingPolicy} from '../scripts/check-logging-policy.mjs';

test('all events construct bounded immutable envelopes and never copy caller identifiers or metadata',()=>{
 const canaries=['Private_Family_Story','sk-private-secret','eyJprivate.token.secret','private@example.com','SELECT private_value','unsafe\nvalue'];
 for(const event of [...Object.keys(serverEvents),...clientEvents])for(const secret of canaries){
  const input={event,eventId:secret,time:secret,requestId:secret,operationId:secret,sessionId:secret,attemptId:secret,responseId:secret,callId:secret,upstreamRequestId:secret,instanceId:secret,release:secret,producer:secret,evidence:secret,endpoint:secret,method:secret,code:secret,reason:secret,operation:secret,parameter:secret,status:secret,mode:secret,language:secret,connectionState:secret,level:secret,transcript:secret,profile:{name:secret},message:secret,stack:secret,metadata:{secret},durationMs:Infinity};
  const record=diagnosticRecord(input);
  assert.ok(Object.isFrozen(record));assert.ok(Buffer.byteLength(JSON.stringify(record))<=MAX_EVENT_BYTES);
  assert.ok(!JSON.stringify(record).includes(secret),event);
  assert.equal(record.schemaVersion,1);assert.match(record.eventId,/^[a-f0-9-]{36}$/);
  assert.equal(record.requestId,undefined);assert.equal(record.sessionId,undefined);
  if(serverEvents[event])assert.ok(!JSON.stringify(diagnosticRecord({...Object.fromEntries(serverEvents[event].fields.map(key=>[key,secret])),event})).includes(secret),event);
 }
});

test('browser provenance cannot be forged and syntactically valid UUIDs are excluded',()=>{
 const id=randomUUID(),client=clientDiagnosticRecord({event:'api_error',code:'network_error',eventId:id,sessionId:id,attemptId:id,callId:id,requestId:id,producer:'server',level:'error',release:'a'.repeat(40)});
 const out=diagnosticRecord(client,{requestId:randomUUID(),endpoint:'api.voice-diagnostics',method:'POST'});
 assert.equal(out.producer,'browser');assert.equal(out.evidence,'client_reported');assert.equal(out.sessionId,undefined);assert.notEqual(out.eventId,id);
 assert.equal(diagnosticRecord({event:'database_error',producer:'browser'}).producer,'server');
 assert.equal(diagnosticRecord(clientDiagnosticRecord({event:'service.started'})).event,'unknown_client_event');
 assert.equal(out.endpoint,'api.voice-diagnostics');assert.equal(out.method,'POST');
 assert.equal(out.level,'warn');assert.equal(clientDiagnosticRecord({event:'api_error',code:'postgres_53300'}).code,'other');
});

test('unknown data, prototypes and accessors cannot execute or expand the schema',()=>{
 let calls=0;const input=Object.create({event:'database_error',code:'private'});
 Object.defineProperty(input,'event',{get(){calls++;return 'api_error';}});
 assert.equal(diagnosticRecord(input).event,'diagnostic_rejected');assert.equal(calls,0);
 const polluted=JSON.parse('{"event":"api_request","__proto__":{"secret":"private"},"durationMs":1e100,"httpStatus":700,"code":"private"}');
 const result=diagnosticRecord(polluted);assert.equal(result.durationMs,600000);assert.equal(result.httpStatus,undefined);assert.equal(result.code,'other');assert.equal(result.secret,undefined);
 assert.equal(diagnosticRecord({event:{toString(){throw new Error('must not run');}}}).event,'diagnostic_rejected');
 for(const data of [null,[],false,42,'private'])assert.equal(diagnosticRecord(data).event,'diagnostic_rejected');
 for(const v of [NaN,Infinity,-1])assert.equal(diagnosticRecord({event:'api_request',durationMs:v}).durationMs,undefined);
 assert.equal(safeErrorCode({code:'1NAME',message:'private'}),'operation_failed');assert.equal(safeErrorCode({code:'53300'}),'postgres_53300');
});

test('metadata is validated configuration and severity belongs to the catalog',()=>{
 const metadata=createMetadata({NODE_ENV:'test',APPLICATION_REVISION:'a'.repeat(40)});
 const out=diagnosticRecord({event:'database_error',level:'info'},{metadata});assert.equal(out.release,'a'.repeat(40));assert.equal(out.environment,'test');assert.equal(out.level,'error');
 const bad=createMetadata({NODE_ENV:'private-user',APPLICATION_REVISION:'password=private'});assert.equal(bad.release,'unknown');assert.equal(bad.environment,'development');
 assert.equal(diagnosticRecord({event:'api_request',level:'info',httpStatus:503}).level,'error');
 // A forged metadata object must fall back to trusted environment metadata.
 // CI supplies GITHUB_SHA, so that trusted default need not be "unknown".
 assert.equal(diagnosticRecord({event:'database_error'},{metadata:{release:'private'}}).release,createMetadata().release);
});

test('CI rejects console aliases and raw error serialization in HTTP code',async()=>{
 for(const code of ['console.error(error)','const log=console.log;log(error)',"globalThis['console']['log'](error)",'JSON.stringify(error)','process.stdout.write(request.body)'])assert.ok(loggingPolicyIssues(code,'server/example.mjs').length,code);
 assert.deepEqual(loggingPolicyIssues('JSON.stringify({error:"operation_failed"})','server/example.mjs'),[]);
 assert.deepEqual(await checkLoggingPolicy(),[]);
});

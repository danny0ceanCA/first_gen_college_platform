import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer,request as httpsRequest} from 'node:https';
import {once} from 'node:events';
import {createExporter,exportConfiguration} from '../../server/observability/exporter.mjs';
import {diagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
import {createLogger} from '../../server/observability/logger.mjs';
import {createVolumeGate} from '../../server/observability/volume.mjs';
import {validateWireEvent} from '../../server/observability/wire.mjs';
import {createIngest} from './ingest.mjs';
import {telemetryPool,assertServiceIsolation,separateDatabases} from './config.mjs';
const metadata=createMetadata({NODE_ENV:'test'}),token='a'.repeat(48),url='https://telemetry.example/v1/batch';
const record=(failed=false)=>diagnosticRecord({event:'summary.save.finished',outcome:failed?'failed':'completed'},{metadata});
const settled=()=>new Promise(resolve=>setTimeout(resolve,10));
test('export is opt-in, requires verified HTTPS and lifecycle readiness, and wire validation rejects hidden fields',()=>{
 assert.equal(exportConfiguration({}),null);assert.throws(()=>exportConfiguration({OBSERVABILITY_EXPORT:'true',OBSERVABILITY_INGEST_URL:'http://telemetry.example/v1/batch'}));assert.throws(()=>createExporter({url:'http://telemetry.example/v1/batch',token}));
 const good=record();assert.equal(validateWireEvent(good).eventId,good.eventId);for(const input of [{...good,message:'PRIVATE'},{...good,schemaVersion:2},{...good,level:'warn'}])assert.throws(()=>validateWireEvent(input));
 let config;class Pool{constructor(options){config=options;}on(){}}
 telemetryPool({TELEMETRY_DATABASE_URL:'postgresql://writer@telemetry.example/logs?sslmode=disable'},'TELEMETRY_DATABASE_URL',Pool);assert.equal(config.ssl.rejectUnauthorized,true);assert.ok(!config.connectionString.includes('sslmode'));
 assert.throws(()=>assertServiceIsolation({OPENAI_API_KEY:'PRIVATE'}));assert.throws(()=>separateDatabases({A:'postgres://one@localhost/same',B:'postgres://two@localhost/same'},['A','B']));
});
test('queue reserves 500 priority slots, evicts oldest low priority first and bounds bytes under an indefinitely stalled transport',async()=>{
 let calls=0;const exporter=createExporter({url,token,request:()=>{calls++;return new Promise(()=>{});},autoStart:false});
 for(let i=0;i<1700;i++)exporter.enqueue(record());assert.equal(exporter.stats().pending,1500);
 for(let i=0;i<500;i++)exporter.enqueue(record(true));assert.equal(exporter.stats().pending,2000);assert.ok(exporter.stats().queuedBytes<=4194304);
 exporter.pump();assert.equal(exporter.stats().inFlight,2);for(let i=0;i<500;i++)exporter.enqueue(record(true));assert.ok(exporter.stats().pending<=2000);assert.equal(exporter.stats().inFlight,2);await new Promise(resolve=>setTimeout(resolve,2050));assert.equal(exporter.stats().timeouts,2);exporter.pump();assert.equal(calls,2);await exporter.close();
});
test('batches never exceed count/bytes limits and partial stdout failure does not prevent central delivery',async()=>{
 const batches=[],exporter=createExporter({url,token,autoStart:false,request:async(_,options)=>{assert.equal(options.redirect,'error');assert.ok(Buffer.byteLength(options.body)<=262144);const body=JSON.parse(options.body);assert.ok(body.events.length+body.metrics.length<=100);batches.push(body);return new Response(null,{status:202});}});
 const logger=createLogger({env:{NODE_ENV:'test'},sink:()=>{throw Error('PRIVATE SINK');},exporter});const original=logger({event:'summary.save.finished',outcome:'completed'});await logger.flush();assert.equal(batches[0].events[0].eventId,original.eventId);assert.deepEqual(batches[0].events[0],original);assert.equal(exporter.stats().delivered,1);await exporter.close();
});
test('transient retries honor Retry-After, remain bounded and authentication failures are not retried',async()=>{
 let now=0,calls=0;const exporter=createExporter({url,token,autoStart:false,clock:()=>now,random:()=>0,request:async()=>{calls++;return new Response(null,{status:503,headers:{'Retry-After':'2'}});}});exporter.enqueue(record());exporter.pump();await settled();assert.equal(calls,1);now=1999;exporter.pump();await settled();assert.equal(calls,1);for(let i=0;i<5;i++){now+=2001;exporter.pump();await settled();}assert.equal(calls,5);assert.equal(exporter.stats().pending,0);assert.equal(exporter.stats().reasons.retry_exhausted,1);await exporter.close();
 let unauthorized=0;const denied=createExporter({url,token,autoStart:false,request:async()=>{unauthorized++;return new Response(null,{status:401});}});denied.enqueue(record());denied.pump();await settled();denied.pump();assert.equal(unauthorized,1);assert.equal(denied.stats().reasons.authentication,1);await denied.close();
});
test('expired queued events, invalid data, process-local loss and unmapped request filtering are explicit',async()=>{
 let now=0;const exporter=createExporter({url,token,clock:()=>now,autoStart:false,request:async()=>new Response(null,{status:202})});exporter.enqueue(record());now=30001;exporter.pump();assert.equal(exporter.stats().reasons.retry_exhausted,1);assert.equal(exporter.enqueue({...record(),private:'PRIVATE'}),false);
 const requestOnly=diagnosticRecord({event:'api_request',httpStatus:401},{metadata,requestId:crypto.randomUUID()});assert.equal(exporter.enqueue(requestOnly),false);assert.equal(exporter.stats().filtered,1);await exporter.close();
 const restarted=createExporter({url,token,autoStart:false});assert.equal(restarted.stats().pending,0);await restarted.close();
});
test('stdout volume has a hard cap, bounded failure aggregation and a reserved health budget',()=>{
 let now=0;const gate=createVolumeGate({clock:()=>now});let allowed=0;for(let i=0;i<10000;i++)if(gate.accept({event:'api_error',level:'error',endpoint:'api.chat',code:'timeout'}))allowed++;
 assert.equal(allowed,2900);let health=0;for(let i=0;i<200;i++)if(gate.accept({event:'telemetry.canary'}))health++;assert.equal(health,100);now=60000;const aggregate=gate.drain();assert.equal(aggregate.length,1);assert.equal(aggregate[0].occurrenceCount,7100);assert.ok(!Object.hasOwn(aggregate[0],'requestId'));
});
test('real HTTPS certificate errors do not fall back to plaintext or reveal response content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-telemetry-tls-'));let server;
 try{
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const result=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});assert.equal(result.status,0,'OpenSSL is required for this synthetic TLS boundary test');
  let writes=0;const pool={query:async sql=>sql.includes('telemetry_health')?{rows:[{ready:true,ledger_generation:'0'}]}:(writes++,{rows:[]})},ledger={query:async()=>({rows:[{generation:'0'}]})};
  const cert=await readFile(join(directory,'cert.pem'));
  server=createServer({key:await readFile(join(directory,'key.pem')),cert},createIngest({pool,ledger,token,environment:'test'}));server.listen(0,'127.0.0.1');await once(server,'listening');
  await assert.rejects(fetch(`https://127.0.0.1:${server.address().port}/v1/batch`));
  let now=0;const exporter=createExporter({url:`https://127.0.0.1:${server.address().port}/v1/batch`,token,clock:()=>now,autoStart:false});exporter.enqueue(record());exporter.pump();await settled();now=31000;exporter.pump();assert.equal(exporter.stats().delivered,0);assert.ok(!JSON.stringify(exporter.stats()).includes('PRIVATE'));await exporter.close();
  const trusted=createExporter({url:`https://127.0.0.1:${server.address().port}/v1/batch`,token,autoStart:false,request:(target,options)=>new Promise((resolve,reject)=>{const req=httpsRequest(target,{method:options.method,headers:options.headers,signal:options.signal,ca:cert},res=>{res.resume();res.once('end',()=>resolve(new Response(null,{status:res.statusCode})));});req.once('error',reject);req.end(options.body);})});trusted.enqueue(record());await trusted.flush();assert.equal(trusted.stats().delivered,1);assert.equal(writes,1);await trusted.close();
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}const target=await realpath(directory),root=await realpath(tmpdir());if(dirname(target)!==root||!basename(target).startsWith('origen-telemetry-tls-'))throw Error('unexpected synthetic TLS cleanup target');await rm(target,{recursive:true,force:true});}
});

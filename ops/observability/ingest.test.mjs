import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fixture} from './fixture.mjs';
import {createIngest} from './ingest.mjs';
import {diagnosticRecord,createMetadata,clientDiagnosticRecord} from '../../server/observability/event-schema.mjs';
import {readEvents} from './store.mjs';
import {assertTelemetryRole} from './config.mjs';
const metadata=createMetadata({NODE_ENV:'test'}),event=()=>diagnosticRecord({event:'api_request',httpStatus:200},{metadata,endpoint:'api.chat',method:'POST'});
test('ingest authenticates before reading, refuses plaintext and limits invalid input',async()=>{
 let writes=0;const pool={query:async()=>{writes++;throw Error('PRIVATE DATABASE DETAILS');}},token='a'.repeat(48),handler=createIngest({pool,ledger:pool,token,environment:'test'});
 const call=async({encrypted=true,authorization=`Bearer ${token}`,body='{}',url='/v1/batch'}={})=>{const response={statusCode:0,writeHead(status){this.statusCode=status;},end(data){this.data=data;},setHeader(){}};const req=Object.assign((async function*(){yield Buffer.from(body);})(),{method:'POST',url,headers:{authorization,'content-type':'application/json'},socket:{encrypted}});await handler(req,response);return response;};
 assert.equal((await call({encrypted:false})).statusCode,426);assert.equal((await call({authorization:'Bearer wrong'})).statusCode,401);assert.equal((await call({body:'{'})).statusCode,400);assert.equal((await call({body:'x'.repeat(262145)})).statusCode,413);assert.equal(writes,0);
 const bad={...event(),schemaVersion:7};assert.equal((await call({body:JSON.stringify({schemaVersion:1,events:[bad],metrics:[]})})).statusCode,400);
 const unavailable=await call({body:JSON.stringify({schemaVersion:1,events:[event()],metrics:[]})});assert.equal(unavailable.statusCode,503);assert.ok(!unavailable.data.includes('PRIVATE'));
});
test('rotating credentials accept a bounded overlap and stop accepting the previous token after expiry',async()=>{
 let now=0;const current='c'.repeat(48),previous='p'.repeat(48),handler=createIngest({pool:{},ledger:{},token:current,previousToken:previous,previousUntil:new Date(10000).toISOString(),environment:'test',clock:()=>now});
 const call=async token=>{const res={writeHead(status){this.status=status;},end(){},setHeader(){}};const req=Object.assign((async function*(){yield Buffer.from('{}');})(),{socket:{encrypted:true},method:'POST',url:'/v1/batch',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}});await handler(req,res);return res.status;};
 assert.equal(await call(previous),400);assert.equal(await call(current),400);now=10001;assert.equal(await call(previous),401);
});
test('real ingest deduplicates events, enforces schema and environment and never grants base-table access',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await fixture();let server;try{
  await assertTelemetryRole(f.ingest,'ingest');await assertTelemetryRole(f.query,'query');
  const handler=createIngest({pool:f.ingest,ledger:f.ledgerReader,token:'a'.repeat(48),environment:'test'});
  // Only this synthetic harness marks the socket as encrypted. Production uses
  // node:https with a certificate and never trusts forwarded TLS headers.
  server=createServer((req,res)=>{req.socket.encrypted=true;void handler(req,res);});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/v1/batch`;
  const row=event(),post=body=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${'a'.repeat(48)}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(let i=0;i<2;i++)assert.equal((await post({schemaVersion:1,events:[row],metrics:[]})).status,202);
  const found=await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test'});assert.equal(found.events.length,1);assert.equal(found.events[0].event_id,row.eventId);
  assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'production'})).events.length,0);
  const browser=diagnosticRecord(clientDiagnosticRecord({event:'api_error',code:'network_error'}),{metadata});assert.equal((await post({schemaVersion:1,events:[browser],metrics:[]})).status,202);
  for(const bad of [{...row,private:'PRIVATE'},{...row,environment:'production'},{...row,schemaVersion:2},{...row,time:'2000-01-01T00:00:00.000Z'}])assert.equal((await post({schemaVersion:1,events:[bad],metrics:[]})).status,400);
  await assert.rejects(f.ingest.query('SELECT * FROM telemetry_events'));await assert.rejects(f.query.query('SELECT * FROM telemetry_events'));await assert.rejects(f.query.query("INSERT INTO telemetry_event_dedupe VALUES(gen_random_uuid(),now())"));
  await assert.rejects(f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[{...row,eventId:crypto.randomUUID(),sql:'PRIVATE'}],metrics:[]})]));
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await f.close();}
});

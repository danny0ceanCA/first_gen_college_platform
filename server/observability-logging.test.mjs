import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createBoundedWriter,createLogger,createStreamSink} from './observability/logger.mjs';
import {createDiagnostics,createDiagnosticHandler} from './diagnostics.mjs';
import {createApp} from './index.mjs';

test('stalled sinks hold only one write and bound accepted work by count and bytes',async()=>{
 for(const options of [{capacity:Infinity},{maxBytes:NaN},{timeoutMs:0}])assert.throws(()=>createBoundedWriter(()=>{},options),/invalid_log_limits/);
 let release,calls=0;const gaps=[];
 const writer=createBoundedWriter(()=>{calls++;return new Promise(r=>{release=r;});},{capacity:2,maxBytes:8,timeoutMs:10,onGap:r=>gaps.push(r)});
 const first=writer('1234'),second=writer('1234');assert.equal(await writer('x'),false);
 assert.equal(writer.stats().pending,2);assert.equal(writer.stats().queuedBytes,8);assert.equal(calls,1);
 await first;assert.equal(calls,1);assert.ok(gaps.includes('queue_full'));assert.ok(writer.stats().failed>=1);
 assert.equal(await writer.flush(5),false);release();
 await new Promise(r=>setTimeout(r,0));assert.equal(calls,2);release();await second;
 assert.equal(await writer.flush(),true);assert.equal(writer.stats().queuedBytes,0);await writer.close();assert.equal(await writer('x'),false);
});

test('throwing/rejected sinks neither expose their errors nor stop HTTP responses',async()=>{
 const secret='password=private-secret SELECT private_name';
 for(const sink of [()=>{throw new Error(secret);},()=>Promise.reject(new Error(secret))]){
  const app=createApp({NODE_ENV:'test'},async()=>({sub:'test-user'}),null,sink),server=createServer(app);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/family`,{method:'POST'});assert.equal(response.status,401);assert.ok(response.headers.get('x-request-id'));await app.flushLogs();}
  finally{await new Promise(r=>server.close(r));}
 }
});

test('an asynchronous writable stream failure is contained rather than becoming an uncaught exception',async()=>{
 const stream=new Writable({write(chunk,encoding,callback){callback(new Error('private-secret'));}});
 const writer=createBoundedWriter(createStreamSink(stream));await writer('{"event":"synthetic"}\n');await writer.flush();
 assert.equal(writer.stats().failed,1);assert.equal(writer.stats().lastReason,'sink_failed');
});

test('local logs exclude content, rotate before two MB and remove files older than 24 hours',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'origen-logging-'));let time=Date.now();
 const log=createDiagnostics(dir,{env:{NODE_ENV:'test',APPLICATION_REVISION:'a'.repeat(40)},now:()=>time});
 try{
  await log({event:'database_error',code:'operation_failed',message:'private-secret',upstreamRequestId:'private-secret',sessionId:'00000000-0000-0000-0000-000000000000'});
  const file=join(dir,'voice.jsonl');let rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].release,'a'.repeat(40));assert.doesNotMatch(JSON.stringify(rows),/private-secret|00000000/);
  await writeFile(file,'x'.repeat(1999999));await log({event:'database_error'});
  assert.ok((await stat(file)).size<=2000000);assert.ok((await stat(file+'.1')).size<=2000000);
  time+=86460000;await log({event:'service.started'});
  rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.event),['service.started']);
  assert.equal(await stat(file+'.1').then(()=>true,()=>false),false);
 }finally{await log.close();await rm(dir,{recursive:true,force:true});}
});

test('diagnostic HTTP accepts safe observations despite sink failure, rejects malformed JSON and oversized data',async()=>{
 const handler=createDiagnosticHandler(()=>{throw new Error('private-secret');});
 async function call(body){let status;const req=Object.assign(Readable.from([body]),{url:'/api/voice-diagnostics',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'}});await handler(req,{writeHead(s){status=s},end(){}},()=>assert.fail());return status;}
 assert.equal(await call('{'),400);assert.equal(await call('x'.repeat(4097)),413);assert.equal(await call('{"event":"session_start"}'),204);
});

test('logger adapters receive only catalog fields with server release and no mutable envelope',async()=>{
 const rows=[],log=createLogger({env:{NODE_ENV:'test',APPLICATION_REVISION:'b'.repeat(40)},sink:r=>rows.push(r)});
 log({event:'upstream_response',operation:'voice_session',httpStatus:200,requestId:'private-secret',upstreamRequestId:'private-secret',message:'private-secret',level:'error'});
 await log.flush();assert.equal(rows.length,1);assert.equal(rows[0].release,'b'.repeat(40));assert.ok(Object.isFrozen(rows[0]));assert.equal(rows[0].level,'info');assert.doesNotMatch(JSON.stringify(rows),/private-secret/);
});

test('startup failure emits a fixed event and exits without a stack or configuration values',async()=>{
 const env={...process.env,NODE_ENV:'production',AUTH0_DOMAIN:'https://private-secret.invalid/',DATABASE_URL:'postgres://private-secret:private-secret@invalid/private-secret',OPENAI_API_KEY:'private-secret',MIGRATION_DATABASE_URL:'private-secret'};
 const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',s=>{output+=s;});child.stderr.on('data',s=>{output+=s;});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.equal(code,1);assert.doesNotMatch(output,/private-secret|Production configuration rejected| at /);
 assert.equal(JSON.parse(output.trim()).event,'service.startup.failed');
});

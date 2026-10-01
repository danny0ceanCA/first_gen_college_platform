import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createDiagnostics,createDiagnosticHandler,diagnosticRecord} from './diagnostics.mjs';
test('diagnostics excludes content and writes ordered technical records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'camino-diagnostics-'));
 try{
  const log=createDiagnostics(dir);
  await Promise.all([log({sessionId:'test-session',event:'session_start',transcript:'private',profile:{name:'private'},apiKey:'secret',audio:'private'}),log({sessionId:'test-session',event:'api_error',code:'invalid_value',parameter:'item_id',operation:'conversation.item.delete',message:'private'})]);
  const text=await readFile(join(dir,'voice.jsonl'),'utf8');
  const records=text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r=>r.event),['session_start','api_error']);
  assert.equal(records[1].parameter,'item_id');assert.ok(!/private|secret/.test(text));
  assert.equal(diagnosticRecord({code:'unsafe\nvalue'}).code,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('diagnostic endpoint requires local origin and bounds the payload',async()=>{
 const records=[],handler=createDiagnosticHandler(x=>records.push(diagnosticRecord(x)));
 async function call(origin,body){let status;await handler(Object.assign(Readable.from([body]),{url:'/api/voice-diagnostics',method:'POST',headers:{host:'127.0.0.1:5173',origin,'content-type':'application/json'}}),{writeHead(s){status=s},end(){}},()=>assert.fail());return status;}
 assert.equal(await call('https://bad.example','{}'),403);
 assert.equal(await call('http://127.0.0.1:5173','x'.repeat(5000)),413);
 assert.equal(await call('http://127.0.0.1:5173',JSON.stringify({event:'api_error',code:'invalid_value',message:'private'})),204);
 assert.equal(records.length,1);assert.equal(records[0].message,undefined);
});

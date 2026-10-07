import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from './index.mjs';
import {safeErrorCode} from './api-logging.mjs';

async function fixture(env={},database=null){
 const logs=[];const server=createServer(createApp({ALLOWED_ORIGINS:'https://origen.example',...env},async token=>{if(token!=='valid')throw new Error('private token details');return {sub:'private-account'};},database,record=>logs.push(record)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {logs,base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('all API outcomes have unique request IDs, safe logs and CORS-visible correlation headers',async()=>{
 const {logs,base,close}=await fixture();
 try{
  const responses=[];
  responses.push(await fetch(base+'/api/family?email=private@example.com',{method:'POST',headers:{Origin:'https://origen.example','X-Request-ID':'forged-private-id'},body:'private transcript'}));
  responses.push(await fetch(base+'/api/family',{method:'POST',headers:{Origin:'https://origen.example',Authorization:'Bearer private-invalid-token'}}));
  responses.push(await fetch(base+'/api/family',{method:'POST',headers:{Origin:'https://other.example',Authorization:'Bearer valid'}}));
  responses.push(await fetch(base+'/api/missing-private-path',{method:'POST',headers:{Authorization:'Bearer valid'}}));
  assert.deepEqual(responses.map(r=>r.status),[401,401,403,404]);
  assert.equal(responses[0].headers.get('Access-Control-Expose-Headers'),'X-Request-ID');
  const records=logs.filter(r=>r.event==='api_request');assert.equal(records.length,4);
  assert.deepEqual(records.map(r=>r.code),['authentication_required','invalid_token','origin_not_allowed','not_found']);
  const ids=responses.map(r=>r.headers.get('X-Request-ID'));assert.equal(new Set(ids).size,4);assert.deepEqual(records.map(r=>r.requestId),ids);
  for(const record of records){assert.ok(record.durationMs>=0);assert.equal(record.level,'warn');}
  assert.doesNotMatch(JSON.stringify(logs),/private|forged|Bearer|transcript|example\.com/);
 }finally{await close();}
});
test('database failure records SQLSTATE without SQL, user values, stack or secrets',async()=>{
 const database={query:async()=>({rows:[]}),connect:async()=>{throw Object.assign(new Error('password=private-secret; SELECT private_name'),{code:'53300'});}};
 const {logs,base,close}=await fixture({},database);
 try{
  const response=await fetch(base+'/api/family',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:JSON.stringify({action:'load'})});
  assert.equal(response.status,503);assert.equal((await response.json()).error,'database_unavailable');
  const error=logs.find(r=>r.event==='database_error');assert.equal(error.code,'postgres_53300');assert.equal(error.requestId,response.headers.get('X-Request-ID'));
  assert.doesNotMatch(JSON.stringify(logs),/password|SELECT|private|stack/);
  assert.equal(safeErrorCode({code:'private-secret',message:'private'}),'operation_failed');
  assert.equal(safeErrorCode({name:'TimeoutError'}),'timeout');
 }finally{await close();}
});
test('successful probes are quiet and failed readiness is logged',async()=>{
 const {logs,base,close}=await fixture();
 try{assert.equal((await fetch(base+'/healthz')).status,200);assert.equal(logs.length,0);assert.equal((await fetch(base+'/readyz')).status,503);assert.equal(logs[0].code,'database_not_ready');}finally{await close();}
});
test('anonymous AI and family access is rejected even with the retired preview flag',async()=>{
 for(const enabled of [false,true]){
  const {logs,base,close}=await fixture({ALLOW_PREVIEW_VOICE:enabled?'true':'false'});
  const headers={Origin:'https://origen.example','Content-Type':'application/json'};
  try{
   const voice=await fetch(base+'/api/profile-voice',{method:'POST',headers,body:'{}'});
   assert.equal(voice.status,401);
   for(const path of ['/api/family','/api/plans','/api/conversation-history','/api/chat','/api/finance-research','/api/admissions-research','/api/voice-diagnostics','/api/conversation-summary'])assert.equal((await fetch(base+path,{method:'POST',headers,body:'{}'})).status,401);
   assert.equal((await fetch(base+'/api/profile-voice',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:'{}'})).status,403);
   assert.equal((await fetch(base+'/api/profile-voice',{method:'POST',headers:{...headers,Authorization:'Bearer invalid'},body:'{}'})).status,401);
   assert.equal((await fetch(base+'/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
   assert.ok(logs.every(record=>record.requestId));
  }finally{await close();}
 }
});

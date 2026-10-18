import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from './index.mjs';
import {fixture} from './family-fixture.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
test('production gateway checks tokens, origins and preflights',async()=>{
 const server=createServer(createApp({ALLOWED_ORIGINS:'https://origen.example'},async token=>{if(token!=='valid')throw new Error();return {sub:'user-1'};}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/api/chat',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{Authorization:'Bearer invalid'}})).status,401);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{Origin:'https://other.example',Authorization:'Bearer valid'}})).status,403);
  const preflight=await fetch(base+'/api/chat',{method:'OPTIONS',headers:{Origin:'https://origen.example'}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://origen.example');
  assert.equal((await fetch(base+'/api/unknown',{method:'POST',headers:{Authorization:'Bearer valid'}})).status,503);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('gateway rejects malformed identity subjects before touching storage',async()=>{
 let queries=0;const database={query:async()=>{queries++;return {rows:[]};}};
 const server=createServer(createApp({},async token=>({sub:token==='object'?{}:token==='long'?'x'.repeat(256):'   '}),database,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const token of ['object','long','blank'])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/family`,{method:'POST',headers:{Authorization:`Bearer ${token}`}})).status,401);assert.equal(queries,0);}
 finally{await new Promise(r=>server.close(r));}
});

test('excess authenticated requests are rejected before closure database checks',async()=>{
 let queries=0;const database={query:async()=>{queries++;return {rows:[]};}};
 const server=createServer(createApp({},async()=>({sub:'same-account'}),database,()=>{}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/unknown`;
  for(let i=0;i<120;i++)assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer valid'}})).status,403);
  const rejected=await fetch(url,{method:'POST',headers:{Authorization:'Bearer valid'}});assert.equal(rejected.status,429);assert.equal(rejected.headers.get('Retry-After'),'60');assert.equal(queries,240);
 }finally{await new Promise(r=>server.close(r));}
});

test('diagnostic saturation cannot consume permission or family request budgets',async()=>{
 const {pool,run}=await fixture(),subject='synthetic-voice-budget';
 await createPermissionRepository(pool).account(subject,{action:'screen',ageBand:'18plus',audience:'grade9plus'});
 await run(subject,{action:'complete-onboarding',account:{firstName:'Alex',email:'',role:'student'}});
 const server=createServer(createApp({},async token=>({sub:token}),pool,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body={},token=subject)=>fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const diagnostic={event:'client_event',sessionId:crypto.randomUUID(),attemptId:crypto.randomUUID(),operation:'response.create'};
 try{
  assert.equal((await post('/api/eligibility',{action:'status'})).status,200);
  for(let i=0;i<240;i++)assert.equal((await post(`/api/voice-diagnostics${i%2?'?transport=voice':''}`,{...diagnostic,sequence:i+1})).status,204);
  const limited=await post('/api/voice-diagnostics',diagnostic);
  assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  assert.equal((await post('/api/eligibility',{action:'status'})).status,200);
  assert.equal((await post('/api/family',{action:'load'})).status,200);
  // Other authenticated accounts have independent budgets.
  assert.notEqual((await post('/api/voice-diagnostics',diagnostic,'another-account')).status,429);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();}
});

test('excess diagnostic traffic is also rejected before database work',async()=>{
 let queries=0;const database={query:async()=>{queries++;return {rows:[]};}};
 const server=createServer(createApp({},async()=>({sub:'same-account'}),database,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/voice-diagnostics`;
  for(let i=0;i<240;i++)assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer valid'}})).status,403);
  const before=queries;
  assert.equal((await fetch(url+'?extra=1',{method:'POST',headers:{Authorization:'Bearer valid'}})).status,429);
  assert.equal(queries,before);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

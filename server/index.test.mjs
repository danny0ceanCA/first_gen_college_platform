import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from './index.mjs';
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
  assert.equal((await fetch(base+'/api/unknown',{method:'POST',headers:{Authorization:'Bearer valid'}})).status,404);
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
  for(let i=0;i<120;i++)assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer valid'}})).status,404);
  const rejected=await fetch(url,{method:'POST',headers:{Authorization:'Bearer valid'}});assert.equal(rejected.status,429);assert.equal(rejected.headers.get('Retry-After'),'60');assert.equal(queries,120);
 }finally{await new Promise(r=>server.close(r));}
});

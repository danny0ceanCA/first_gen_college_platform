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

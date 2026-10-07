import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {productionConfigIssues,assertProductionConfig} from './production-config.mjs';
import {createApp} from './index.mjs';
const valid={NODE_ENV:'production',AUTH0_DOMAIN:'auth.example.com',AUTH0_AUDIENCE:'https://api.example.com',ALLOWED_ORIGINS:'https://app.example.com',DATABASE_URL:'postgresql://user:private-password@db.internal/origen',OPENAI_API_KEY:'private-api-key',ALLOW_PREVIEW_VOICE:'false'};
test('production startup tolerates the retired preview setting and rejects invalid configuration without disclosing secrets',()=>{
 assert.deepEqual(productionConfigIssues(valid),[]);assert.doesNotThrow(()=>assertProductionConfig(valid));
 assert.doesNotThrow(()=>createApp({...valid,ALLOW_PREVIEW_VOICE:'true'}));
 for(const patch of [{DATABASE_URL:''},{OPENAI_API_KEY:''},{ALLOW_PREVIEW_VOICE:'TRUE'},{ALLOWED_ORIGINS:'*'},{ALLOWED_ORIGINS:'https://app.example.com/path'},{ALLOWED_ORIGINS:'http://localhost:5173'},{AUTH0_DOMAIN:'https://auth.example.com'},{DATABASE_URL:'https://private-user:private-password@db.example.com'}]){
  const env={...valid,...patch};assert.ok(productionConfigIssues(env).length);assert.throws(()=>createApp(env));assert.doesNotMatch(productionConfigIssues(env).join(' '),/private-password|private-api-key|private-user/);
 }
 assert.doesNotThrow(()=>assertProductionConfig({NODE_ENV:'development',ALLOW_PREVIEW_VOICE:'true'}));
});
test('API errors and health responses carry cache and browser safeguards',async()=>{
 const server=createServer(createApp({}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const path of ['/healthz','/api/family','/missing']){const r=await fetch(base+path);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('X-Frame-Options'),'DENY');}}
 finally{await new Promise(r=>server.close(r));}
});

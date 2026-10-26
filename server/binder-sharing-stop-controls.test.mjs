import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createCoordinatorConnectionsHandler} from './coordinator-connections.mjs';
import {createApp} from './index.mjs';

test('sharing stop controls preserve student intent across retries and pauses', {skip:!process.env.DATABASE_TEST_URL}, async t=>{
 const f=await coordinatorPilotFixture();t.after(()=>f.close());
 const student=(action,extra={})=>f.call('other','/api/coordinator-connections',{action,studentId:'alex',...extra});
 const sharing=(action,extra={})=>f.call('other','/api/binder-sharing',{action,studentId:'alex',...extra});
 const code=(await f.call('staff','/api/coordinator-access',{action:'rotate-code',id:f.org})).code;
 const context=await student('open',{channel:'screen'});
 const found=await student('lookup',{contextId:context.contextId,sequence:0,code});
 const card={contextId:context.contextId,sequence:0,challengeId:found.challengeId};
 await student('prepare',card);
 const connected=await student('confirm',{...card,confirmed:true,topics:['options']});
 const connectionId=connected.connectionId;

 await t.test('cancel after a committed confirmation reports the real request, never a false cancellation',async()=>{
  const result=await student('cancel',card);
  assert.equal(result.status,'requested');
  assert.equal(result.connectionId,connectionId);
  assert.equal((await student('list')).connections.find(c=>c.id===connectionId).status,'requested');
 });
 await f.call('staff','/api/coordinator-connections',{action:'accept',organizationId:f.org,connectionId});
 const preview=()=>sharing('preview',{connectionId,topics:['options'],entryIds:[f.notes[0]]});
 const publish=p=>sharing('publish',{previewId:p.previewId,confirmed:true});
 await publish(await preview());
 const grantId=(await sharing('status')).grants[0].id;
 await t.test('a repeated stop invalidates a preview prepared after the first stop',async()=>{
  await sharing('revoke',{grantId});
  const stale=await preview();
  await sharing('revoke',{grantId});
  await assert.rejects(publish(stale),{status:409});
  assert.equal((await sharing('status')).grants[0].status,'revoked');
  await assert.rejects(f.call('staff','/api/coordinator-binders',{action:'read',organizationId:f.org,grantId}),{status:404});
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
 });
 await t.test('students can disconnect while every linking flag is off',async()=>{
  const handler=createCoordinatorConnectionsHandler(f.db,{});
  const server=createServer((req,res)=>{
   req.origenIdentity={sub:'other'};req.origenAuthorized=true;
   void f.as('other',()=>handler(req,res,()=>{res.writeHead(404);res.end();}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-connections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'withdraw',studentId:'alex',connectionId})});
   assert.equal(response.status,200);
   assert.equal((await response.json()).status,'revoked');
   assert.equal((await student('list')).connections.find(c=>c.id===connectionId).status,'revoked');
   assert.ok((await sharing('status')).grants.every(g=>g.status==='revoked'));
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 await t.test('gateway permits owned stop controls while paused, rejects foreign targets and all admission',async()=>{
  let identity={sub:'other'};
  const app=createApp({},async()=>identity,f.db,()=>{}),server=createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-connections`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
   assert.equal((await send({action:'open',studentId:'alex',channel:'screen',enabled:true})).status,503);
   assert.equal((await send({action:'accept',organizationId:f.org,connectionId})).status,503);
   assert.equal((await send({action:'withdraw',studentId:'sam',connectionId})).status,403);
   identity={sub:'reader'};
   assert.equal((await send({action:'withdraw',studentId:'alex',connectionId})).status,403);
   identity={sub:'other'};
   const list=await send({action:'list',studentId:'alex'});assert.equal(list.status,200);
   assert.equal((await list.json()).connections[0].id,connectionId);
   assert.equal((await send({action:'withdraw',studentId:'alex',connectionId})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));await app.flushLogs();}
 });
 await t.test('repeat note and topic removal invalidate a newer preview without removing unrelated notes',async()=>{
  const newContext=await student('open',{channel:'screen'});
  const lookup=await student('lookup',{contextId:newContext.contextId,sequence:0,code});
  const challenge={contextId:newContext.contextId,sequence:0,challengeId:lookup.challengeId};
  await student('prepare',challenge);
  const link=await student('confirm',{...challenge,confirmed:true,topics:[]});
  await f.call('staff','/api/coordinator-connections',{action:'accept',organizationId:f.org,connectionId:link.connectionId});
  const review=()=>sharing('preview',{connectionId:link.connectionId,topics:['options','costs'],entryIds:f.notes.slice(0,2)});
  await publish(await review());
  let grant=(await sharing('status')).grants.find(g=>g.status==='active');
  const item=grant.items.find(i=>i.topic==='options');
  await sharing('withdraw',{grantId:grant.id,itemId:item.id});
  let stale=await review();
  await sharing('withdraw',{grantId:grant.id,itemId:item.id});
  await assert.rejects(publish(stale),{status:409});
  assert.equal((await sharing('status')).grants.find(g=>g.id===grant.id).items.length,1);
  await sharing('remove-topic',{grantId:grant.id,topic:'options'});
  stale=await review();
  await sharing('remove-topic',{grantId:grant.id,topic:'options'});
  await assert.rejects(publish(stale),{status:409});
  await publish(await review()); // A fresh, explicit review can still share.
  assert.equal((await sharing('status')).grants.find(g=>g.id===grant.id).items.length,2);
 });
 await t.test('racing confirmation against repeated stops never restores access after the stop',async()=>{
  const live=(await sharing('status')).grants.find(g=>g.status==='active');
  for(let i=0;i<12;i++){
   await sharing('revoke',{grantId:live.id});
   const card=await sharing('preview',{connectionId:live.connectionId,topics:['options'],entryIds:[f.notes[0]]});
   const results=await Promise.allSettled(i%2
    ?[publish(card),sharing('revoke',{grantId:live.id})]
    :[sharing('revoke',{grantId:live.id}),publish(card)]);
   assert.equal(results[i%2?1:0].status,'fulfilled');
   assert.equal((await sharing('status')).grants.find(g=>g.id===live.id).status,'revoked');
   await assert.rejects(f.call('staff','/api/coordinator-binders',{action:'read',organizationId:f.org,grantId:live.id}),{status:404});
  }
 });
 await t.test('expired student permission cannot prevent disconnecting or reveal another profile',async()=>{
  // Establish a connection while permission is valid; let it expire naturally,
  // without firing the UPDATE trigger that would already revoke connections.
  await f.owner.query("UPDATE origen_eligibility SET status='approved',permission_expires_at=clock_timestamp()+interval '2 seconds' WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");
  const ctx=await student('open',{channel:'screen'});
  const lookup=await student('lookup',{contextId:ctx.contextId,sequence:0,code});
  const challenge={contextId:ctx.contextId,sequence:0,challengeId:lookup.challengeId};
  await student('prepare',challenge);
  const link=await student('confirm',{...challenge,confirmed:true,topics:[]});
  await new Promise(resolve=>setTimeout(resolve,2100));
  await assert.rejects(student('available'),{status:403});
  assert.ok((await student('list')).connections.some(c=>c.id===link.connectionId));
  assert.equal((await student('withdraw',{connectionId:link.connectionId})).status,'revoked');
  await assert.rejects(student('withdraw',{studentId:'sam',connectionId:link.connectionId}),{status:403});
 });
});

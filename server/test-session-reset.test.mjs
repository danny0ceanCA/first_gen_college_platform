import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './family-fixture.mjs';
import {createLifecycleRepository,createLifecycleHandler,accountClosed} from './account-lifecycle.mjs';
import {createServer} from 'node:http';
import {createHistoryRepository} from './history.mjs';
import {resetTestSession} from '../src/testSessionReset.mjs';
import {createLogoutTransition} from '../src/logoutHandoff.mjs';
import {ONBOARDING_TEST_SUBJECT} from '../src/testAccount.mjs';

const identity={sub:'test-owner',email:'test@test.org',email_verified:true};
test('the pinned synthetic Auth0 identity resets even though its fictional email is unverified',async()=>{
 const {pool,run}=await fixture();
 const pinned={sub:ONBOARDING_TEST_SUBJECT,email:'test@test.org',email_verified:false};
 try{
  await run(pinned.sub,{action:'save-student',student:{id:'s',name:'Synthetic',stage:'College'}});
  let stopped=false;
  await resetTestSession({user:pinned,getToken:async()=> 'synthetic-token',stop:()=>{stopped=true;},fetcher:async()=>{
   assert.equal(stopped,true);
   const result=await createLifecycleRepository(pool)(pinned.sub,{action:'reset-test-session'},pinned);
   return {ok:true,json:async()=>result};
  }});
  assert.deepEqual((await run(pinned.sub,{action:'load'})).students,[]);
  assert.equal(await accountClosed(pool,pinned.sub),false);
 }finally{await pool.end();}
});
test('test workspace survives normal loads, resets on logout, and can onboard again without closing sign-in',async()=>{
 const {pool,run}=await fixture();const life=createLifecycleRepository(pool);
 try{
  await run(identity.sub,{action:'complete-onboarding',account:{firstName:'Test',email:'test@test.org',role:'student'},student:{id:'s',name:'Alex',stage:'College'}});
  await createHistoryRepository(pool)(identity.sub,{action:'save',item:{id:'h',studentId:null,mode:'planning',summary:'Synthetic session conversation',sources:[],date:new Date().toISOString()}});
  await run('other',{action:'save-student',student:{id:'s',name:'Other',stage:'College'}});
  assert.equal((await run(identity.sub,{action:'load'})).students[0].name,'Alex');
  assert.equal((await pool.query('SELECT * FROM origen_conversation_summaries')).rows.length,1);
  for(const wrong of [undefined,{...identity,email:'other@example.org'},{...identity,email_verified:false},{...identity,sub:'other'}])await assert.rejects(life(identity.sub,{action:'reset-test-session'},wrong),{status:403});
  assert.deepEqual(await life(identity.sub,{action:'reset-test-session'},identity),{reset:true});
  assert.equal(await accountClosed(pool,identity.sub),false);
  assert.equal((await pool.query('SELECT * FROM origen_conversation_summaries')).rows.length,0);
  assert.equal((await run('other',{action:'load'})).students[0].name,'Other');
  const empty=await run(identity.sub,{action:'load'});assert.equal(empty.account.firstName,'');assert.deepEqual(empty.students,[]);
  // A second attempt is safe if the reset succeeded but the redirect failed.
  await life(identity.sub,{action:'reset-test-session'},identity);
  await run(identity.sub,{action:'complete-onboarding',account:{firstName:'Fresh',email:'test@test.org',role:'student'}});
  assert.equal((await run(identity.sub,{action:'load'})).account.firstName,'Fresh');
 }finally{await pool.end();}
});

test('logout waits for reset; failure blocks redirect and retry preserves the reset order',async()=>{
 const events=[];let fail=true;
 const cleanup=()=>resetTestSession({user:identity,getToken:async()=> 'token',stop:()=>events.push('stop'),fetcher:async(_url,options)=>{
  events.push('reset');assert.deepEqual(JSON.parse(options.body),{action:'reset-test-session'});
  return {ok:!fail,json:async()=>({reset:true})};
 }});
 const flow=createLogoutTransition({cleanup,stop:()=>events.push('cleanup'),redirect:async()=>events.push('redirect'),cover:async()=>{},onPhase:phase=>events.push(phase)});
 await flow.start();assert.ok(events.includes('error'));assert.ok(!events.includes('redirect'));
 fail=false;await flow.start();assert.deepEqual(events.slice(-4),['stop','reset','cleanup','redirect']);
});

test('other and unverified identities never request automatic deletion',async()=>{
 for(const user of [undefined,{...identity,email:'student-test@example.test'},{...identity,email_verified:false}])await resetTestSession({user,getToken:async()=>{throw Error('unexpected');},stop:()=>{throw Error('unexpected');}});
});

test('reset endpoint uses trusted profile and rejects forged ownership fields',async()=>{
 const {pool,run}=await fixture();let verified={...identity,email:'other@example.org'};
 await run(identity.sub,{action:'save-student',student:{id:'s',name:'Alex',stage:'College'}});
 const handler=createLifecycleHandler(pool,{lookup:async req=>{assert.equal(req.origenIdentity.sub,identity.sub);return verified;}});
 const server=createServer((req,res)=>{req.origenAuthorized=true;req.origenIdentity={sub:identity.sub};return handler(req,res,()=>res.end());});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/account-data`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post({action:'reset-test-session',email:'test@test.org'})).status,400);
  assert.equal((await post({action:'reset-test-session'})).status,403);
  assert.equal((await run(identity.sub,{action:'load'})).students.length,1);
  verified=identity;
  const result=await post({action:'reset-test-session'});assert.equal(result.status,200);assert.deepEqual(await result.json(),{reset:true});
  assert.deepEqual((await run(identity.sub,{action:'load'})).students,[]);
 }finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
});

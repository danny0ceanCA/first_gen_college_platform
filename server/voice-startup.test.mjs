import {createPlanRepository,validatePlan} from './plans.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {voiceStartup} from '../src/voiceStartup.mjs';
import {voicePreparationCache,voicePreparationKey,voiceContextVersion,preparedVoiceContext} from './voice-preparation.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const audio=()=>{let stopped=0;return {stream:{getTracks:()=>[{stop(){stopped++;}}]},stopped:()=>stopped};};

test('returning parent startup receipts preserve prepared child context; real changes still invalidate it',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();let headers;
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_VOICE_PREPARATION:'true'},async()=>new Response(JSON.stringify({session:{id:'synthetic'},transport:{sdp:'v=0\r\nanswer'}}),{status:201}),()=>{},f.db);
 const scope={mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true};
 async function call(body){
  const req=Object.assign(Readable.from([JSON.stringify({...scope,...body})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,data;
  await f.as('reader',()=>handler(req,{writeHead(s,h){status=s;headers=h;},end(s){data=JSON.parse(s);}},()=>{}));
  assert.equal(status,200,JSON.stringify(data));return data;
 }
 const revision=()=>f.as('reader',()=>voiceContextVersion(f.db,'reader'));
 try{
  await f.family('reader',{action:'welcome-heard'});
  for(const language of ['en','es']){
   const selected=await call({action:'prepare',language});assert.ok(selected.preparedContextId);
   const neutral=await call({action:'prepare',language,studentId:undefined,targetConfirmed:false});
   const before=await revision();
   await call({sdp:'v=0',voiceProtocol:'live-v1',language,studentId:undefined,targetConfirmed:false,preparedContextId:neutral.preparedContextId});
   await f.family('reader',{action:'voice-used'});
   await f.family('reader',{action:'welcome-heard'});
   assert.equal(await revision(),before,'repeat receipts must not change the context revision');
   await call({action:'update-guide',voiceProtocol:'live-v1',language,preparedContextId:selected.preparedContextId});
   assert.match(headers['Server-Timing'],/preparation;desc="hit"/);
  }
  const stale=await call({action:'prepare'});
  await f.family('reader',{action:'save-student',student:{id:'alex',name:'Alex',stage:'Community college',interest:'NEW_INTEREST',gpa:'',color:'peach'}});
  const updated=await call({action:'update-guide',voiceProtocol:'live-v1',preparedContextId:stale.preparedContextId});
  assert.match(headers['Server-Timing'],/preparation;desc="miss"/);
  assert.match(JSON.stringify(updated.session),/NEW_INTEREST/);
  // A first-ever receipt is a real experience change and must remain versioned.
  const before=await f.as('other',()=>voiceContextVersion(f.db,'other'));
  await f.family('other',{action:'voice-used'});
  assert.notEqual(await f.as('other',()=>voiceContextVersion(f.db,'other')),before);
 }finally{await f.close();}
});

test('audio permission and authentication start concurrently; ready preparation is optional',async()=>{
 const token=deferred(),media=deferred(),calls=[],a=audio();
 const task=voiceStartup({getToken:()=>{calls.push('auth');return token.promise;},getMedia:()=>{calls.push('mic');return media.promise;},prepare:async()=>{calls.push('prepare');return 'prepared';}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(calls.sort(),['auth','mic']);token.resolve('token');
 await new Promise(r=>setImmediate(r));assert.ok(calls.includes('prepare'));media.resolve(a.stream);
 const result=await task;assert.equal(result.prepared(),'prepared');assert.equal(result.stream,a.stream);assert.equal(a.stopped(),0);
});
test('cancel, auth failure, microphone failure and deadline stop late audio and prevent stale preparations',async()=>{
 for(const reason of ['cancel','auth','mic','timeout']){
  const media=deferred(),token=deferred(),a=audio(),abort=new AbortController();let preparations=0;
  const task=voiceStartup({getToken:()=>token.promise,getMedia:()=>media.promise,prepare:async()=>{preparations++;return 'stale';},signal:abort.signal,timeoutMs:reason==='timeout'?10:1000});
  await new Promise(r=>setImmediate(r));
  if(reason==='cancel')abort.abort();if(reason==='auth')token.reject(new Error('auth'));if(reason==='mic')media.reject(new Error('mic'));
  await assert.rejects(task);token.resolve('late');if(reason!=='mic')media.resolve(a.stream);
  await new Promise(r=>setImmediate(r));assert.equal(preparations,0);assert.equal(a.stopped(),reason==='mic'?0:1);
 }
});
test('an already cancelled or immediately cancelled start never opens the microphone',async()=>{
 for(const before of [true,false]){const abort=new AbortController();let calls=0;if(before)abort.abort();const task=voiceStartup({signal:abort.signal,getToken:async()=>undefined,getMedia:async()=>{calls++;return audio().stream;}});if(!before)abort.abort();await assert.rejects(task);await new Promise(r=>setImmediate(r));assert.equal(calls,0);}
});
test('preparation is one-use, bounded, scope/key/revision/policy checked, and evicted on expiry',()=>{
 const env={ORIGEN_PERSONALIZATION_MODE:'on'};let time=0;const cache=voicePreparationCache(env,{now:()=>time});
 const key=voicePreparationKey({mode:'planning',studentId:'alex',sdp:'v=0'});assert.equal(key,voicePreparationKey({studentId:'alex',mode:'planning',action:'prepare'}));
 const put=()=>cache.put('reader',key,'1',{input:{studentId:'alex'}});
 const id=put();assert.equal(cache.take('other',id,key,'1'),undefined);assert.equal(cache.take('reader',id,key,'1').input.studentId,'alex');assert.equal(cache.take('reader',id,key,'1'),undefined);
 assert.equal(cache.take('reader',put(),key,'2'),undefined);assert.equal(cache.take('reader',put(),'wrong','1'),undefined);
 const old=put();env.ORIGEN_PERSONALIZATION_MODE='off';assert.equal(cache.take('reader',old,key,'1'),undefined);
 const expired=put();time=61000;assert.equal(cache.take('reader',expired,key,'1'),undefined);
});

test('SDP-ready wait uses preparation finishing after audio, with a bounded abortable grace period',async()=>{
 const p=deferred();const ready=await voiceStartup({getToken:async()=> 'token',getMedia:async()=>audio().stream,prepare:()=>p.promise});
 assert.equal(ready.prepared(),undefined);const waiting=ready.waitForPrepared(1000);p.resolve('ready');assert.equal(await waiting,'ready');
 const late=deferred();let signal;const slow=await voiceStartup({getToken:async()=> 'token',getMedia:async()=>audio().stream,prepare:(_,s)=>{signal=s;return late.promise;}});
 assert.equal(await slow.waitForPrepared(10),undefined);assert.equal(signal.aborted,true);late.resolve('too-late');await new Promise(r=>setImmediate(r));assert.equal(slow.prepared(),undefined);
});

test('prepared snapshots contain evidence only and keep separate neutral/confirmed scopes',()=>{
 assert.deepEqual(preparedVoiceContext({profile:{name:'Alex'},caller:{name:'Parent'},voiceProtocol:'old',enableLiveMemory:false,continuing:true,token:'secret',sdp:'v=0'}),{profile:{name:'Alex'},caller:{name:'Parent'}});
 const cache=voicePreparationCache({});const one=cache.put('parent','neutral','1',{context:'neutral'}),two=cache.put('parent','alex','1',{context:'alex'});
 assert.equal(cache.take('parent',one,'neutral','1').context,'neutral');assert.equal(cache.take('parent',two,'alex','1').context,'alex');
});

test('preparation bypass for linked profiles preserves ordinary continuity revision checks',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();
 try{
  await f.owner.query("INSERT INTO origen_student_links(owner_account_id,owner_student_id,member_account_id,member_student_id,member_role) SELECT o.id,'alex',m.id,'alex','student' FROM origen_accounts o CROSS JOIN origen_accounts m WHERE o.auth0_subject='reader' AND m.auth0_subject='other'");
  assert.notEqual(await f.as('other',()=>voiceContextVersion(f.db,'other')),undefined);
  assert.equal(await f.as('other',()=>voiceContextVersion(f.db,'other',{forPreparation:true})),undefined);
  assert.notEqual(await f.as('reader',()=>voiceContextVersion(f.db,'reader',{forPreparation:true})),undefined);
 }finally{await f.close();}
});

test('prepared Live startup preserves current controls, reloads teachings, and isolates the parent opening in both languages',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();let calls=0,sent,headers;
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_VOICE_PREPARATION:'true'},async(url,options)=>{
  calls++;assert.ok(url.endsWith('/live/sessions'));sent=JSON.parse(options.body).session;
  return new Response(JSON.stringify({session:{id:'synthetic'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});
 },()=>{},f.db);
 const input={mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true};
 async function call(body){
  const req=Object.assign(Readable.from([JSON.stringify({...input,...body})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status,data;
  await f.as('reader',()=>handler(req,{writeHead(s,h){status=s;headers=h;},end(s){data=JSON.parse(s);}},()=>{}));
  assert.equal(status,200,JSON.stringify(data));return data;
 }
 try{
  await f.save('private','PRIVATE_CHILD_DETAIL: Alex wants evening classes.');
  for(const language of ['en','es']){
   const selected=await call({action:'prepare',language});assert.ok(selected.preparedContextId);
   const neutral=await call({action:'prepare',language,studentId:undefined,targetConfirmed:false});assert.ok(neutral.preparedContextId);
   const before=calls;
   // A teaching published after preparation must still be available at call time.
   const id=randomUUID(),doc={title:'Synthetic teaching',topic:'planning',language,explanation:'FRESH_TEACHING: explain the idea before the term.',deliveryStyle:'Warm and patient.',reviewBy:'2099-12-31'};
   await f.owner.query('INSERT INTO origen_teachings(id,draft,published,published_revision) VALUES($1,$2::jsonb,$2::jsonb,1)',[id,JSON.stringify(doc)]);
   const result=await call({sdp:'v=0',voiceProtocol:'live-v1',language,preparedContextId:selected.preparedContextId,scopeRestart:true});
   assert.equal(result.voiceProvider,'live');assert.match(headers['Server-Timing'],/preparation;desc="hit"/);assert.equal(calls,before+1);
   assert.match(sent.delegation.responses.instructions,/PRIVATE_CHILD_DETAIL/);
   assert.match(sent.delegation.responses.instructions,/FRESH_TEACHING/);assert.match(sent.delegation.responses.instructions,/Scope restart: true/);
   assert.equal(result.voiceSession.language,language);
   await call({sdp:'v=0',voiceProtocol:'live-v1',language,studentId:undefined,targetConfirmed:false,preparedContextId:neutral.preparedContextId});
   assert.match(headers['Server-Timing'],/preparation;desc="hit"/);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_CHILD_DETAIL|FRESH_TEACHING/);
   const withdrawal=await call({action:'prepare',language});await f.owner.query('UPDATE origen_teachings SET published=NULL,published_revision=NULL WHERE id=$1',[id]);
   await call({sdp:'v=0',voiceProtocol:'live-v1',language,preparedContextId:withdrawal.preparedContextId});assert.match(headers['Server-Timing'],/preparation;desc="hit"/);assert.doesNotMatch(JSON.stringify(sent),/FRESH_TEACHING/);
  }
  const before=calls;
  for(const workspaceFocus of [{kind:'coordinator-guidance',studentId:'alex',topic:'transfer',feedbackId:randomUUID(),version:1},{kind:'review-response',studentId:'alex',topic:'transfer',source:{kind:'review-response',requestId:randomUUID(),responseVersion:1}}])assert.equal((await call({action:'prepare',workspaceFocus})).preparedContextId,null);
  assert.equal(calls,before);
 }finally{await f.close();}
});

test('prepared voice skips repeated context loads but rejects stale profiles, sources, actions and another account',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();let queries=0,calls=0,config;
 const db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(...args)=>{queries++;return c.query(...args);}};}};
 const env={OPENAI_API_KEY:'synthetic',ORIGEN_VOICE_PREPARATION:'true',ORIGEN_PERSONALIZATION_MODE:'on'};
 const handler=createProfileVoiceHandler(env,async(u,o)=>{calls++;config=JSON.parse(o.body.get('session'));return new Response('v=0');},()=>{},db);
 const input={mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true};
 async function call(body,sub='reader'){
  const req=Readable.from([JSON.stringify({...input,...body})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub}});let status,data;
  await f.as(sub,()=>handler(req,{writeHead(s){status=s;},end(s){data=JSON.parse(s);}},()=>{}));assert.equal(status,200,JSON.stringify(data));return data;
 }
 try{
  await f.save('older','Alex needs evening laboratory classes.');await call({sdp:'v=0'});const coldQueries=queries;queries=0;
  const prepared=await call({action:'prepare'});assert.ok(prepared.preparedContextId);assert.equal(calls,1);queries=0;
  await call({sdp:'v=0',preparedContextId:prepared.preparedContextId});assert.ok(queries<coldQueries/2,`${queries} vs ${coldQueries}`);t.diagnostic(`Synthetic context database operations: cold=${coldQueries}, prepared=${queries}`);assert.equal(calls,2);
  const stale=await call({action:'prepare'});await f.history({action:'delete',id:'older'});await call({sdp:'v=0',preparedContextId:stale.preparedContextId});assert.doesNotMatch(config.instructions,/Alex needs evening laboratory classes/);
  const profile=await call({action:'prepare'});await f.family('reader',{action:'save-student',student:{id:'alex',name:'New Alex',stage:'Community college',interest:'NEW_GOAL',gpa:'',color:'peach'}});await call({sdp:'v=0',preparedContextId:profile.preparedContextId});assert.match(config.instructions,/NEW_GOAL/);
  const action=await call({action:'prepare'});
  await f.as('reader',()=>createPlanRepository(f.db)('reader',validatePlan({action:'create',plan:{studentId:'alex',title:'UNIQUE_NEW_ACTION',goal:'',category:'education',status:'active',summaryIds:[],steps:[{id:'one',title:'UNIQUE_NEW_ACTION',action:'Ask the counselor',notes:'',status:'not-started',dueDate:null,sources:[]}]}})));
  await call({sdp:'v=0',preparedContextId:action.preparedContextId});assert.match(config.instructions,/UNIQUE_NEW_ACTION/);
  const cross=await call({action:'prepare'});await call({sdp:'v=0',preparedContextId:cross.preparedContextId},'other');assert.doesNotMatch(config.instructions,/NEW_GOAL/);
  const version=await f.as('reader',()=>voiceContextVersion(f.db,'reader'));await f.owner.query("UPDATE origen_accounts SET role='student' WHERE auth0_subject='reader'");assert.notEqual(await f.as('reader',()=>voiceContextVersion(f.db,'reader')),version);
 }finally{await f.close();}
});

import {createPlanRepository,validatePlan} from './plans.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {voiceStartup} from '../src/voiceStartup.mjs';
import {voicePreparationCache,voicePreparationKey,voiceContextVersion} from './voice-preparation.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const audio=()=>{let stopped=0;return {stream:{getTracks:()=>[{stop(){stopped++;}}]},stopped:()=>stopped};};

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
 const expired=put();time=13000;assert.equal(cache.take('reader',expired,key,'1'),undefined);
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

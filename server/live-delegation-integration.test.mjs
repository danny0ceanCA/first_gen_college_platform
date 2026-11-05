import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';

test('authorized prepared calls and updates use the scoped opening brief and preserve account boundaries',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async()=>{
 const f=await retrievalFixture();let sent,headers;
 const env={OPENAI_API_KEY:'synthetic',NODE_ENV:'development',ORIGEN_LIVE_FOLLOWUPS:'true',ORIGEN_VOICE_PREPARATION:'true',ORIGEN_PERSONALIZATION_MODE:'on'};
 const handler=createProfileVoiceHandler(env,async(_url,options)=>{sent=JSON.parse(options.body).session;return new Response(JSON.stringify({session:{id:'fake-provider'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});},()=>{},f.db);
 const base={mode:'planning',studentId:'alex',role:'parent',language:'en',routeConversations:true,targetConfirmed:true,voiceProtocol:'live-v1'};
 async function call(body){
  let status,data;const req=Object.assign(Readable.from([JSON.stringify({...base,...body})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});
  await f.as('reader',()=>handler(req,{writeHead(s,h){status=s;headers=h;},end(s){data=JSON.parse(s);}},()=>assert.fail('route')));
  assert.equal(status,200,JSON.stringify(data));return data;
 }
 try{
  await f.save('note','FICTIONAL_HISTORY: Alex is considering evening classes.');
  await f.save('other-student','PRIVATE_OTHER_STUDENT: Sam prefers morning classes.',{studentId:'sam'});
  await f.save('other-account','PRIVATE_OTHER_ACCOUNT: Alex likes biology.',{sub:'other'});
  for(const language of ['en','es']){
   const prepared=await call({action:'prepare',language});assert.ok(prepared.preparedContextId);
   const live=await call({sdp:'v=0',language,preparedContextId:prepared.preparedContextId});
   assert.match(headers['Server-Timing'],/preparation;desc="hit"/);
   assert.equal(live.voiceSession.routingPolicy,'bounded-follow-up-v1');assert.match(sent.instructions,/Do not restrict this to the immediately preceding answer/);
   assert.match(sent.delegation.responses.instructions,/FICTIONAL_HISTORY/);
   assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_OTHER_STUDENT|PRIVATE_OTHER_ACCOUNT/);
   assert.equal(sent.routingPolicy,undefined);assert.equal(sent.delegation.responses.routingPolicy,undefined);
   const handoff=await call({action:'prepare',language});
   const update=await call({action:'update-guide',language,preparedContextId:handoff.preparedContextId,workspaceRefreshOnly:false,routingPolicy:'bounded-follow-up-v1'});
   assert.match(headers['Server-Timing'],/preparation;desc="hit"/);
   assert.match(update.session.instructions,/FICTIONAL_HISTORY/);
   assert.equal(update.session.routingPolicy,'bounded-follow-up-v1');assert.match(update.session.liveInstructions,/replaces every earlier delegation policy/);
   assert.match(update.session.liveInstructions,/Do not restrict this to the immediately preceding answer/);
   assert.doesNotMatch(JSON.stringify(update),/PRIVATE_OTHER_STUDENT|PRIVATE_OTHER_ACCOUNT/);
  }
  const prepared=await call({action:'prepare'});env.NODE_ENV='production';
  const production=await call({sdp:'v=0',preparedContextId:prepared.preparedContextId,routingPolicy:'bounded-follow-up-v1'});
  assert.equal(production.voiceSession.routingPolicy,'bounded-follow-up-v1');assert.match(sent.instructions,/Do not restrict this to the immediately preceding answer/);
  assert.match(sent.instructions,/FICTIONAL_HISTORY/,'the authorized opening brief supplies relevant history');
  assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_OTHER_STUDENT|PRIVATE_OTHER_ACCOUNT/);
  assert.match(sent.delegation.responses.instructions,/FICTIONAL_HISTORY/);
 }finally{await f.close();}
});

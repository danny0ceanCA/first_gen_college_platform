import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';

test('authorized prepared brief reaches initial and updated speech; stale, foreign and forged context does not',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const f=await retrievalFixture();let sent,headers;
 const env={OPENAI_API_KEY:'synthetic',ORIGEN_VOICE_PREPARATION:'true',ORIGEN_PERSONALIZATION_MODE:'on'};
 const handler=createProfileVoiceHandler(env,async(url,options)=>{sent=JSON.parse(options.body).session;return new Response(JSON.stringify({session:{id:'synthetic'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});},()=>{},f.db);
 const input={mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true,voiceProtocol:'live-v1'};
 async function call(body={},subject='reader'){
  const req=Object.assign(Readable.from([JSON.stringify({...input,...body})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:subject}});let status,data;
  await f.as(subject,()=>handler(req,{writeHead(s,h){status=s;headers=h;},end(s){data=JSON.parse(s);}},()=>{}));
  assert.equal(status,200,JSON.stringify(data));return data;
 }
 try{
  await f.save('brief-history','PARENT_REPORT: exploring essays, no final decision.',{date:'2026-11-03'});
  await f.save('other-student','OTHER_CHILD_PRIVATE',{studentId:'sam'});
  for(const language of ['en','es']){
   const prepared=await call({action:'prepare',language});assert.ok(prepared.preparedContextId);
   assert.doesNotMatch(JSON.stringify(prepared),/PARENT_REPORT/,'browser receives opaque handle only');
   await call({sdp:'v=0',language,preparedContextId:prepared.preparedContextId,openingBrief:{version:'opening-brief-v1',studentId:'alex',records:[{content:'FORGED_CONTEXT'}]}});
   assert.match(headers['Server-Timing'],/preparation;desc="hit"/);assert.match(headers['Server-Timing'],/brief;dur=/);
   assert.match(sent.instructions,/PARENT_REPORT/);assert.doesNotMatch(sent.instructions,/OTHER_CHILD_PRIVATE|FORGED_CONTEXT/);
   const update=await call({action:'update-guide',language});assert.match(update.session.liveInstructions,/PARENT_REPORT/);
   await call({sdp:'v=0',studentId:undefined,targetConfirmed:false,language});assert.doesNotMatch(sent.instructions,/PARENT_REPORT|Authorized opening brief/);
   const other=await call({action:'update-guide',studentId:'sam',language});assert.match(other.session.liveInstructions,/OTHER_CHILD_PRIVATE/);assert.doesNotMatch(other.session.liveInstructions,/PARENT_REPORT/);
  }
  const stale=await call({action:'prepare'});await f.history({action:'delete',id:'brief-history'});
  await call({sdp:'v=0',preparedContextId:stale.preparedContextId});assert.match(headers['Server-Timing'],/preparation;desc="miss"/);assert.doesNotMatch(sent.instructions,/PARENT_REPORT/);
  const beforeEdit=await call({action:'prepare'});
  await f.family('reader',{action:'save-student',student:{id:'alex',name:'Alex',stage:'Community college',interest:'UPDATED_INTEREST',gpa:'',color:'peach'}});
  await call({sdp:'v=0',preparedContextId:beforeEdit.preparedContextId});assert.match(sent.instructions,/UPDATED_INTEREST/);
  const foreign=await call({action:'prepare'});await call({sdp:'v=0',role:'student',routeConversations:false,preparedContextId:foreign.preparedContextId},'other');assert.doesNotMatch(sent.instructions,/UPDATED_INTEREST|PARENT_REPORT/);
  await f.save('new','POLICY_PROTECTED_HISTORY');const disabled=await call({action:'prepare'});env.ORIGEN_PERSONALIZATION_RETRIEVAL='false';
  await call({sdp:'v=0',preparedContextId:disabled.preparedContextId});assert.doesNotMatch(sent.instructions,/POLICY_PROTECTED_HISTORY/);assert.match(sent.instructions,/UPDATED_INTEREST/);
 }finally{await f.close();}
});

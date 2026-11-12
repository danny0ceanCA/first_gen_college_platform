import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpeningBrief,openingBriefInstructions,openingBriefLimit} from './voice-opening-brief.mjs';
import {studentLiveInstructions,studentLiveUpdate} from './student-live-session.mjs';
import {voicePayloadCases} from '../scripts/voice-payload-report.mjs';

const base=()=>({mode:'planning',role:'parent',routeConversations:true,targetConfirmed:true,studentId:'a',caller:{firstName:'Daniel'},profile:{id:'a',name:'Aiden',school:'Community college',goals:'Exploring transfer, not decided'},memory:[{id:'s',studentId:'a',date:'2026-11-01',summary:'A parent asked about essay ideas.'}],studentBrief:{memories:[],suppressedSummaryIds:[]}});
test('brief preserves the caller/student distinction, source and uncertainty in both languages',()=>{
 for(const language of ['en','es']){
  const input={...base(),language};input.openingBrief=buildOpeningBrief(input);
  const speech=studentLiveInstructions(input);
  assert.match(speech,/Daniel/);assert.match(speech,/Aiden/);assert.match(speech,/Exploring transfer, not decided/);
  assert.match(speech,/A parent asked about essay ideas/);assert.match(speech,/2026-11-01/);
  assert.match(speech,/"reportedBy":"unknown"/);assert.match(speech,/official-source tools/);
  assert.doesNotMatch(speech,/history are not supplied as speech context|Saved profiles, binder notes, past summaries and preferences are available only through the backend/);
  assert.match(speech,/No saving or sharing is authorized/);
 }
});
test('onboarding, unconfirmed target and mismatched profile never receive a brief',()=>{
 for(const change of [{onboarding:true},{collectAccount:true},{saveOnboarding:true},{mode:'profile'},{studentId:undefined},{targetConfirmed:false},{profile:{id:'b',name:'Other student'}}])assert.equal(buildOpeningBrief({...base(),...change}),undefined);
 const input=base();input.openingBrief=buildOpeningBrief(input);assert.equal(openingBriefInstructions({...input,studentId:'b'}),'');
 assert.equal(openingBriefInstructions({...input,targetConfirmed:false}),'');
});
test('historical quoted campus costs stay in storage but are not supplied as evidence to Live',()=>{
 for(const [language,summary,amount,topic] of [
  ['en','Discussed the UC Berkeley off-campus cost of $49,692. Aiden plans to rent.','49,692','Aiden plans to rent.'],
  ['es','Hablaron del costo de 44.760 dólares de UC Davis. Aiden piensa alquilar.','44.760','Aiden piensa alquilar.'],
 ]){
  const input={...base(),language};input.memory[0].summary=summary;
  input.openingBrief=buildOpeningBrief(input);
  const initial=studentLiveInstructions(input),refresh=studentLiveUpdate(input).liveContext.openingBrief.records[0].content;
  for(const context of [initial,refresh]){assert.ok(context.includes(topic));assert.ok(!context.includes(amount));}
  assert.equal(input.openingBrief.records[0].content,summary);
 }
});
test('withdrawn, suppressed, foreign and excessive records stay out; no sentence is cut',()=>{
 const input=base();input.studentBrief={suppressedSummaryIds:['s'],memories:[]};
 input.workspace={relatedCoordinatorGuidance:{body:'WITHDRAWN',withdrawn:true},notes:[{studentId:'b',content:'OTHER_STUDENT'},{content:'x'.repeat(1201)}]};
 const brief=buildOpeningBrief(input);assert.equal(brief.records.length,0);
 input.memory=Array.from({length:10},(_,i)=>({id:String(i),date:`2026-10-${String(i+1).padStart(2,'0')}`,summary:'Complete qualification: '+'a'.repeat(900)}));
 const next=buildOpeningBrief(input);assert.ok(JSON.stringify(next).length<=openingBriefLimit);assert.ok(next.records.length>0);
 assert.equal(next.records[0].content,input.memory[9].summary);assert.equal(next.records[0].source.ref,'9');
});
test('family scope excludes child profile and explicit child records; retrieval off carries only profile',()=>{
 const input=base();const family=buildOpeningBrief({...input,studentId:null});assert.deepEqual(family.profile,{});assert.deepEqual(family.records,[]);
 const limited=buildOpeningBrief(input,{history:false});assert.equal(limited.profile.name,'Aiden');assert.deepEqual(limited.records,[]);
});
test('coordinator suggestion remains attributed and unaccepted; current notes retain provenance',()=>{
 const input=base();input.workspace={relatedCoordinatorGuidance:{id:'c',version:2,body:'Consider comparing programs.',authorName:'Coordinator',createdAt:'2026-11-02',followThrough:{status:'deferred'}}};
 const brief=buildOpeningBrief(input),advice=brief.records[0];assert.equal(advice.kind,'coordinator-suggestion');assert.equal(advice.notAcceptedByDefault,true);assert.equal(advice.author,'Coordinator');assert.equal(advice.source.version,2);assert.equal(advice.followThrough.status,'deferred');
});
test('brief is bounded with maximum evidence and adds no tools or model calls',()=>{
 for(const {input} of voicePayloadCases()){
  const supplied={...input,openingBrief:buildOpeningBrief({...input,memory:base().memory})};
  const before=studentLiveInstructions(input),after=studentLiveInstructions(supplied);
  assert.ok(after.length-before.length<4500,'bounded incremental speech payload');
 }
});

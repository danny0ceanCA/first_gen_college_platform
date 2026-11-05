import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveInstructions} from './student-live-session.mjs';
import {boundedLiveRouting} from './live-delegation-policy.mjs';
for(const language of ['en','es'])test(`same-call ${language} update removes repeated style while keeping fresh scope, teachings and consent contracts`,()=>{
 const input={mode:'planning',role:'parent',language,routeConversations:true,targetConfirmed:true,continuing:true,studentId:'a',profile:{id:'a',name:'Aiden'},students:[{id:'a',name:'Aiden'}]};
 const teachings=[{id:'t',revision:2,content:{topic:'planning',title:'Support',deliveryStyle:'PATIENT_AND_WARM',conversationApproach:'CONCRETE_CHOICES'}}];
 const tools=[{name:'prepare_coordinator_review_request'},{name:'confirm_coordinator_review_request'}];
 const full=studentLiveInstructions(input,teachings,tools,boundedLiveRouting),compact=studentLiveInstructions(input,teachings,tools,boundedLiveRouting,{update:true});
 assert.ok(compact.length<full.length*.9,`${compact.length} / ${full.length}`);
 for(const text of ['Aiden','PATIENT_AND_WARM','CONCRETE_CHOICES','readback_required','including every note, recipient, expiry','only the app can verify consent','Do not reveal']){
  if(full.includes(text))assert.ok(compact.includes(text),text);
 }
 assert.match(compact,/scope, evidence, tool contracts, teachings and delegation policy supersede older versions/);
 assert.match(compact,/Do not restrict this to the immediately preceding answer/);
 assert.match(compact,/do not restart the greeting/);
});

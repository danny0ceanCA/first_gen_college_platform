import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveInstructions,studentLiveUpdate} from './student-live-session.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {boundedLiveRouting} from './live-delegation-policy.mjs';
for(const language of ['en','es'])test(`same-call ${language} update removes repeated style while keeping fresh scope, teachings and consent contracts`,()=>{
 const input={mode:'planning',role:'parent',language,routeConversations:true,targetConfirmed:true,continuing:true,studentId:'a',profile:{id:'a',name:'Aiden'},students:[{id:'a',name:'Aiden'}]};
 input.openingBrief=buildOpeningBrief(input);
 const teachings=[{id:'t',revision:2,content:{topic:'planning',title:'Support',deliveryStyle:'PATIENT_AND_WARM',conversationApproach:'CONCRETE_CHOICES'}}];
 const tools=[{name:'prepare_coordinator_review_request'},{name:'confirm_coordinator_review_request'}];
 const full=studentLiveInstructions(input,teachings,tools,boundedLiveRouting),update=studentLiveUpdate(input,teachings,tools,boundedLiveRouting),compact=update.liveInstructions;
 assert.ok(compact.length<full.length*.9,`${compact.length} / ${full.length}`);
 assert.ok(JSON.stringify(update).length<full.length*.25,'context plus new contracts remain substantially smaller than replaying the full prompt');
 for(const text of ['Aiden','PATIENT_AND_WARM','CONCRETE_CHOICES','readback_required','including every note, recipient, expiry','only the app can verify consent','Do not reveal']){
  if(full.includes(text))assert.ok(JSON.stringify(update).includes(text),text);
 }
 assert.doesNotMatch(compact,/Do not restrict this to the immediately preceding answer/,'unchanged conversation policy stays in startup context');
 assert.match(full,/without another greeting, confirmation or invitation/);
 const ordinary=studentLiveUpdate(input,teachings,[]);
 assert.equal(ordinary.liveInstructions,'','ordinary selection uses no trusted append');
 assert.ok(JSON.stringify(ordinary).length<3000,'small complete brief and teaching references');
});

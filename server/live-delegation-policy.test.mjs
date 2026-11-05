import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveRouting,baselineLiveRouting,boundedLiveRouting,liveDelegationInstructions} from './live-delegation-policy.mjs';
import {studentLiveSession,studentLiveInstructions} from './student-live-session.mjs';
import {voiceSession} from './profile-voice.mjs';
const input={mode:'planning',role:'student',language:'en',studentId:'synthetic',targetConfirmed:true,profile:{id:'synthetic',name:'Synthetic'}};
const config=()=>voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'});

test('cross-topic conversation does not force retrieval, while evidence and action boundaries remain',()=>{
 const speech=liveDelegationInstructions(boundedLiveRouting);
 assert.match(speech,/Respond directly to feelings, encouragement, reflection and phrasing help, even across topics/);
 assert.match(speech,/Topic changes alone do not require delegation/);
 assert.match(speech,/New or unverified college requirements/);
 assert.match(speech,/caller asks to review saved notes or earlier history/);
 assert.match(speech,/Delegate the complete mixed request/);
 assert.match(speech,/Never treat discussion as save consent/);
 assert.match(speech,/entire readback word for word, including its question and pronouns/);
 assert.match(speech,/For clarification_required, nothing was saved/);
 assert.match(speech,/Encouragement must not introduce unsupported claims/);
 assert.match(speech,/Missing information alone does not require a lookup/);
 assert.match(speech,/uncertainty supersedes an older account-confirmed note/);
 assert.match(speech,/Reuse already supplied history rather than retrieving it again/);
 assert.match(speech,/never use this shortcut for student scope, permissions or saving/);
 assert.doesNotMatch(speech,/including empathy about essays\/PIQs/);
 assert.ok(!voiceSession({...input,allowGuideHandoff:true},{OPENAI_MODEL_VOICE:'gpt-live-1'}).tools.some(t=>t.name==='switch_college_guide'));
 assert.match(liveDelegationInstructions(baselineLiveRouting),/Delegate substantive guidance/);
});

test('current-call follow-ups are the default on production and development Live calls',()=>{
 for(const env of [{},{NODE_ENV:'production',RENDER:'true',RENDER_SERVICE_ID:'service'},{NODE_ENV:'development',ORIGEN_LIVE_FOLLOWUPS:'false'}]){
  assert.equal(studentLiveRouting(config(),input,env),boundedLiveRouting);
  for(const change of [{continuing:true},{continuity:[{role:'user',text:'Same call'}]},{workspaceFocus:{kind:'note'}},{workspace:{selection:'note'}},{openingDecision:{claim:{id:'pending'}}},{studentId:null,role:'parent',routeConversations:true}])assert.equal(studentLiveRouting(config(),{...input,...change},env),boundedLiveRouting);
 }
 assert.equal(studentLiveRouting({...config(),model:'gpt-realtime-2.1'},input),baselineLiveRouting);
});
for(const [name,change] of Object.entries({onboarding:{onboarding:true},profile:{mode:'profile'},collectAccount:{collectAccount:true},saveProfile:{saveOnboarding:true},unknownRole:{role:'unknown'},unselectedStudent:{studentId:undefined},pendingScope:{targetConfirmed:false},unconfirmedParent:{role:'parent',routeConversations:true,targetConfirmed:undefined}}))test(`backend policy retained during ${name}`,()=>assert.equal(studentLiveRouting(config(),{...input,...change}),baselineLiveRouting));

for(const language of ['en','es'])test(`${language} research lets the same live voice support the caller without another delegation`,()=>{
 const i={...input,language},c=voiceSession(i,{OPENAI_MODEL_VOICE:'gpt-live-1'});
 for(const speech of [studentLiveSession(c,i).instructions,studentLiveInstructions({...i,continuing:true},[],c.tools,boundedLiveRouting,{update:true})]){
  assert.match(speech,/respond to their understandable comments.*promptly, without waiting for research/);
  assert.match(speech,/one useful, unanswered question/);
  assert.match(speech,/A pause alone is not a request for questions/);
  assert.match(speech,/Initial findings can be used while an app-confirmed recovery check continues/);
  assert.match(speech,/do not automatically expand it to every residency category/);
  assert.match(speech,/Listen when the person wants a moment/);
 }
 assert.match(c.instructions,/Keep the lookup question close to the caller's actual request/);
 assert.match(c.instructions,/name both campuses in institution/);
 assert.match(c.instructions,/without scripted hmm, uh or repeated Okay\/Alright acknowledgments/);
});

for(const language of ['en','es'])test(`${language} call-only speech keeps backend context and tool contracts`,()=>{
 const i={...input,language,profile:{...input.profile,goals:'PRIVATE_PROFILE_GOALS'},memory:[{id:'m',mode:'planning',date:'2026-11-01',summary:'PRIVATE_OLD_SUMMARY'}],studentBrief:{available:true,memories:[{id:'n',status:'confirmed',category:'goal',content:'PRIVATE_SAVED_MEMORY'}]},workspace:{available:true,selection:'note',notes:[{selected:true,content:'PRIVATE_BINDER_NOTE'}],actions:[{selected:true,title:'PRIVATE_BINDER_ACTION'}]}};
 const c=voiceSession(i,{OPENAI_MODEL_VOICE:'gpt-live-1'}),live=studentLiveSession(c,i);
 assert.equal(live.model,'gpt-live-1');assert.equal(live.delegation.responses.model,'gpt-6-luna');
 assert.equal(live.delegation.responses.instructions,c.instructions);
 assert.deepEqual(live.delegation.responses.tools.map(({strict,...tool})=>tool),c.tools);
 for(const text of ['PRIVATE_PROFILE_GOALS','PRIVATE_OLD_SUMMARY','PRIVATE_BINDER_NOTE'])assert.ok(c.instructions.includes(text),text);
 for(const speech of [live.instructions,studentLiveInstructions({...i,continuing:true},[],c.tools,boundedLiveRouting,{update:true})]){
  assert.doesNotMatch(speech,/PRIVATE_PROFILE_GOALS|PRIVATE_OLD_SUMMARY|PRIVATE_SAVED_MEMORY|PRIVATE_BINDER_NOTE|PRIVATE_BINDER_ACTION/);
  assert.match(speech,/Do not restrict this to the immediately preceding answer/);
  assert.match(speech,/caller asks to review saved notes or earlier history/);
  assert.match(speech,/Any action or response to a backend question that advances a workflow/);
  assert.match(speech,/Never paraphrase a mandatory disclosure/);
  assert.match(speech,/unfinished, interrupted, cancelled, failed or timed-out/);
 }
});

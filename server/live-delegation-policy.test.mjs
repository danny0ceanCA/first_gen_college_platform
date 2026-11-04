import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveRouting,baselineLiveRouting,boundedLiveRouting} from './live-delegation-policy.mjs';
import {studentLiveSession,studentLiveInstructions} from './student-live-session.mjs';
import {voiceSession} from './profile-voice.mjs';
const input={mode:'planning',role:'student',language:'en',studentId:'synthetic',targetConfirmed:true,profile:{name:'Synthetic'}};

test('current-call follow-ups are enabled for production Live calls and continuations',()=>{
 for(const env of [{},{NODE_ENV:'production',RENDER:'true'},{NODE_ENV:'development',ORIGEN_LIVE_FOLLOWUPS:'false'}])for(const change of [{},{continuing:true},{studentId:null,role:'parent',routeConversations:true}])assert.equal(studentLiveRouting({model:'gpt-live-1'},{...input,...change},env),boundedLiveRouting);
 assert.equal(studentLiveRouting({model:'gpt-realtime-2.1'},input),baselineLiveRouting);
});
for(const [name,change] of Object.entries({onboarding:{onboarding:true},profile:{mode:'profile'},collectAccount:{collectAccount:true},saveProfile:{saveOnboarding:true},unknownRole:{role:'unknown'},unselectedStudent:{studentId:undefined},pendingScope:{targetConfirmed:false},unconfirmedParent:{role:'parent',routeConversations:true,targetConfirmed:undefined}}))test(`workflow delegation retained during ${name}`,()=>assert.equal(studentLiveRouting({model:'gpt-live-1'},{...input,...change}),baselineLiveRouting));

for(const language of ['en','es'])test(`${language} Live reuses call evidence while saved binder context stays with Luna`,()=>{
 const i={...input,language,profile:{name:'Synthetic',goals:'PRIVATE_PROFILE_GOALS'},memory:[{id:'m',mode:'planning',date:'2026-11-01',summary:'PRIVATE_OLD_SUMMARY'}],studentBrief:{available:true,memories:[{id:'n',status:'confirmed',category:'goal',content:'PRIVATE_SAVED_MEMORY'}]},workspace:{available:true,selection:'note',notes:[{selected:true,content:'PRIVATE_BINDER_NOTE'}],actions:[{selected:true,title:'PRIVATE_BINDER_ACTION'}]}};
 const c=voiceSession(i,{OPENAI_MODEL_VOICE:'gpt-live-1'}),live=studentLiveSession(c,i);
 assert.equal(live.model,'gpt-live-1');assert.equal(live.audio.output.voice,'marin');assert.equal(live.delegation.responses.model,'gpt-6-luna');
 assert.equal(live.delegation.responses.instructions,c.instructions);
 assert.deepEqual(live.delegation.responses.tools.map(({strict,...tool})=>tool),c.tools);
 for(const text of ['PRIVATE_PROFILE_GOALS','PRIVATE_OLD_SUMMARY','PRIVATE_BINDER_NOTE'])assert.ok(c.instructions.includes(text),text);
 for(const speech of [live.instructions,studentLiveInstructions({...i,continuing:true})]){
  assert.doesNotMatch(speech,/PRIVATE_PROFILE_GOALS|PRIVATE_OLD_SUMMARY|PRIVATE_SAVED_MEMORY|PRIVATE_BINDER_NOTE|PRIVATE_BINDER_ACTION/);
  assert.match(speech,/Do not restrict this to the immediately preceding answer/);
  assert.match(speech,/caller asks to review saved notes or earlier history/);
  assert.match(speech,/Any action or response to a backend question that advances a workflow/);
  assert.match(speech,/Never paraphrase a mandatory disclosure/);
  assert.match(speech,/unfinished, interrupted, cancelled, failed or timed-out/);
 }
});

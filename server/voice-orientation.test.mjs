import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceOrientationData,voiceOrientationInstructions} from './voice-orientation.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {voiceSession} from './profile-voice.mjs';

const input={mode:'planning',language:'en',role:'parent',caller:{firstName:'Maya'},studentId:'s',targetConfirmed:true,routeConversations:true,students:[{id:'s',name:'Sofia'}],profile:{name:'Sofia',stage:'Community college',school:'Fictional Valley College',interest:'Environmental science',goals:'Compare transfer options',notes:'PRIVATE-NOTE',gpa:'PRIVATE-GPA'},experience:{usedApp:true,usedVoice:false}};
for(const language of ['en','es'])test(`first post-onboarding ${language} call knows the caller and profile before any recall request`,()=>{
 const session=studentLiveSession(voiceSession({...input,language},{}),{...input,language});
 for(const instructions of [session.instructions,session.delegation.responses.instructions]){
  assert.match(instructions,/Maya/);assert.match(instructions,/Sofia/);assert.match(instructions,/Fictional Valley College/);assert.match(instructions,/Compare transfer options/);
  assert.match(instructions,/RETURNING USER/);assert.match(instructions,/not a first meeting/);
  assert.doesNotMatch(instructions,/PRIVATE-NOTE|PRIVATE-GPA|CONTINUING LIVE CONVERSATION HANDOFF/);
 }
 assert.doesNotMatch(session.input[0].content[0].text,/introduce yourself as Origen/);
 assert.match(session.instructions,/delegate to the backend to check the full authorized context/);
 assert.doesNotMatch(session.delegation.responses.instructions,/delegate to the backend to check/);
});

test('unconfirmed parent scope has only caller identity; family scope never inherits the selected student profile',()=>{
 const memory=[{date:'2026-11-01',summary:'PRIVATE-STUDENT-HISTORY'}];
 const pending={...input,targetConfirmed:false,memory};
 assert.deepEqual(voiceOrientationData(pending),{caller:{name:'Maya',role:'parent'},scope:'unconfirmed'});
 const live=studentLiveSession(voiceSession(pending,{}),pending);
 assert.match(live.instructions,/Maya/);assert.match(live.instructions,/Sofia/);
 assert.doesNotMatch(live.instructions,/PRIVATE-STUDENT-HISTORY|Fictional Valley College|Compare transfer options/);
 const family=voiceOrientationData({...input,studentId:null,memory:[{date:'2026-11-01',summary:'Family-scope discussion'}]});
 assert.equal(family.profile,undefined);assert.equal(family.scope,'family');assert.match(JSON.stringify(family),/Family-scope discussion/);
});

test('bounded orientation preserves corrected evidence and newest summaries, excluding replaced sources',()=>{
 const profile={...input.profile,goals:'g'.repeat(2000)};
 const memories=[{id:'corrected',status:'confirmed',category:'goal',content:'Sofia is considering biology, not a decision.',speaker:'parent',reportedBy:'parent',updatedAt:'2026-11-01',summaryId:'old',sourceVersion:'v1',contextCurrent:true},{id:'superseded',status:'superseded',content:'SUPERSEDED'},{id:'proposal',status:'proposed',summaryId:'old',content:'REPLACED-PROPOSAL'}];
 const memory=Array.from({length:24},(_,i)=>({id:'summary-'+i,date:`2026-10-${String(i+1).padStart(2,'0')}`,summary:`Context ${i} `+'x'.repeat(1500)+` Still uncertain ${i}.`,mode:'planning'}));
 memory.push({id:'old',date:'2026-11-01',summary:'REPLACED-SUMMARY',mode:'planning'});
 const data=voiceOrientationData({...input,profile,memory,studentBrief:{available:true,suppressedSummaryIds:['old'],memories}});
 assert.equal(data.knownDetails.length,1);assert.equal(data.knownDetails[0].reportedBy,'parent');assert.match(data.knownDetails[0].content,/not a decision/);
 assert.equal(data.recentConversations.length,2);assert.match(data.recentConversations[0].summary,/Context 23/);assert.match(data.recentConversations[0].summary,/Still uncertain 23/);
 assert.match(data.profile.goals,/\[excerpt\]/);assert.ok(JSON.stringify(data).length<6500);
 assert.doesNotMatch(JSON.stringify(data),/SUPERSEDED|REPLACED-PROPOSAL|REPLACED-SUMMARY/);
 assert.equal(voiceOrientationData({...input,memory,liveMemoryReadEnabled:false}).recentConversations,undefined);
});

test('a selected binder item remains the opening focus without replaying onboarding or new reminders',()=>{
 const selected={selected:true,content:'Compare two possible campuses.',topic:'transfer',evidence:{reportedBy:'student',record:{version:2}}};
 const focused={...input,workspace:{available:true,selection:'note',topic:'transfer',notes:[selected,{selected:false,content:'UNSELECTED'}]},openingDecision:{opening:null,reason:'cooldown'}};
 const data=voiceOrientationData(focused);assert.deepEqual(data.selectedWork.items,[selected]);assert.doesNotMatch(JSON.stringify(data),/UNSELECTED/);
 const session=studentLiveSession(voiceSession(focused,{}),focused);
 assert.match(session.instructions,/Compare two possible campuses/);assert.match(session.instructions,/If opening is null/);assert.match(session.instructions,/cooldown/);
 for(const change of [{continuing:true},{scopeRestart:true},{continuity:[{role:'user',text:'Can we discuss transfer?'}]}]){
  const instructions=studentLiveSession(voiceSession({...input,...change},{}),{...input,...change}).instructions;
  assert.match(instructions,/CONTINUING LIVE CONVERSATION/);assert.doesNotMatch(instructions,/At the beginning of this new conversation/);
 }
 assert.equal(voiceOrientationData({...input,onboarding:true}),null);assert.equal(voiceOrientationInstructions({...input,mode:'profile'}),'');
});

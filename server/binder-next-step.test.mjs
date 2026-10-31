import test from 'node:test';
import assert from 'node:assert/strict';
import {rankBinderNextSteps,selectBinderOpening} from './binder-next-step.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';

const now=Date.parse('2026-10-31T15:00:00Z');
const scope={kind:'student',studentId:'alex'};
const action=(id,extra={})=>({title:id,action:id,status:'not-started',topic:'transfer',evidence:{record:{id,version:2},scope,review:'accepted-by-account'},...extra});
const question=(id,extra={})=>({kind:'question',content:id,topic:'transfer',evidence:{record:{id,version:3},scope,certainty:'unresolved'},...extra});
const guidance={id:'advice',version:2,kind:'suggested-step',body:'Compare transfer courses with Maria.',topic:'transfer',authorName:'Maria',organizationName:'Center',read:true,untrusted:true,evidence:{scope,category:'suggestion'}};
const base={mode:'planning',role:'student',language:'en',studentId:'alex',targetConfirmed:true,experience:{usedApp:true},workspace:{available:true,scope,actions:[],notes:[]}};
const input=(workspace,extra={})=>({...base,...extra,workspace:{...base.workspace,...workspace}});
const rank=value=>rankBinderNextSteps(value,{now});
const pick=value=>selectBinderOpening(value,{now});

test('ranker never turns private follow-through back into a fresh coordinator suggestion',()=>{
 for(const followThrough of [{state:'explored',steps:[]},{state:'deferred',steps:[]},{state:'available',steps:[{planStatus:'active',status:'complete'}]}]){
  assert.equal(pick(input({relatedCoordinatorGuidance:{...guidance,followThrough}})),null);
 }
 const result=rank(input({relatedCoordinatorGuidance:{...guidance,followThrough:{steps:[{planStatus:'active',status:'not-started'}]}},actions:[action('accepted-guidance')]}));
 assert.equal(result.length,1);assert.equal(result[0].kind,'action');
});

test('personal target dates prioritize accepted work without making an official deadline or completion claim',()=>{
 const selected=pick(input({actions:[action('ordinary'),action('soon',{personalTargetDate:'2026-11-03'})]}));
 assert.equal(selected.title,'soon');assert.deepEqual(selected.ranking.reasons,['accepted-unfinished-step','personal-target-within-week']);
 assert.equal(selected.status,'not-started');assert.equal(selected.evidence.record.version,2);
 const due=[['2026-10-30','personal-target-passed'],['2026-11-15','personal-target-within-month'],['2026-09-01',null],['2026-02-30',null],['invalid',null]];
 for(const [date,reason] of due){const [candidate]=rank(input({actions:[action('dated',{personalTargetDate:date})]}));assert.equal(candidate.ranking.reasons[1]||null,reason);}
});

test('confirmed student goals can prioritize a relevant unresolved question over generic work in either language',()=>{
 for(const content of ['I want to transfer into environmental science.','Quiero transferir para estudiar ciencias ambientales.']){
  const selected=pick(input({actions:[action('Compare majors',{topic:'options'})],notes:[question('Which transfer courses fit?')]},{studentBrief:{memories:[{category:'goal',status:'confirmed',speaker:'student',content,evidence:{scope}}]}}));
  assert.equal(selected.kind,'question');assert.ok(selected.ranking.reasons.includes('matches-confirmed-goal'));assert.equal(selected.evidence.certainty,'unresolved');
 }
 for(const extra of [{status:'proposed'},{speaker:'parent'},{reportedBy:'parent'},{evidence:{scope:{kind:'student',studentId:'sam'}}}]){
  const selected=pick(input({actions:[action('Compare majors',{topic:'options'})],notes:[question('Which transfer courses fit?')]},{studentBrief:{memories:[{category:'goal',status:'confirmed',speaker:'student',content:'Transfer courses',...extra}]}}));
  assert.equal(selected.kind,'action');
 }
});

test('coordinator suggestion remains optional attributed advice, below equally relevant student work',()=>{
 const selected=pick(input({relatedCoordinatorGuidance:guidance}));
 assert.equal(selected.kind,'coordinator-guidance');assert.equal(selected.authorName,'Maria');assert.equal(selected.evidence.category,'suggestion');assert.equal(selected.status,undefined);
 assert.equal(pick(input({relatedCoordinatorGuidance:guidance,notes:[question('Ask about courses')]})).kind,'question');
 for(const flag of ['hidden','withdrawn','connectionEnded'])assert.equal(pick(input({relatedCoordinatorGuidance:{...guidance,[flag]:true}})),null);
 assert.equal(pick(input({scope:{kind:'family',studentId:null},relatedCoordinatorGuidance:guidance})),null);
 assert.equal(pick(input({relatedCoordinatorGuidance:guidance},{role:'parent'})),null);
});

test('current request, explicit selection, onboarding, reconnect and refresh prevent unsolicited openings',()=>{
 const value=input({actions:[action('Do this')],relatedCoordinatorGuidance:guidance});
 for(const extra of [{continuity:[{role:'user',text:'Tell me about something else'}]},{routeConversations:true,targetConfirmed:false},{continuing:true},{scopeRestart:true},{workspaceRefreshOnly:true},{onboarding:true},{experience:{}}])assert.equal(pick({...value,...extra}),null);
 assert.equal(pick({...value,workspace:{...value.workspace,selection:'topic'}}),null);
});

test('excluded records and inferred recap questions cannot become next steps; selection never mutates data',()=>{
 const value=input({actions:[action('done',{status:'complete'}),action('set aside',{status:'deferred'}),action('unknown',{status:'invented'}),action('sibling',{evidence:{scope:{kind:'student',studentId:'sam'}}})],notes:[question('costs',{topic:'costs'})],conversationPoints:[question('Unreviewed recap')]});
 const original=structuredClone(value);assert.deepEqual(rank(value),[]);assert.deepEqual(value,original);
 const costs=input({actions:[action('transfer'),action('costs',{topic:'costs'})]},{mode:'finance'});assert.equal(pick(costs).title,'costs');
});

test('recency, deterministic ties, deduplication and evidence survive ranking',()=>{
 const value=input({notes:[question('Old',{updatedAt:'2025-01-01T00:00:00Z'}),question('Recent',{updatedAt:'2026-10-30T00:00:00Z'}),question('Recent',{updatedAt:'2026-10-30T00:00:00Z'})]});
 const results=rank(value);assert.equal(results.length,2);assert.equal(results[0].content,'Recent');assert.ok(results[1].ranking.reasons.includes('older-context'));
 assert.equal(pick(input({actions:[action('first'),action('second')]})).title,'first');
 assert.equal(rank(input({actions:[action('future',{updatedAt:'2099-01-01T00:00:00Z'})]}))[0].ranking.score,60);
});

test('Realtime and Live delegation receive the same ranked choice and student-control instructions in English and Spanish',()=>{
 for(const language of ['en','es']){
  const value=input({relatedCoordinatorGuidance:guidance},{language});
  const realtime=voiceSession(value,{}),live=studentLiveSession(realtime,value);
  assert.equal(live.delegation.responses.instructions,realtime.instructions);
  assert.match(realtime.instructions,/binder-next-step-v1/);assert.match(realtime.instructions,/optional-coordinator-suggestion/);
  assert.match(realtime.instructions,/only that candidate may be proactively offered/);
  assert.match(realtime.instructions,/No ranking authorizes a save/);
  assert.doesNotMatch(voiceSession({...value,adaptiveEnabled:false},{}).instructions,/binder-next-step-v1/);
  assert.doesNotMatch(voiceSession({...value,onboarding:true,mode:'profile'},{}).instructions,/binder-next-step-v1/);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {prepareTeachingAccess,selectConversationTeachings} from './teaching-library.mjs';
import {voiceBinderTopics} from '../src/voiceBinderTopics.mjs';
import {admissionsResearchRequest} from './admissions-research.mjs';
import {financeResearchRequest} from './finance-research.mjs';
import {researchModeForTool} from '../src/liveConversation.mjs';

const modes=['planning','finance','loans','admissions'];
const input={mode:'planning',role:'student',language:'en',studentId:'fictional',targetConfirmed:true,profile:{name:'Fictional',stage:'Graduate student'}};
for(const language of ['en','es'])test(`${language}: every topic starts with the same direct research capabilities and preserves scope/workflow restrictions`,()=>{
 for(const model of ['gpt-live-1','gpt-realtime-2.1']){
  let names;
  for(const mode of modes){
   const session=voiceSession({...input,mode,language,allowGuideHandoff:true},{OPENAI_MODEL_VOICE:model});
   const actual=session.tools.map(t=>t.name);
   if(names)assert.deepEqual(actual,names);names=actual;
   assert.ok(!actual.includes('switch_college_guide'));
   for(const name of ['lookup_financial_aid','lookup_college_applications','lookup_education_planning'])assert.ok(actual.includes(name));
   assert.ok(!actual.includes('propose_profile'));
   assert.match(session.instructions,/graduate or professional degrees/);
   assert.match(session.instructions,/never carry undergraduate aid or admissions rules into graduate study without checking/);
   assert.match(session.instructions,/Do not calculate or estimate an individual's SAI/);
   assert.match(session.instructions,/Campus housing, meal plans and insurance may be billed/);
   const live=studentLiveSession(session,{...input,mode,language});
   assert.deepEqual(live.delegation.responses.tools.map(t=>t.name),actual);
   if(model==='gpt-live-1')assert.match(live.instructions,/Topic changes alone do not require delegation/);
   assert.match(live.instructions,/first in the family only if they shared it/);
   assert.match(live.instructions,/occasionally check whether the explanation helped/);
  }
  const pending=voiceSession({...input,role:'parent',routeConversations:true,targetConfirmed:false,profile:{name:'PRIVATE_SENTINEL'},memory:[{summary:'PRIVATE_HISTORY'}]},{OPENAI_MODEL_VOICE:model});
  assert.equal(pending.tools.filter(t=>t.name.startsWith('lookup_')).length,0);assert.doesNotMatch(pending.instructions,/PRIVATE_SENTINEL|PRIVATE_HISTORY/);
  const onboarding=voiceSession({...input,mode:'profile',onboarding:true,collectAccount:true,saveOnboarding:true},{OPENAI_MODEL_VOICE:model});
  assert.equal(onboarding.tools.filter(t=>t.name.startsWith('lookup_')).length,0);
  assert.ok(onboarding.tools.some(t=>t.name==='review_onboarding_profile'));assert.ok(onboarding.tools.some(t=>t.name==='save_onboarding_profile'));
 }
});

test('a full topic round trip changes binder highlights without any configuration handoff',async()=>{
 const highlights=[];let turn=1;
 const controller=voiceBinderTopics({followGuide:false,getTurn:()=>turn,canApply:()=>true,getGuide:()=> 'planning',getFocusTopic:()=> 'transfer',highlight:topics=>{highlights.push(topics);return true;},switchGuide:()=>assert.fail('topic change must not update the model')});
 for(const topics of [['transfer'],['applications'],['costs'],['applications'],['options']]){assert.equal(await controller.update(topics,turn),true);turn++;}
 assert.deepEqual(highlights.at(-1),['options']);
 assert.equal(await controller.update(['costs'],turn-1),false);
 controller.stop();assert.equal(await controller.update(['costs'],turn),false);
 const source=await readFile(new URL('../src/ProfileVoice.tsx',import.meta.url),'utf8');assert.match(source,/followGuide:false/);assert.doesNotMatch(source,/This page has a different guide/);
 for(const entry of modes)assert.equal(researchModeForTool('lookup_financial_aid',entry),'finance','a loans entry must not strip the campus from later cost questions');
});

test('cross-topic published teachings are bounded, deduplicated and logged only when delivered',async()=>{
 const recorded=[],queried=[];
 const entry=(id,topic)=>({id,revision:1,content:{topic,explanation:`Teaching ${id}`,deliveryStyle:'Warm',conversationApproach:'One clear idea'}});
 const general=entry('general','general');
 const db={query:async(sql,args)=>{
  const payload=JSON.parse(args[0]);
  if(sql.includes('origen_record_teaching_access')){recorded.push(payload);return {rows:[]};}
  queried.push(payload);return {rows:[{data:[entry(payload.topic,payload.topic),general]}]};
 }};
 const access=await prepareTeachingAccess(db,{topic:'planning',language:'es',campus:'Example University',academicYear:'2026-27',retrieval:'guide',conversation:true},{model:'gpt-live-1',operation:'voice_start'});
 assert.deepEqual(access.entries.map(t=>t.id),['planning','admissions','finance','loans','general']);
 assert.ok(queried.every(q=>q.language==='es'&&q.campus==='Example University'&&q.academicYear==='2026-27'&&q.retrieval==='guide'));
 await access.finish('prepared');await access.finish('prepared');assert.equal(recorded.length,1);
 assert.deepEqual(recorded[0].entries,access.entries.map(({id,revision})=>({id,revision})));
 const large=entry('large','planning');large.content.explanation='x'.repeat(13000);
 const bounded=selectConversationTeachings([[large,...Array.from({length:8},(_,i)=>entry(`p${i}`,'planning'))],[entry('essay','admissions')]]);
 assert.ok(bounded.length<=6);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<12000);assert.ok(!bounded.some(t=>t.id==='large'));assert.ok(bounded.some(t=>t.id==='essay'));
});

test('a failed teaching topic does not discard other topics or fabricate delivery evidence',async()=>{
 const records=[];const db={query:async(sql,args)=>{const p=JSON.parse(args[0]);if(sql.includes('record_teaching')){records.push(p);return {rows:[]};}if(p.topic==='finance')throw Error('unavailable');return {rows:[{data:[{id:p.topic,revision:2,content:{topic:p.topic}}]}]};}};
 const access=await prepareTeachingAccess(db,{topic:'planning',conversation:true});await access.finish('prepared');
 assert.equal(records[0].availability,'unavailable');assert.ok(access.entries.some(t=>t.id==='admissions'));assert.ok(!access.entries.some(t=>t.id==='finance'));
});


test('advanced-degree research uses program-specific official sources without importing undergraduate rules',()=>{
 for(const language of ['en','es']){
  const input={question:'What should I check for a doctoral program?',institution:'Fictional University',language,purpose:'planning'};
  const admissions=admissionsResearchRequest({},input),finance=financeResearchRequest({},input);
  assert.match(admissions.instructions,/official graduate school and program admissions pages/);
  assert.match(admissions.instructions,/do not substitute undergraduate deadlines or criteria/);
  assert.match(admissions.instructions,/never generalize undergraduate requirements or aid eligibility to advanced degrees/);
  assert.match(finance.instructions,/do not assume undergraduate grant eligibility or guarantee funding/);
  assert.equal(admissions.tool_choice,'required');assert.equal(finance.tool_choice,'required');
 }
});

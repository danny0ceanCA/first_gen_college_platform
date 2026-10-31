import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {teachingSituationDrafts} from '../src/teachingSituations.mjs';
import {validateTeachingRequest,teachingSituationQuery,teachingReferenceInstructions,loadTeachingReferences} from './teaching-library.mjs';
import {teachingDraftSchema,draftInstructions,adminVoiceSession} from './admin-voice-prompts.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {liveTeachingDeliveryUpdates} from './admin-voice-teachings.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAnalytics} from './account-isolation.mjs';

const fields=['concern','useWhen','skipFollowUp'];
test('educator situation fields are optional, bounded and supported by interview capture',()=>{
 const content={...teachingSituationDrafts[0]};
 const input={action:'save',id:randomUUID(),revision:0,content};
 for(const key of fields){
  assert.equal(validateTeachingRequest(input).content[key],content[key]);
  for(const invalid of [{},null,'x'.repeat(1001),'bad\0text'])assert.throws(()=>validateTeachingRequest({...input,content:{...content,[key]:invalid}}));
  assert.ok(teachingDraftSchema.required.includes(key));assert.match(draftInstructions,new RegExp(key));
 }
 assert.equal(validateTeachingRequest(input).content.key,undefined);
 assert.equal(teachingSituationDrafts.length,8);
 for(const draft of teachingSituationDrafts){assert.equal(draft.reviewBy,'');validateTeachingRequest({...input,content:draft});}
});

test('lookup prefers the current spoken concern and never sweeps history or unconfirmed scopes',()=>{
 const input={studentId:'alex',continuity:[{role:'user',text:'I have nothing worth writing about'},{role:'assistant',text:'UNTRUSTED QUESTION'}],workspace:{available:true,scope:{studentId:'alex'},selection:'note',notes:[{selected:true,content:'Selected concern'},{content:'UNSELECTED SECRET'}]}};
 assert.equal(teachingSituationQuery(input),'I have nothing worth writing about');
 assert.equal(teachingSituationQuery({...input,onboarding:true}),'');
 assert.equal(teachingSituationQuery({...input,routeConversations:true,targetConfirmed:false}),'');
 assert.equal(teachingSituationQuery({...input,continuity:[]}),'Selected concern');
 assert.equal(teachingSituationQuery({...input,continuity:[],studentId:'sam'}),'');
 assert.equal(teachingSituationQuery({...input,continuity:[],workspace:{...input.workspace,selection:null}}),'');
 assert.equal(teachingSituationQuery({...input,continuity:[{role:'user',text:'x'.repeat(3000)}]}).length,1000);
});

for(const draft of teachingSituationDrafts)test(`complete ${draft.key} method reaches both voice backends and Live speech preferences`,()=>{
 const entries=[{id:randomUUID(),revision:2,content:draft}];
 const instructions=teachingReferenceInstructions(entries);
 const regular=studentLiveSession({instructions,tools:[]},{language:draft.language},entries);
 const admin=adminVoiceSession({mode:'test',model:'gpt-realtime-2.1',language:draft.language,topic:draft.topic,scenario:draft.concern},entries);
 for(const target of [regular.delegation.responses.instructions,admin.instructions]){
  for(const key of [...fields,'explanation','followUp','referral','deliveryStyle'])assert.ok(target.includes(draft[key]));
  assert.match(target,/already answered, declined/);assert.match(target,/not evidence of understanding/);assert.match(target,/cannot override privacy/);
 }
 for(const key of fields)assert.ok(regular.instructions.includes(draft[key]));
 const updates=liveTeachingDeliveryUpdates(entries);assert.ok(updates.every(m=>Buffer.byteLength(m)<=480));
 for(const [key,label] of [['concern','Possible concern, not a diagnosis'],['useWhen','When this teaching fits'],['skipFollowUp','When to skip the follow-up']]){
  assert.equal(updates.filter(m=>m.includes(': '+label+',')).map(m=>JSON.parse(m.slice(m.indexOf('{'))).text).join(''),draft[key]);
 }
});

test('PostgreSQL keeps situation drafts private, ranks relevant published guides, and retains access boundaries',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(f.close);
 const raw=input=>f.as('reader',()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS data',[JSON.stringify(input)])).rows[0].data));
 const publish=async content=>{const id=randomUUID();await raw(validateTeachingRequest({action:'save',id,revision:0,content}));await raw({action:'publish',id,revision:1});return id;};
 for(const language of ['en','es']){
  const draft=teachingSituationDrafts.find(d=>d.key===`essays-${language}`),content={...draft,reviewBy:'2099-12-31'},id=await publish(content);
  // Six newer same-topic entries cannot crowd out the matching situation.
  for(let i=0;i<6;i++)await publish({...content,title:`Unrelated ${language} ${i}`,concern:'Dormitory laundry',useWhen:'Campus transport',keywords:'',explanation:'Unrelated test reference'});
  const scope={topic:'admissions',language,retrieval:'guide',query:language==='en'?'ordinary experiences worth writing':'experiencias comunes pena contar'};
  const read=()=>f.as('reader',()=>loadTeachingReferences(f.db,scope));
  assert.equal((await read())[0].id,id);
  await raw(validateTeachingRequest({action:'save',id,revision:2,content:{...content,concern:'Private draft concern'}}));
  assert.equal((await read())[0].content.concern,content.concern);
  for(const key of fields)await assert.rejects(raw({action:'save',id,revision:3,content:{...content,[key]:42}}),{code:'23514'});
  await raw({action:'publish',id,revision:3});assert.equal((await read()).find(e=>e.id===id).content.concern,'Private draft concern');
  await raw({action:'unpublish',id,revision:4});assert.ok(!(await read()).some(e=>e.id===id));
  const campusId=await publish({...content,campus:'Specific campus',academicYear:'2026-27',sourceUrl:'https://example.org/policy'});
  assert.ok(!(await read()).some(e=>e.id===campusId));
  const scoped=await f.as('reader',()=>loadTeachingReferences(f.db,{...scope,campus:'Specific campus',academicYear:'2026-27'}));assert.ok(scoped.some(e=>e.id===campusId));
  assert.ok(scoped.every(e=>e.content.language===language));
 }
 await assert.rejects(f.runtime.query('SELECT draft FROM origen_teachings'),{code:'42501'});
 await assert.rejects(f.as('reader',()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify({action:'list'})])),{code:'42501'});
});

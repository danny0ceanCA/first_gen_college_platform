import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {adaptiveGuidance} from './adaptive-guidance.mjs';
import {loadVoiceWorkspace,validateWorkspaceFocus} from './voice-workspace.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createTopicRepository,createTopicService} from './topic-notes.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {voiceHistoryQuery} from './history-retrieval.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const output=text=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text}]}]}));
async function call(f,handler,path,body,sub='reader'){
 const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{url:path,method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub}});
 let status,data;await f.as(sub,()=>handler(req,{writeHead(s){status=s;},end(raw){data=JSON.parse(raw);}},()=>assert.fail('route missed')));return {status,data};
}
const input={sdp:'v=0',mode:'planning',role:'parent',language:'en',routeConversations:true,targetConfirmed:true,studentId:'alex'};
const plan=()=>({studentId:'alex',title:'Next steps',goal:'',category:'education',status:'active',summaryIds:[],steps:[{id:'step',title:'Ask about evening classes',action:'Ask about evening classes',notes:'',status:'not-started',dueDate:null,sources:[]}]});

test('adaptive openings use one actionable item, respect selection/continuation, and never elevate proposed preferences',()=>{
 const base={role:'student',experience:{usedApp:true},studentBrief:{memories:[{status:'proposed',category:'preference',content:'INFERRED'},{status:'confirmed',category:'preference',speaker:'parent',content:'PARENT STYLE'},{status:'confirmed',category:'preference',speaker:'student',content:'Short explanations with examples'}]},workspace:{actions:[{status:'deferred',title:'DEFERRED'},{status:'complete',title:'COMPLETE'},{status:'not-started',title:'CURRENT'},{status:'in-progress',title:'SECOND'}],notes:[{kind:'question',content:'QUESTION'}]}};
 const data=adaptiveGuidance(base);assert.equal(data.preferences.length,1);assert.equal(data.opening.title,'CURRENT');assert.doesNotMatch(JSON.stringify(data),/INFERRED|PARENT STYLE|DEFERRED|COMPLETE|SECOND/);
 for(const override of [{continuing:true},{continuity:[{role:'user',text:'Current priority'}]},{workspace:{...base.workspace,selection:'point'}}])assert.equal(adaptiveGuidance({...base,...override}).opening,null);
 assert.equal(adaptiveGuidance({...base,workspace:{notes:base.workspace.notes,actions:[]}}).opening.content,'QUESTION');
 assert.equal(adaptiveGuidance({...base,experience:{}}).opening,null);
});

test('all specialties receive current scoped preferences; forged context and parent routing cannot leak a sibling',enabled,async()=>{
 const f=await retrievalFixture();const configs=[];
 try{
  const id=randomUUID();await f.memory({action:'create',studentId:'alex',id,memory:{category:'preference',speaker:'parent',language:'es',content:'Prefiero ejemplos cortos, paso a paso.'}});
  await f.memory({action:'create',studentId:'sam',id:randomUUID(),memory:{category:'preference',speaker:'parent',language:'en',content:'SIBLING_PRIVATE_STYLE'}});
  const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(u,o)=>{configs.push(JSON.parse(o.body.get('session')));return new Response('v=0');},()=>{},f.db);
  for(const mode of ['planning','finance','loans','admissions'])for(const language of ['en','es']){
   assert.equal((await call(f,handler,'/api/profile-voice',{...input,mode,language,studentBrief:{memories:[{content:'FORGED'}]}})).status,200);
   const prompt=configs.at(-1).instructions;assert.match(prompt,/ADAPTIVE GUIDANCE/);assert.match(prompt,/Prefiero ejemplos cortos/);assert.doesNotMatch(prompt,/SIBLING_PRIVATE_STYLE|FORGED/);
  }
  await f.memory({action:'update',studentId:'alex',id,version:1,memory:{category:'preference',speaker:'parent',language:'en',content:'Please give detailed explanations.'}});
  await call(f,handler,'/api/profile-voice',input);assert.match(configs.at(-1).instructions,/Please give detailed/);assert.doesNotMatch(configs.at(-1).instructions,/Prefiero ejemplos cortos/);
  await call(f,handler,'/api/profile-voice',{...input,targetConfirmed:false});assert.doesNotMatch(configs.at(-1).instructions,/Please give detailed|SIBLING_PRIVATE_STYLE|ADAPTIVE GUIDANCE/);
 }finally{await f.close();}
});

test('deferred actions persist with versions and attribution, disappear from openings, and can be resumed explicitly',enabled,async()=>{
 const f=await retrievalFixture();const plans=body=>f.as('reader',()=>createPlanRepository(f.db,{PROGRESS_HISTORY_ENABLED:'true'})('reader',validatePlan(body)));
 const workspace=()=>f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'admissions'}));
 try{
  const p={...plan(),category:'applications'},requestId=randomUUID();let saved=(await plans({action:'create',requestId,plan:p})).plans[0];
  assert.equal((await workspace()).actions[0].title,p.steps[0].title);
  saved=(await plans({action:'update',id:saved.id,version:saved.version,plan:{...saved,steps:[{...saved.steps[0],status:'deferred'}]}})).plans[0];
  assert.equal(saved.steps[0].status,'deferred');assert.equal(saved.version,2);
  assert.equal((await f.owner.query("SELECT reported_status FROM origen_step_transitions WHERE kind='status-changed'")).rows[0].reported_status,'deferred');
  assert.equal(adaptiveGuidance({experience:{usedApp:true},workspace:await workspace()}).opening,null);
  await assert.rejects(plans({action:'update',id:saved.id,version:1,plan:p}),{status:409});
  assert.equal((await plans({action:'create',requestId,plan:p})).plans.length,1); // replay never resets deferral
  const selected=await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'admissions',focus:{kind:'action',topic:'applications',studentId:'alex',planId:saved.id,stepId:'step',version:2}}));assert.equal(selected.actions[0].status,'deferred');
  await plans({action:'update',id:saved.id,version:2,plan:{...saved,steps:[{...saved.steps[0],status:'not-started'}]}});
  assert.equal(adaptiveGuidance({experience:{usedApp:true},workspace:await workspace()}).opening.status,'not-started');
 }finally{await f.close();}
});

test('Talk about this carries an unreviewed point with its source, excludes siblings, and rejects stale or removed evidence',enabled,async()=>{
 const f=await retrievalFixture();
 try{
  const summary='The student asked about evening laboratories and tuition. No course was approved.';await f.save('source',summary);
  const result=await f.as('reader',()=>createTopicRepository(f.db)('reader',{action:'store-suggestions',studentId:'alex',summaryId:'source',language:'en',fingerprint:digest(summary),notes:[{topic:'transfer',kind:'question',content:'Are evening laboratories available?',quote:'The student asked about evening laboratories and tuition.'}]}));
  const note=result.notes[0],focus=validateWorkspaceFocus({kind:'point',studentId:'alex',topic:'transfer',noteId:note.id,version:1});
  const load=(selection=focus)=>f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:selection.studentId,mode:'planning',focus:selection}));
  const context=await load();assert.equal(context.notes.length,0);assert.equal(context.conversationPoints[0].selected,true);assert.equal(context.conversationPoints[0].reviewedByUser,false);assert.equal(context.sourceSummary.summary,summary);
  assert.equal(voiceHistoryQuery({workspace:context,workspaceFocus:focus}).query,'Are evening laboratories available?');
  assert.equal((await f.note({action:'load',studentId:'alex'})).notes[0].status,'suggested');
  await assert.rejects(load({...focus,studentId:'sam'}),{status:404});await assert.rejects(load({...focus,version:2}),{status:409});
  await f.history({action:'delete',id:'source'});await assert.rejects(load(),{status:404});
 }finally{await f.close();}
});

test('summary failure remains unsaved; retry and topic extraction preserve one narrative and source-linked points',enabled,async()=>{
 const f=await retrievalFixture();let fail=true,generated=0;const narrative='We compared nursing programs and evening laboratories. Tuition still needs checking with the college.';
 try{
  const handler=createSummaryHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{generated++;return fail?new Response('',{status:503}):output(narrative);},f.db);
  const body={id:randomUUID(),studentId:'alex',date:new Date().toISOString(),mode:'planning',language:'en',sources:[],turns:[{role:'user',text:'Compare nursing programs and evening labs.'},{role:'assistant',text:'We still need to check tuition.'}]};
  assert.equal((await call(f,handler,'/api/conversation-summary',body)).status,502);assert.equal((await f.history({action:'load',studentId:'alex'})).items.length,0);
  fail=false;assert.equal((await call(f,handler,'/api/conversation-summary',body)).status,200);assert.equal((await call(f,handler,'/api/conversation-summary',body)).status,200);assert.equal(generated,2);
  let extractions=0;const service=createTopicService(f.db,{ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async()=>{extractions++;return output(JSON.stringify({notes:[{topic:'options',kind:'explanation',content:'Nursing programs were compared.',quote:'We compared nursing programs and evening laboratories.'},{topic:'costs',kind:'question',content:'Check tuition with the college.',quote:'Tuition still needs checking with the college.'}]}));});
  const sync=()=>f.as('reader',()=>service('reader',{action:'sync',studentId:'alex',language:'en'}));
  const one=await sync(),two=await sync();assert.equal(extractions,1);assert.equal(two.notes.length,2);assert.deepEqual(one.notes.map(n=>n.id),two.notes.map(n=>n.id));assert.ok(two.notes.every(n=>n.status==='suggested'&&n.summaryId===body.id));
  assert.deepEqual((await f.history({action:'load',studentId:'alex'})).items.map(i=>i.summary),[narrative]);
 }finally{await f.close();}
});

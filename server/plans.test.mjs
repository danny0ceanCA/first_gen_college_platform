import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './family-fixture.mjs';
import {createPlanRepository,validatePlan,createPlanHandler} from './plans.mjs';
import {createHistoryRepository} from './history.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {Readable} from 'node:stream';
const student={id:'one',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};
const plan={studentId:'one',title:'Next semester',goal:'Explore engineering',category:'courses',status:'active',summaryIds:[],steps:[{id:'step-1',title:'Meet counselor',action:'Review science courses',notes:'Approval not yet checked',status:'not-started',dueDate:'2026-11-01',sources:[{title:'UC courses',url:'https://hs-articulation.ucop.edu/agcourselist'}]}]};
test('plans isolate accounts and targets, persist ordered steps and reject stale edits atomically',async()=>{
 const {pool,run}=await fixture();const repository=createPlanRepository(pool);
 const call=(sub,input)=>repository(sub,validatePlan(input));
 try{
  await run('auth0|one',{action:'save-student',student});await run('auth0|two',{action:'save-student',student});
  let result=await call('auth0|one',{action:'create',plan});const saved=result.plans[0];
  assert.equal(saved.version,1);assert.deepEqual(saved.steps,plan.steps);
  assert.deepEqual((await call('auth0|two',{action:'load'})).plans,[]);
  await assert.rejects(call('auth0|two',{action:'update',id:saved.id,version:1,plan}),{status:404});
  await assert.rejects(call('auth0|one',{action:'create',plan:{...plan,studentId:'foreign'}}),{status:404});
  result=await call('auth0|one',{action:'update',id:saved.id,version:1,plan:{...plan,steps:[{...plan.steps[0],status:'complete'}]}});
  assert.equal(result.plans[0].version,2);assert.equal(result.plans[0].steps[0].status,'complete');
  await assert.rejects(call('auth0|one',{action:'update',id:saved.id,version:1,plan}),{status:409});
  await assert.rejects(call('auth0|one',{action:'update',id:saved.id,version:2,plan:{...plan,studentId:null}}),{status:409});
  assert.equal((await call('auth0|one',{action:'load'})).plans[0].steps[0].status,'complete');
  await run('auth0|one',{action:'delete-student',id:'one'});
  assert.deepEqual((await call('auth0|one',{action:'load'})).plans,[]);
  assert.equal((await pool.query('SELECT * FROM origen_plan_sources')).rows.length,0);
 }finally{await pool.end();}
});

test('conversation references match the plan target; deleting history preserves the plan',async()=>{
 const {pool,run}=await fixture();const repository=createPlanRepository(pool),history=createHistoryRepository(pool);
 try{
  await run('auth0|one',{action:'save-student',student});
  const item={id:'summary',studentId:'one',mode:'planning',date:'2026-10-03T12:00:00Z',summary:'Ask counselor about science',sources:[]};
  await history('auth0|one',{action:'save',item});
  let saved=(await repository('auth0|one',validatePlan({action:'create',plan:{...plan,summaryIds:['summary']}}))).plans[0];
  assert.deepEqual(saved.summaryIds,['summary']);
  await assert.rejects(repository('auth0|one',validatePlan({action:'create',plan:{...plan,studentId:null,summaryIds:['summary']}})),{status:400});
  await history('auth0|one',{action:'delete',id:'summary'});
  saved=(await repository('auth0|one',{action:'load'})).plans[0];assert.deepEqual(saved.summaryIds,[]);assert.equal(saved.steps.length,1);
  await history('auth0|one',{action:'save',item:{...item,id:'family',studentId:null}});
  await repository('auth0|one',validatePlan({action:'create',plan:{...plan,studentId:null,summaryIds:['family']}}));
  assert.equal((await repository('auth0|one',{action:'load',studentId:null})).plans.length,1);
  await pool.query('DELETE FROM origen_accounts WHERE auth0_subject=$1',['auth0|one']);
  for(const table of ['origen_plans','origen_plan_steps','origen_plan_sources','origen_plan_conversations','origen_conversation_summaries'])assert.equal((await pool.query(`SELECT * FROM ${table}`)).rows.length,0);
 }finally{await pool.end();}
});

test('plans validate dates, duplicate steps, sources, versions and require authentication',async()=>{
 for(const invalid of [{...plan,steps:[{...plan.steps[0],dueDate:'2026-02-30'}]},{...plan,steps:[plan.steps[0],plan.steps[0]]},{...plan,steps:[{...plan.steps[0],sources:[{title:'Bad',url:'javascript:alert(1)'}]}]}])assert.throws(()=>validatePlan({action:'create',plan:invalid}),{status:400});
 assert.throws(()=>validatePlan({action:'update',id:crypto.randomUUID(),version:0,plan}),{status:400});
 let status;await createPlanHandler(null)({url:'/api/plans',method:'POST'},{writeHead(s){status=s;},end(){}},()=>assert.fail());assert.equal(status,401);
});

test('planning voice uses server plans only for the confirmed account and target',async()=>{
 const {pool,run}=await fixture(),plans=createPlanRepository(pool);
 try{
  await run('auth0|one',{action:'save-student',student});await run('auth0|one',{action:'save-student',student:{...student,id:'two',name:'Mateo'}});
  await plans('auth0|one',validatePlan({action:'create',plan:{...plan,title:'Sofia active plan'}}));
  await plans('auth0|one',validatePlan({action:'create',plan:{...plan,title:'Sofia archived plan',status:'archived'}}));
  await plans('auth0|one',validatePlan({action:'create',plan:{...plan,title:'Mateo private plan',studentId:'two'}}));
  await plans('auth0|one',validatePlan({action:'create',plan:{...plan,title:'General family plan',studentId:null}}));
  let session;
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(url,options)=>{session=JSON.parse(options.body.get('session'));return new Response('v=0\r\nanswer');},()=>{},pool);
  async function call(targetConfirmed,studentId){let status;await handler(Object.assign(Readable.from([JSON.stringify({sdp:'v=0',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed,studentId,plans:[{title:'FORGED'}]})]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'auth0|one'}}),{writeHead(s){status=s;},end(){}},()=>assert.fail());assert.equal(status,200);}
  await call(false,undefined);assert.doesNotMatch(session.instructions,/Sofia active plan|FORGED/);
  await call(true,'one');assert.match(session.instructions,/Sofia active plan/);assert.doesNotMatch(session.instructions,/Mateo private plan|Sofia archived plan|General family plan|FORGED/);
  await call(true,null);assert.match(session.instructions,/General family plan/);assert.doesNotMatch(session.instructions,/Sofia active plan|Mateo private plan|FORGED/);
 }finally{await pool.end();}
});

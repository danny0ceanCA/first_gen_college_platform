import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLinksRepository} from './account-links.mjs';
import {progressReport} from './progress-report.mjs';
import {createDatabase,migrateDatabase} from './database.mjs';
import {fixture} from './family-fixture.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createProgressRepository,validateProgress,assertProgressConfiguration,createProgressHandler} from './progress-history.mjs';
const env={PROGRESS_HISTORY_ENABLED:'true'};
const student={id:'one',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach',notes:'Private'};
const step=(id,status='not-started')=>({id,title:id,action:'Meet counselor',notes:'',status,dueDate:null,sources:[]});
const plan={studentId:'one',title:'Semester',goal:'Explore',category:'courses',status:'active',summaryIds:[],steps:[step('a'),step('b')]};
async function setup(){const f=await fixture();await f.pool.query(await readFile(new URL('./migrations/016_progress_history.sql',import.meta.url),'utf8'));return {...f,family:createFamilyRepository(f.pool,env),plans:createPlanRepository(f.pool,env),progress:createProgressRepository(f.pool)};}
test('accepted profile observations omit private notes and existing imports, with account scoped export and erasure',async()=>{
 const f=await setup();try{
  await f.family('owner',validateFamily({action:'save-student',student}));
  await f.family('other',validateFamily({action:'save-student',student}));
  await f.family('owner',validateFamily({action:'save-student',student:{...student,stage:'11th grade'}}));
  await f.family('owner',validateFamily({action:'import',source:'web',account:{firstName:'Test',email:''},students:[{...student,stage:'12th grade'}]}));
  const data=await f.progress('owner',{action:'load'});
  assert.equal(data.observations.filter(x=>x.field==='stage').length,2);
  assert.ok(data.observations.some(x=>x.field==='stage'&&x.previous_value==='10th grade'&&x.reported_value==='11th grade'));
  assert.ok(data.observations.every(x=>!['name','color','notes','needs'].includes(x.field)));
  const exported=await createLifecycleRepository(f.pool)('owner',{action:'export'});
  assert.equal(exported.formatVersion,3);assert.equal(exported.progress.origen_profile_observations.length,data.observations.length);
  await f.family('owner',validateFamily({action:'delete-student',id:'one'}));
  assert.equal((await f.progress('owner',{action:'load'})).observations.length,0);
  assert.ok((await f.progress('other',{action:'load'})).observations.length>0);
 }finally{await f.pool.end();}
});
test('plan revisions survive replacement, reorder, completion, reopening and removal; stale updates add no history',async()=>{
 const f=await setup();try{
  await f.run('owner',{action:'save-student',student});
  let p=(await f.plans('owner',validatePlan({action:'create',plan}))).plans[0];
  const update=async steps=>{p=(await f.plans('owner',validatePlan({action:'update',id:p.id,version:p.version,plan:{...plan,steps}}))).plans[0];};
  await update([step('b'),step('a')]);
  let history=await f.progress('owner',{action:'load'});assert.equal(history.transitions.length,2);
  await update([step('a','complete'),step('b')]);
  await update([step('a','in-progress')]);
  history=await f.progress('owner',{action:'load'});
  assert.equal(history.revisions.length,4);
  assert.ok(history.transitions.some(x=>x.previous_status==='complete'&&x.reported_status==='in-progress'));
  assert.ok(history.transitions.some(x=>x.step_id==='b'&&x.kind==='removed'));
  await assert.rejects(f.plans('owner',validatePlan({action:'update',id:p.id,version:1,plan})),{status:409});
  assert.equal((await f.progress('owner',{action:'load'})).revisions.length,4);
  await f.run('other',{action:'save-student',student});
  assert.deepEqual((await f.progress('other',{action:'load'})).revisions,[]); 
  await f.plans('owner',validatePlan({action:'delete',id:p.id,version:p.version}));
  const erased=await f.progress('owner',{action:'load'});assert.equal(erased.revisions.length,0);assert.equal(erased.transitions.length,0);
 }finally{await f.pool.end();}
});
test('feedback retries are idempotent, declined is not zero, target and verified claims are rejected',async()=>{
 const f=await setup();try{
  await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student:{...student,id:'foreign'}});
  const report={action:'record',id:crypto.randomUUID(),studentId:'one',kind:'feedback',responseStatus:'declined',value:null,language:'es'};
  await f.progress('owner',validateProgress(report));await f.progress('owner',validateProgress(report));
  const data=await f.progress('owner',{action:'load'});assert.equal(data.reports.length,1);assert.equal(data.reports[0].value,null);assert.equal(data.reports[0].definition_version,1);
  const aggregate=await progressReport(f.pool);assert.equal(aggregate.feedbackSubmissions,1);assert.equal(aggregate.answeredSubmissions,0);assert.equal(aggregate.missingness.notAsked,null);
  await assert.rejects(f.progress('owner',validateProgress({...report,value:'helpful',responseStatus:'answered'})),{status:409});
  await assert.rejects(f.progress('owner',validateProgress({...report,id:crypto.randomUUID(),studentId:'foreign'})),{status:404});
  assert.throws(()=>validateProgress({...report,verified:true}),{status:400});
  assert.throws(()=>validateProgress({...report,value:0}),{status:400});
  await createLifecycleRepository(f.pool)('owner',{action:'delete',confirmation:'DELETE'});
  assert.equal((await f.pool.query('SELECT * FROM origen_progress_reports')).rows.length,0);
 }finally{await f.pool.end();}
});
test('collection is gated, production needs ownership and preview cannot write',async()=>{
 assert.throws(()=>assertProgressConfiguration({...env,NODE_ENV:'production'}));
 let status;await createProgressHandler(null,env)({url:'/api/progress',origenPreview:true},{writeHead(s){status=s;},end(){}},()=>assert.fail());assert.equal(status,401);
});

test('linked academic edits record canonical provenance without sharing private history',async()=>{
 const f=await setup();try{
  await f.family('owner',validateFamily({action:'save-student',student}));
  await f.run('member',{action:'load'});
  const links=createLinksRepository(f.pool);const invite=await links('owner',{action:'create',studentId:'one',role:'student'});
  const accepted=await links('member',{action:'accept',token:invite.token});
  const shared=(await f.run('member',{action:'load'})).students.find(x=>x.id===accepted.studentId);
  await f.family('member',validateFamily({action:'save-student',student:{...shared,stage:'11th grade',notes:'MEMBER PRIVATE'}}));
  const owner=await f.progress('owner',{action:'load'}),member=await f.progress('member',{action:'load'});
  assert.ok(owner.observations.some(x=>x.field==='stage'&&x.origin==='linked-account'&&x.reported_value==='11th grade'));
  assert.equal(member.observations.length,0);
  assert.doesNotMatch(JSON.stringify(owner),/MEMBER PRIVATE/);
 }finally{await f.pool.end();}
});

test('PostgreSQL concurrent plan saves accept one version and history failure rolls back the current plan',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const pool=createDatabase({DATABASE_URL:process.env.DATABASE_TEST_URL});
 const schema=`origen_progress_${crypto.randomUUID().replaceAll('-','')}`;
 let created=false;
 const scoped={connect:async()=>{const c=await pool.connect();try{await c.query(`SET search_path TO ${schema}`);return c;}catch(error){c.release();throw error;}},query:async(...args)=>{const c=await scoped.connect();try{return await c.query(...args);}finally{c.release();}}};
 try{
  await pool.query(`CREATE SCHEMA ${schema}`);created=true;await migrateDatabase(scoped);
  await createFamilyRepository(scoped,env)('owner',validateFamily({action:'save-student',student}));
  const plans=createPlanRepository(scoped,env);
  const saved=(await plans('owner',validatePlan({action:'create',plan}))).plans[0];
  const edit=validatePlan({action:'update',id:saved.id,version:1,plan:{...plan,steps:[step('a','complete')]}});
  const results=await Promise.allSettled([plans('owner',edit),plans('owner',edit)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
  assert.equal(Number((await scoped.query('SELECT count(*) AS count FROM origen_plan_revisions')).rows[0].count),2);
  const failing={connect:async()=>{const c=await scoped.connect();return {release:()=>c.release(),query:(sql,...args)=>{if(sql.startsWith('INSERT INTO origen_plan_revisions'))throw new Error('synthetic history failure');return c.query(sql,...args);}};}};
  await assert.rejects(createPlanRepository(failing,env)('owner',validatePlan({...edit,version:2})),/synthetic history failure/);
  const latest=(await plans('owner',{action:'load'})).plans[0];assert.equal(latest.version,2);
  assert.equal(Number((await scoped.query('SELECT count(*) AS count FROM origen_plan_revisions')).rows[0].count),2);
 }finally{if(created)await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
});

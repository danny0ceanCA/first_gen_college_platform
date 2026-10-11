import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {createHistoryRepository} from './history.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createBrowserPrivacy} from '../src/browserPrivacy.mjs';
import {onboardingRecovery} from '../src/onboardingRecovery.mjs';
import {createDatabase,migrateDatabase} from './database.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
const student={id:'student',name:'Synthetic Student',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};
const item={id:'discussion',studentId:student.id,date:'2026-10-01T12:00:00Z',mode:'planning',summary:'Synthetic summary',sources:[]};

test('a replay snapshot cannot revive a cleared checkpoint that never reached the backend',async()=>{
 const {pool,run}=await fixture();try{
  await run('owner',{action:'save-student',student});await run('owner',{action:'save-student',student:{...student,id:'other'}});const history=createHistoryRepository(pool);
  await history('owner',{action:'save',item});const privacy=createBrowserPrivacy();privacy.start('owner');const key='origen.onboarding-summaries.owner',recovery=onboardingRecovery(privacy.storage(key),key);
  const records={first:{...item,id:'first',studentId:'other'},second:{...item,id:'never-submitted'}};recovery.write(records);const snapshot=Object.values(recovery.read({}));
  privacy.forget({studentId:student.id});await history('owner',{action:'clear',studentId:student.id});
  for(const record of snapshot){const lease=privacy.capture(record);if(!lease.valid())continue;await history('owner',{action:'save',item:record});lease.release();}
  assert.deepEqual((await history('owner',{action:'load',studentId:student.id})).items,[]);assert.equal((await history('owner',{action:'load',studentId:'other'})).items.length,1);
 }finally{await pool.end();}
});
async function call(handler,input){let status,body;await handler(Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/conversation-summary',method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173'},origenAuthorized:true,origenIdentity:{sub:'owner'}}),{writeHead(s){status=s;},end(s){body=JSON.parse(s);}},()=>assert.fail());return {status,body};}

test('deleted discussion IDs reject direct saves, imports and regenerated summaries',async()=>{
 const {pool,run}=await fixture();try{
  await run('owner',{action:'save-student',student});await run('other',{action:'save-student',student});const history=createHistoryRepository(pool);
  await history('owner',{action:'save',item});await history('owner',{action:'delete',id:item.id});
  await assert.rejects(history('owner',{action:'save',item}),{status:410});
  await history('owner',{action:'import',items:[item]});assert.deepEqual((await history('owner',{action:'load'})).items,[]);
  const handler=createSummaryHandler({OPENAI_API_KEY:'fake'},()=>assert.fail('deleted transcript sent upstream'),pool);
  assert.equal((await call(handler,{...item,language:'en',turns:[{role:'user',text:'Synthetic question'}]})).status,410);
  await history('other',{action:'save',item});assert.equal((await history('other',{action:'load'})).items.length,1);
  await history('owner',{action:'save',item:{...item,id:'new-conversation'}});assert.equal((await history('owner',{action:'load'})).items.length,1);
  const tombstone=(await pool.query('SELECT student_id,mode,deleted_at FROM origen_conversation_lifecycle WHERE id=$1 AND deleted_at IS NOT NULL',[item.id])).rows[0];assert.equal(tombstone.student_id,null);assert.equal(tombstone.mode,null);assert.ok(tombstone.deleted_at);
  await createLifecycleRepository(pool)('owner',{action:'delete',confirmation:'DELETE'});assert.equal((await pool.query('SELECT id FROM origen_conversation_lifecycle')).rows.length,1);
 }finally{await pool.end();}
});

test('deletion wins while summary generation is already in flight, including deferred onboarding',async()=>{
 for(const deferred of [false,true])for(const action of ['delete','clear']){
  const {pool,run}=await fixture();try{
   await run('owner',{action:'save-student',student});const history=createHistoryRepository(pool);let release,started;
   const waiting=new Promise(resolve=>started=resolve);
   const handler=createSummaryHandler({OPENAI_API_KEY:'fake'},async()=>{started();await new Promise(resolve=>release=resolve);return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'Late synthetic summary'}]}]}));},pool);
   const saving=call(handler,{...item,defer:deferred,language:'en',turns:[{role:'user',text:'Synthetic question'}]});await waiting;
   await history('owner',action==='delete'?{action,id:item.id}:{action,studentId:student.id,mode:'planning'});release();const result=await saving;
   assert.equal(result.status,410,`${action}, deferred=${deferred}`);assert.deepEqual((await history('owner',{action:'load'})).items,[]);
  }finally{await pool.end();}
 }
});

test('clearing a scope rejects its reserved retries and preserves other topics and students',async()=>{
 const {pool,run}=await fixture();try{
  await run('owner',{action:'save-student',student});await run('owner',{action:'save-student',student:{...student,id:'other'}});const history=createHistoryRepository(pool);
  for(const entry of [item,{...item,id:'costs',mode:'finance'},{...item,id:'other-student',studentId:'other'},{...item,id:'family',studentId:null}])await history('owner',{action:'save',item:entry});
  await history('owner',{action:'reserve-summary',item:{...item,id:'pending'},deferred:false});
  await history('owner',{action:'clear',studentId:student.id,mode:'planning'});await assert.rejects(history('owner',{action:'save',item:{...item,id:'pending'}}),{status:410});
  assert.deepEqual((await history('owner',{action:'load'})).items.map(x=>x.id).sort(),['costs','family','other-student']);
  await history('owner',{action:'clear',studentId:null});await assert.rejects(history('owner',{action:'save',item:{...item,id:'family',studentId:null}}),{status:410});
 }finally{await pool.end();}
});

test('PostgreSQL deletion holds the account lock and rejects a waiting late save',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const pool=createDatabase({DATABASE_URL:process.env.DATABASE_TEST_URL}),schema=`privacy_delete_${crypto.randomUUID().replaceAll('-','')}`;
 const first=await pool.connect(),second=await pool.connect(),admin=await pool.connect();let release;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);for(const client of [first,second,admin])await client.query(`SET search_path TO ${schema}`);
  const wrap=client=>({connect:async()=>({query:(...args)=>client.query(...args),release(){}})});await migrateDatabase(wrap(admin));
  await createFamilyRepository(wrap(admin))('owner',validateFamily({action:'save-student',student}));await createHistoryRepository(wrap(admin))('owner',{action:'save',item});
  const firstPid=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,secondPid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let atCommit;const reached=new Promise(resolve=>atCommit=resolve),hold=new Promise(resolve=>release=resolve);
  const deleting=createHistoryRepository({connect:async()=>({async query(sql,args){if(sql==='COMMIT'){atCommit();await hold;}return first.query(sql,args);},release(){}})})('owner',{action:'clear',studentId:student.id});
  await reached;const saving=createHistoryRepository(wrap(second))('owner',{action:'save',item});const rejected=assert.rejects(saving,{status:410});let blocked=false;
  for(let i=0;i<100;i++){const pids=(await admin.query('SELECT pg_blocking_pids($1) AS pids',[secondPid])).rows[0].pids;if(pids.includes(firstPid)){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  release();await deleting;await rejected;assert.equal(blocked,true);assert.deepEqual((await createHistoryRepository(wrap(admin))('owner',{action:'load'})).items,[]);
 }finally{release?.();for(const client of [first,second]){await client.query('ROLLBACK').catch(()=>{});client.release();}await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);admin.release();await pool.end();}
});

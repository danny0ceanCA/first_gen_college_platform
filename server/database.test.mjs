import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createDatabase,migrateDatabase,databaseReady} from './database.mjs';
import {createApp} from './index.mjs';
import {createGuidanceRepository,guidanceConfig} from './guidance-history.mjs';
import {createHistoryRepository} from './history.mjs';

function fakePool({fail=false,applied=[]}={}){
 const calls=[];let released=false;
 const client={query:async(sql,values)=>{
  calls.push({sql,values});
  if(sql==='SELECT name, checksum FROM origen_schema_migrations')return {rows:applied};
  if(fail&&sql.includes('CREATE TABLE origen_accounts'))throw new Error('migration failure');
  return {rows:[]};
 },release:()=>{released=true;}};
 return {pool:{connect:async()=>client},calls,get released(){return released;}};
}

test('missing database configuration does not create a connection pool',()=>{
 assert.equal(createDatabase({},class{constructor(){assert.fail('must not open a pool');}}),null);
});

test('migrations run on one locked transaction and skip already applied versions',async()=>{
 const first=fakePool();await migrateDatabase(first.pool);
 assert.equal(first.calls[0].sql,'BEGIN');
 assert.match(first.calls[1].sql,/pg_advisory_xact_lock/);
 assert.equal(first.calls.at(-1).sql,'COMMIT');assert.equal(first.released,true);
 const insertion=first.calls.find(call=>call.sql.startsWith('INSERT INTO origen_schema_migrations'));
 const second=fakePool({applied:[{name:insertion.values[0],checksum:insertion.values[1]}]});
 await migrateDatabase(second.pool);
 assert.ok(!second.calls.some(call=>call.sql.includes('CREATE TABLE origen_accounts')));
 assert.equal(second.calls.at(-1).sql,'COMMIT');
});

test('failed migrations roll back and release the connection',async()=>{
 const fixture=fakePool({fail:true});await assert.rejects(migrateDatabase(fixture.pool),/migration failure/);
 assert.equal(fixture.calls.at(-1).sql,'ROLLBACK');assert.equal(fixture.released,true);
});

test('changing an applied migration is rejected instead of silently altering the schema',async()=>{
 const fixture=fakePool({applied:[{name:'001_family_storage.sql',checksum:'different'}]});
 await assert.rejects(migrateDatabase(fixture.pool),/Applied database migration was changed/);
 assert.equal(fixture.calls.at(-1).sql,'ROLLBACK');assert.equal(fixture.released,true);
});

test('readiness returns 503 for missing or unreachable storage and 200 only after schema setup',async()=>{
 const databases=[null,{query:async()=>{throw new Error('private connection details');}},{query:async()=>({rows:[{ready:false}]})},{query:async()=>({rows:[{ready:true}]})}];
 for(const database of databases){
  const server=createServer(createApp({},undefined,database));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const url=`http://127.0.0.1:${server.address().port}`;
   assert.equal((await fetch(url+'/healthz')).status,200);
   const response=await fetch(url+'/readyz');
   assert.equal(response.status,database===databases.at(-1)?200:503);
   assert.deepEqual(await response.json(),database===databases.at(-1)?{ok:true}:{error:'database_not_ready'});
  }finally{await new Promise(resolve=>server.close(resolve));}
 }
});

// Opt in with a dedicated test database; never run this against user data.
test('PostgreSQL migration, account boundaries and cascade deletion', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 const database=createDatabase({DATABASE_URL:process.env.DATABASE_TEST_URL});
 const schema=`origen_test_${crypto.randomUUID().replaceAll('-','')}`;
 const client=await database.connect();
 let created=false;
 try{
  await client.query(`CREATE SCHEMA ${schema}`);created=true;
  await client.query(`SET search_path TO ${schema}`);
  const scoped={connect:async()=>({query:(...args)=>client.query(...args),release:()=>{}}),query:(...args)=>client.query(...args)};
  await migrateDatabase(scoped);await migrateDatabase(scoped);
  assert.equal(await databaseReady(scoped),true);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_schema_migrations')).rows[0].count,16);
  const a=(await client.query("INSERT INTO origen_accounts(auth0_subject) VALUES ('auth0|a') RETURNING id")).rows[0].id;
  const b=(await client.query("INSERT INTO origen_accounts(auth0_subject) VALUES ('auth0|b') RETURNING id")).rows[0].id;
  await client.query("INSERT INTO origen_students(account_id,id,name) VALUES ($1,'student','Sofia')",[a]);
  const insert="INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) VALUES ($1,'summary','student','finance','Discussed grants',now())";
  await assert.rejects(client.query(insert,[b]),{code:'23503'});
  await client.query(insert,[a]);
  const scope={sessionId:crypto.randomUUID(),segmentId:crypto.randomUUID(),topic:'finance',language:'en',role:'parent',targetKind:'student',studentId:'student'};
  await createGuidanceRepository(scoped).begin('auth0|a',scope,guidanceConfig('synthetic','voice',{instructions:'Test policy',tools:[]}));
  // A valid summary insert followed by invalid attribution must roll back both.
  await assert.rejects(createHistoryRepository(scoped)('auth0|a',{action:'save',item:{id:'rollback-summary',studentId:null,mode:'finance',date:new Date().toISOString(),sources:[],summary:'Synthetic'},attribution:{sessionId:scope.sessionId,segmentIds:[scope.segmentId],language:'en'}}),{status:409});
  assert.equal((await client.query("SELECT count(*)::int AS count FROM origen_conversation_summaries WHERE id='rollback-summary'")).rows[0].count,0);
  await client.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) VALUES ($1,'family',NULL,'planning','Discussed family goals',now())",[a]);
  const plan=(await client.query("INSERT INTO origen_plans(account_id,student_id,title,category) VALUES($1,NULL,'Family plan','education') RETURNING id",[a])).rows[0].id;
  await client.query("INSERT INTO origen_plan_steps(account_id,plan_id,id,position,title,due_date) VALUES($1,$2,'step',0,'Meet counselor','2026-11-01')",[a,plan]);
  assert.equal((await client.query("SELECT to_char(due_date,'YYYY-MM-DD') AS date FROM origen_plan_steps WHERE account_id=$1",[a])).rows[0].date,'2026-11-01');
  await assert.rejects(client.query("INSERT INTO origen_plan_steps(account_id,plan_id,id,position,title) VALUES($1,$2,'foreign',0,'Foreign step')",[b,plan]),{code:'23503'});
  await client.query("INSERT INTO origen_profile_observations(account_id,student_id,field,reported_value,origin) VALUES($1,'student','stage','11th grade','user-reported')",[a]);
  await client.query("INSERT INTO origen_plan_revisions(account_id,plan_id,version,snapshot) VALUES($1,$2,1,'{}')",[a,plan]);
  await client.query("INSERT INTO origen_step_transitions(account_id,plan_id,version,step_id,kind,reported_status) VALUES($1,$2,1,'step','added','not-started')",[a,plan]);
  await client.query('DELETE FROM origen_accounts WHERE id=$1',[a]);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_students')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_conversation_summaries')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_plans')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_plan_steps')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_guidance_sessions')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM origen_guidance_events')).rows[0].count,0);
  for(const table of ['origen_profile_observations','origen_plan_revisions','origen_step_transitions','origen_progress_reports'])assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,0);
 }finally{
  if(created)await client.query(`DROP SCHEMA ${schema} CASCADE`);
  client.release();await database.end();
 }
});

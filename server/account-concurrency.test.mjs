import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,migrateDatabase} from './database.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {subjectHash,createLifecycleRepository} from './account-lifecycle.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';

// pg-mem does not implement transaction row-lock scheduling. Use only a
// dedicated opt-in PostgreSQL test database; all records are synthetic.
test('PostgreSQL serializes closure and writes across independent connections',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const pool=createDatabase({DATABASE_URL:process.env.DATABASE_TEST_URL});const schema=`origen_race_${crypto.randomUUID().replaceAll('-','')}`;
 const admin=await pool.connect();let first,second,created=false;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);created=true;await admin.query(`SET search_path TO ${schema}`);
  await migrateDatabase({connect:async()=>({query:(...args)=>admin.query(...args),release(){}})});
  first=await pool.connect();second=await pool.connect();for(const c of [first,second])await c.query(`SET search_path TO ${schema}`);
  const firstPid=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,secondPid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const wrapped=c=>({connect:async()=>({query:(...args)=>c.query(...args),release(){}})});
  async function blocked(){for(let i=0;i<100;i++){const pids=(await admin.query('SELECT pg_blocking_pids($1) AS pids',[secondPid])).rows[0].pids;if(pids.includes(firstPid))return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected independent transaction to block on the subject lock');}
  // Closure wins: a waiting family load must roll back instead of recreating data.
  await first.query('BEGIN');await guardAccountTransaction(first,'closure-first');await first.query('INSERT INTO origen_closed_accounts(subject_hash) VALUES($1)',[subjectHash('closure-first')]);
  const waiting=createFamilyRepository(wrapped(second))('closure-first',validateFamily({action:'load'}));const denied=assert.rejects(waiting,{status:403});
  await blocked();await first.query('COMMIT');await denied;
  assert.equal((await admin.query("SELECT id FROM origen_accounts WHERE auth0_subject='closure-first'")).rows.length,0);
  // Write wins: closure waits, then deletes the committed record.
  await first.query('BEGIN');await guardAccountTransaction(first,'writer-first');await first.query("INSERT INTO origen_accounts(auth0_subject) VALUES('writer-first')");
  const closing=createLifecycleRepository(wrapped(second))('writer-first',{action:'delete',confirmation:'DELETE'});
  await blocked();await first.query('COMMIT');assert.equal((await closing).deleted,true);
  assert.equal((await admin.query("SELECT id FROM origen_accounts WHERE auth0_subject='writer-first'")).rows.length,0);
 }finally{
  for(const c of [first,second])if(c){await c.query('ROLLBACK').catch(()=>{});c.release();}
  if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);admin.release();await pool.end();
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Real PostgreSQL is required: pg-mem does not execute privacy triggers.
test('privacy trigger preserves reusable test resets while honoring real account closure',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1});
 const migration=await readFile(new URL('./migrations/091_reusable_test_workspace.sql',import.meta.url),'utf8');
 try{
 const c=await pool.connect();try{
  await c.query('BEGIN');const schema='test_reset_'+randomUUID().replaceAll('-','');await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET LOCAL search_path TO ${schema}`);
  await c.query(`CREATE TABLE origen_accounts(id uuid PRIMARY KEY,auth0_subject text);CREATE TABLE origen_deletion_journal(subject_hash text,account_id uuid,kind text,record_id text,UNIQUE(account_id,kind,record_id));CREATE TABLE origen_closed_accounts(subject_hash text PRIMARY KEY);CREATE TABLE origen_identity_closures(subject_hash text PRIMARY KEY,completed_at timestamptz);CREATE TABLE origen_conversation_lifecycle(account_id uuid,id text,deleted_at timestamptz,student_id uuid,mode text,UNIQUE(account_id,id));`);
  const original=await readFile(new URL('./migrations/037_privacy_controls.sql',import.meta.url),'utf8');await c.query(original.slice(original.indexOf('CREATE FUNCTION origen_record_deletion()'),original.indexOf('CREATE FUNCTION origen_prevent_resurrection()')));
  await c.query("CREATE TRIGGER privacy_delete BEFORE DELETE ON origen_accounts FOR EACH ROW EXECUTE FUNCTION origen_record_deletion('account')");
  const subject='auth0|6ad14bb9afcad1dcde4964b9';const insert=async who=>{const id=randomUUID();await c.query('INSERT INTO origen_accounts VALUES($1,$2)',[id,who]);return id;};
  const remove=async id=>c.query('DELETE FROM origen_accounts WHERE id=$1',[id]);const closed=async who=>(await c.query("SELECT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to($1,'UTF8')),'hex')) AS yes",[who])).rows[0].yes;
  await remove(await insert(subject));assert.equal(await closed(subject),true,'old trigger reproduces permanent closure');
  await c.query(migration);await c.query(await readFile(new URL('./migrations/092_pin_deletion_trigger_schema.sql',import.meta.url),'utf8'));assert.equal(await closed(subject),false,'migration repairs synthetic closure');assert.equal((await c.query('SELECT count(*)::int AS n FROM origen_identity_closures')).rows[0].n,0);
  assert.ok((await c.query("SELECT proconfig FROM pg_proc WHERE oid='origen_record_deletion()'::regprocedure")).rows[0].proconfig.some(value=>value.includes(schema)),'security-definer trigger pins its schema');
  await remove(await insert(subject));assert.equal(await closed(subject),false,'reset keeps sign-in reusable');await remove(await insert(subject));assert.equal(await closed(subject),false,'repeat reset remains reusable');
  await remove(await insert('auth0|ordinary-student'));assert.equal(await closed('auth0|ordinary-student'),true,'real accounts still close');
  const id=await insert(subject);await c.query("INSERT INTO origen_closed_accounts VALUES(encode(sha256(convert_to($1,'UTF8')),'hex'))",[subject]);await remove(id);assert.equal(await closed(subject),true,'explicit closure is preserved');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM origen_deletion_journal')).rows[0].n,5,'all deletion receipts survive');
  
 }finally{await c.query('ROLLBACK');c.release();}

 }finally{await pool.end();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {isolateDatabase,assertRuntimeIsolation,runAsAccount,runAsGuardian,runRetentionJob} from './account-isolation.mjs';
import {createPermissionRepository,tokenHash,purgePermissionData} from './guardian-permission.mjs';
import {GUARDIAN_NOTICE_VERSION} from './guardian-email.mjs';
import {permissionContext} from './permission-context.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createLinksRepository} from './account-links.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';

test('PostgreSQL migration/RLS, single-use concurrency and revocation serialize under restricted runtime',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`guard_${suffix}`,role=`guard_user_${suffix}`;
 const owner=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});let runtime;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  await migrateDatabase(owner);await migrateDatabase(owner);await grantRuntimeAccess(owner,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=role;url.password='';runtime=new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`});
  await assertRuntimeIsolation(runtime,{schema});const db=isolateDatabase(runtime,{schema}),as=(subject,fn)=>runAsAccount({sub:subject},fn),mails=[];
  const repo=createPermissionRepository(db,{mailer:{async send(mail){mails.push(mail);return 'mock';}}});
  for(const sub of ['teen','other'])await as(sub,async()=>{await repo.account(sub,{action:'screen',ageBand:'13to17',audience:'grade9plus'});await repo.account(sub,{action:'request',guardianEmail:`${sub}@example.invalid`});});
  const token=mails[0].approvalToken,decision={action:'approve',token,confirmed:true,noticeVersion:GUARDIAN_NOTICE_VERSION};
  await runAsGuardian(tokenHash(token),async()=>{
   assert.equal((await db.query('SELECT * FROM origen_eligibility')).rows.length,1);
   assert.equal((await db.query('SELECT * FROM origen_accounts')).rows.length,0);
   assert.equal((await db.query('SELECT * FROM origen_subject_locks')).rows.length,1);
   assert.equal((await db.query("UPDATE origen_eligibility SET status='adult' WHERE guardian_email='other@example.invalid'")).rowCount,0);
  });
  const decisions=await Promise.allSettled([repo.guardian(decision),repo.guardian(decision)]);assert.equal(decisions.filter(x=>x.status==='fulfilled').length,1);assert.equal(decisions.find(x=>x.status==='rejected').reason.status,410);
  assert.equal((await as('teen',()=>repo.account('teen',{action:'status'}))).allowed,true);
  assert.equal((await as('other',()=>db.query('SELECT * FROM origen_eligibility'))).rows.length,1);
  const family=createFamilyRepository(db),links=createLinksRepository(db);
  await as('teen',()=>family('teen',validateFamily({action:'save-student',student:{id:'shared',name:'Latest shared name',stage:'11th grade',notes:'OWNER PRIVATE'}})));
  const invitation=await as('teen',()=>links('teen',{action:'create',studentId:'shared',role:'student'}));
  const joined=await as('other',()=>links('other',{action:'accept',token:invitation.token}));
  await as('other',()=>db.query("UPDATE origen_students SET notes='MEMBER PRIVATE' WHERE id=$1",[joined.studentId]));
  const row=await as('teen',()=>repo.read('teen'));
  let release,locked;const releasePromise=new Promise(r=>{release=r;}),lockedPromise=new Promise(r=>{locked=r;});
  const writing=as('teen',()=>permissionContext.run({subject:'teen',revision:row.revision,signal:new AbortController().signal},async()=>{const c=await db.connect();try{await c.query('BEGIN');await guardAccountTransaction(c,'teen');locked();await releasePromise;await c.query('COMMIT');}finally{c.release();}}));
  await lockedPromise;let withdrawalCompleted=false;const withdraw=repo.guardian({action:'withdraw',token:mails[0].withdrawalToken,confirmed:true,noticeVersion:GUARDIAN_NOTICE_VERSION}).then(()=>{withdrawalCompleted=true;});
  await new Promise(r=>setTimeout(r,40));assert.equal(withdrawalCompleted,false);release();await writing;await withdraw;
  await assert.rejects(as('teen',()=>permissionContext.run({subject:'teen',revision:row.revision,signal:new AbortController().signal},()=>createFamilyRepository(db)('teen',{action:'load'}))),{status:403});
  assert.equal((await owner.query('SELECT * FROM origen_accounts')).rows.length,2);
  assert.equal((await as('teen',()=>repo.read('teen'))).guardian_email,null);
  await as('teen',()=>createLifecycleRepository(db)('teen',{action:'delete',confirmation:'DELETE'}));
  assert.equal((await owner.query('SELECT * FROM origen_student_links')).rows.length,0);
  const survivor=(await as('other',()=>db.query('SELECT name,notes FROM origen_students WHERE id=$1',[joined.studentId]))).rows[0];
  assert.deepEqual(survivor,{name:'Latest shared name',notes:'MEMBER PRIVATE'});
  assert.equal((await owner.query('SELECT * FROM origen_accounts')).rows.length,1);
  await runRetentionJob(()=>purgePermissionData(db));
 }finally{await runtime?.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`).catch(()=>{});await owner.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});await owner.end();}
});

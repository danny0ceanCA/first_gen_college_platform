import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {isolateDatabase,runAsAccount,runRetentionJob,assertRuntimeIsolation} from './account-isolation.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createHistoryRepository} from './history.mjs';
import {createPrivacyRepository,createPrivacyHandler,validatePrivacyRequest,purgePrivateSummaries} from './privacy-controls.mjs';
import {createLifecycleHandler,createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest,validateDeletionManifest} from '../ops/privacy-recovery.mjs';
import {completeIdentityClosure} from '../ops/auth0-closure.mjs';
import {blankSheet} from '../src/workspaceSheets.mjs';
import {productionConfigIssues} from './production-config.mjs';

test('privacy requests reject forged ownership, invalid categories, internal actions and malformed confirmation',()=>{
 for(const body of [null,[],{action:'expire'},{action:'status',accountId:'other'},{action:'preview',categories:['__proto__']},{action:'preview',categories:['notes','notes']},{action:'preview',categories:['notes'],studentId:3},{action:'retention',days:0},{action:'erase',categories:['notes'],confirmation:'DELETE'}])assert.throws(()=>validatePrivacyRequest(body),{status:400});
 assert.equal(validatePrivacyRequest({action:'retention',days:null}).days,null);
 assert(productionConfigIssues({PRIVACY_RESTORE_PENDING:'true'}).some(s=>s.startsWith('PRIVACY_RESTORE_PENDING')));
 const issues=productionConfigIssues({AUTH0_MANAGEMENT_TOKEN:'synthetic-operator-secret'});assert(issues.some(s=>s.startsWith('AUTH0_MANAGEMENT_TOKEN')));assert.doesNotMatch(issues.join(),/synthetic-operator-secret/);
});
test('exports, erasure and retention changes reject stale sign-in before accessing storage',async()=>{
 const db={connect(){assert.fail('must not connect');}};
 for(const [url,handler,input] of [['/api/account-data',createLifecycleHandler(db),{action:'export'}],['/api/privacy',createPrivacyHandler(db),{action:'erase',categories:['notes'],revision:'a'.repeat(64),confirmation:'DELETE'}],['/api/privacy',createPrivacyHandler(db),{action:'retention',days:30}]]){
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'a',iat:Math.floor(Date.now()/1000)}});
  const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};await handler(req,res,()=>assert.fail());assert.equal(res.status,403);assert.equal(res.body.error,'reauthentication_required');
 }
});
test('PostgreSQL privacy controls, delayed writes, retention and stale-backup deletion replay',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`privacy_${suffix}`,restored=`restore_${suffix}`,role=`privacy_user_${suffix}`;
 const admin=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});
 const recovery=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${restored}`});let runtime;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`CREATE SCHEMA ${restored}`);await createTestLogin(admin,role);
  await migrateDatabase(admin);await migrateDatabase(recovery);await grantRuntimeAccess(admin,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);useTestLogin(url,role);runtime=new pg.Pool({connectionString:url.href,max:2,options:`-c search_path=${schema}`});await assertRuntimeIsolation(runtime,{schema});
  const db=isolateDatabase(runtime,{schema}),as=(sub,fn)=>runAsAccount({sub},fn),family=createFamilyRepository(db),privacy=createPrivacyRepository(db),history=createHistoryRepository(db),lifecycle=createLifecycleRepository(db);
  for(const sub of ['alice','bob','closed']){
   await as(sub,()=>family(sub,validateFamily({action:'save-account',account:{firstName:sub,email:'',role:'student'}})));
   await as(sub,()=>family(sub,validateFamily({action:'save-student',student:{id:'student',name:'Synthetic',stage:'College',interest:'',gpa:'',color:'peach',needs:'',notes:''}})));
   await as(sub,()=>history(sub,{action:'save',item:{id:'summary',studentId:'student',mode:'planning',date:new Date().toISOString(),summary:'PRIVATE synthetic summary',sources:[]}}));
  }
  const accounts=(await admin.query('SELECT * FROM origen_accounts')).rows,owner=accounts.find(a=>a.auth0_subject==='alice').id;
  const manual=randomUUID(),derived=randomUUID(),plan=randomUUID(),sheet=randomUUID();
  await admin.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin) VALUES($1,$2,'student','options','note','PRIVATE independent','en','saved','user')",[owner,manual]);
  await admin.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id,source_quote) VALUES($1,$2,'student','options','note','PRIVATE derived','en','saved','conversation','summary','PRIVATE synthetic summary')",[owner,derived]);
  await admin.query("INSERT INTO origen_plans(account_id,id,student_id,title,category) VALUES($1,$2,'student','PRIVATE plan','education')",[owner,plan]);
  await admin.query("INSERT INTO origen_plan_revisions(account_id,plan_id,version,snapshot) VALUES($1,$2,1,'{\"private\":\"plan copy\"}')",[owner,plan]);
  await admin.query('INSERT INTO origen_workspace_sheets(account_id,id,student_id,content) VALUES($1,$2,$3,$4)',[owner,sheet,'student',JSON.stringify(blankSheet('meeting'))]);
  // Restore a genuine older PostgreSQL dataset in a different isolated schema.
  const snapshot={};for(const table of ['origen_accounts','origen_students','origen_conversation_summaries','origen_topic_notes','origen_plans','origen_plan_revisions','origen_workspace_sheets'])snapshot[table]=(await admin.query(`SELECT * FROM ${table}`)).rows;
  await t.test('preview is scoped, includes derived notes, and stale confirmation erases nothing',async()=>{
   await as('alice',async()=>{
    await assert.rejects(privacy('bob',{action:'status'}),{status:403});
    await assert.rejects(privacy('alice',{action:'preview',categories:['summaries'],studentId:'foreign'}),{status:404});
    const p=await privacy('alice',{action:'preview',categories:['summaries'],studentId:'student'});assert.deepEqual(p.counts,{summaries:1,notes:1,plans:0,sheets:0,memories:0});
    await admin.query('UPDATE origen_topic_notes SET version=version+1 WHERE account_id=$1 AND id=$2',[owner,derived]);
    await assert.rejects(privacy('alice',{action:'erase',categories:['summaries'],studentId:'student',revision:p.revision,confirmation:'DELETE'}),{status:409});
    assert.equal((await history('alice',{action:'load'})).items.length,1);
    const fresh=await privacy('alice',{action:'preview',categories:['summaries'],studentId:'student'});
    await privacy('alice',{action:'erase',categories:['summaries'],studentId:'student',revision:fresh.revision,confirmation:'DELETE'});
    assert.deepEqual((await privacy('alice',{action:'status'})).counts,{summaries:0,notes:1,plans:1,sheets:1,memories:0});
    await assert.rejects(history('alice',{action:'save',item:{id:'summary',studentId:'student',mode:'planning',date:new Date().toISOString(),summary:'stale retry',sources:[]}}),{status:410});
   });
  });
  await t.test('journal is content-free, owner-only and immutable to runtime; notes cannot be resurrected',async()=>{
   const rows=await as('alice',()=>db.query('SELECT * FROM origen_deletion_journal'));assert.equal(rows.rows.length,2);assert.doesNotMatch(JSON.stringify(rows.rows),/PRIVATE|synthetic summary|alice/);
   assert.equal((await as('bob',()=>db.query('SELECT * FROM origen_deletion_journal'))).rows.length,0);
   for(const sql of ['DELETE FROM origen_deletion_journal','UPDATE origen_identity_closures SET completed_at=now()'])await assert.rejects(as('alice',()=>db.query(sql)),{code:'42501'});
   await assert.rejects(as('alice',()=>db.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin) VALUES($1,$2,'student','options','note','stale','en','saved','user')",[owner,derived])),{code:'23514'});
  });
  await t.test('retention is opt-in, respects saved age, and keeps independent work and other accounts',async()=>{
   await as('alice',()=>history('alice',{action:'save',item:{id:'old',studentId:'student',mode:'planning',date:'2020-01-01',summary:'old',sources:[]}}));
   // A historical conversation newly saved is retained until its saved age expires.
   await as('alice',()=>privacy('alice',{action:'retention',days:30}));await runRetentionJob(()=>purgePrivateSummaries(db));
   assert.equal((await as('alice',()=>history('alice',{action:'load'}))).items.length,1);
   await admin.query("UPDATE origen_conversation_summaries SET created_at=now()-interval '31 days' WHERE account_id=$1 AND id='old'",[owner]);
   await runRetentionJob(()=>purgePrivateSummaries(db));
   assert.equal((await as('alice',()=>history('alice',{action:'load'}))).items.length,0);assert.equal((await as('bob',()=>history('bob',{action:'load'}))).items.length,1);
   assert.equal((await as('alice',()=>privacy('alice',{action:'status'}))).counts.notes,1);
   await as('alice',()=>privacy('alice',{action:'retention',days:null}));
  });
  await t.test('explicit removal of independent copies cascades plan history and queues account identity closure',async()=>{
   const selection={categories:['plans','sheets','notes']};const p=await as('alice',()=>privacy('alice',{action:'preview',...selection}));
   await as('alice',()=>privacy('alice',{action:'erase',...selection,revision:p.revision,confirmation:'DELETE'}));
   assert.equal((await admin.query('SELECT * FROM origen_plan_revisions')).rows.length,0);
   await as('closed',()=>lifecycle('closed',{action:'delete',confirmation:'DELETE'}));
   assert.equal((await admin.query('SELECT * FROM origen_identity_closures')).rows.length,1);
  });
  let calls=0;
  await t.test('Auth0 closure verifies a receipt, retries failures and never deletes an active account',async()=>{
   const settings={domain:'origenedu.us.auth0.com',token:'synthetic-not-a-token'};
   await assert.rejects(completeIdentityClosure(admin,{...settings,subject:'alice'},async()=>{assert.fail();}),/verified_closure_required/);
   await assert.rejects(completeIdentityClosure(admin,{...settings,subject:'closed'},async()=>({status:429})),/identity_provider_deletion_failed/);
   assert.equal((await admin.query('SELECT completed_at FROM origen_identity_closures')).rows[0].completed_at,null);
   const fetch=async(url,options)=>{calls++;assert.equal(url,'https://origenedu.us.auth0.com/api/v2/users/closed');assert.equal(options.redirect,'error');return {status:204};};
   await completeIdentityClosure(admin,{...settings,subject:'closed'},fetch);await completeIdentityClosure(admin,{...settings,subject:'closed'},fetch);assert.equal(calls,1);
  });
  await t.test('stale PostgreSQL recovery replays all deletions twice, preserves another user and blocks absent-record retries',async()=>{
   const manifest=await exportDeletionManifest(admin);assert.doesNotMatch(JSON.stringify(manifest),/PRIVATE|synthetic summary/);
   assert.throws(()=>validateDeletionManifest({...manifest,closures:[]}),/invalid_deletion_manifest/);
   for(const [table,rows] of Object.entries(snapshot))for(const row of rows){const columns=Object.keys(row),values=columns.map(k=>typeof row[k]==='object'&&row[k]!==null&&!(row[k] instanceof Date)?JSON.stringify(row[k]):row[k]);await recovery.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,values);}
   assert.equal((await recovery.query('SELECT * FROM origen_conversation_summaries')).rows.length,3);
   await replayDeletionManifest(recovery,manifest);await replayDeletionManifest(recovery,manifest);
   const remaining=(await recovery.query('SELECT a.auth0_subject FROM origen_conversation_summaries s JOIN origen_accounts a ON a.id=s.account_id')).rows;assert.deepEqual(remaining,[{auth0_subject:'bob'}]);
   for(const table of ['origen_topic_notes','origen_plans','origen_plan_revisions','origen_workspace_sheets'])assert.equal((await recovery.query(`SELECT * FROM ${table}`)).rows.length,0);
   assert.equal((await recovery.query('SELECT * FROM origen_closed_accounts')).rows.length,1);
   assert((await recovery.query('SELECT completed_at FROM origen_identity_closures')).rows[0].completed_at);
   await assert.rejects(recovery.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) VALUES($1,'old','student','planning','retry',now())",[owner]),{code:'23514'});
  });
 }finally{
  await runtime?.end();await admin.query(`DROP SCHEMA IF EXISTS ${restored} CASCADE`);await admin.query(`DROP SCHEMA IF EXISTS ${restored}_reporting CASCADE`);await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await recovery.end();await admin.end();
 }
});

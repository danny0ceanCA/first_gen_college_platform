import {createPermissionRepository} from './guardian-permission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import pg from 'pg';
import {migrateDatabase} from './database.mjs';
import {isolateDatabase,assertRuntimeIsolation,runAsAccount,runAsAnalytics,runRetentionJob} from './account-isolation.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createHistoryRepository} from './history.mjs';
import {createLinksRepository} from './account-links.mjs';
import {createTopicRepository,createTopicService} from './topic-notes.mjs';
import {createSheetRepository} from './workspace-sheets.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {loadVoiceWorkspace} from './voice-workspace.mjs';
import {createGuidanceRepository,guidanceConfig,purgeGuidanceHistory} from './guidance-history.mjs';
import {purgeAdminReviews} from './admin-review-queue.mjs';
import {purgeProgressHistory} from './progress-history.mjs';
import {purgeConversationQuality} from './conversation-quality-store.mjs';
import {purgeOnboardingEvents} from './onboarding-events.mjs';
import {blankSheet} from '../src/workspaceSheets.mjs';
import {createApp} from './index.mjs';
import {ADMIN_ACTIONS,MFA_TIME_CLAIM,staffHash,requireStaffAccess} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';

test('account context rejects invalid identities and cannot become a retention job',async()=>{
 for(const sub of ['',null,'x'.repeat(256)])assert.throws(()=>runAsAccount({sub},()=>{}),{status:403});
 assert.throws(()=>runAsAnalytics(()=>{}),{status:403});
 await runAsAccount({sub:'a'},async()=>assert.throws(()=>runRetentionJob(()=>{}),/retention_not_available/));
});

// Dedicated disposable PostgreSQL only: real RLS/non-owner roles cannot be
// verified by pg-mem or by running the assertions as a superuser/table owner.
test('PostgreSQL runtime isolates accounts, linked profiles, tools, exports, and pooled sessions',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`iso_${suffix}`,role=`iso_user_${suffix}`;
 const ownerPool=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});
 const owner=await ownerPool.connect();let runtimePool,server;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);
  await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  const migration={connect:async()=>({query:(...args)=>owner.query(...args),release(){}})};
  await migrateDatabase(migration);await migrateDatabase(migration);
  await grantRuntimeAccess(migration,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=role;url.password='';
  runtimePool=new pg.Pool({connectionString:url.href,max:1,options:`-c search_path=${schema}`});
  await assertRuntimeIsolation(runtimePool,{schema});
  await owner.query('ALTER TABLE origen_workspace_sheets DISABLE ROW LEVEL SECURITY');
  await assert.rejects(assertRuntimeIsolation(runtimePool,{schema}),/restricted_database_runtime_required/);
  await owner.query('ALTER TABLE origen_workspace_sheets ENABLE ROW LEVEL SECURITY');
  await assert.rejects(assertRuntimeIsolation({query:(...args)=>owner.query(...args)},{schema}),/restricted_database_runtime_required/);
  const db=isolateDatabase(runtimePool,{schema}),as=(sub,fn)=>runAsAccount({sub},fn);
  const family=(sub,body)=>createFamilyRepository(db,{PROGRESS_HISTORY_ENABLED:'true'})(sub,validateFamily(body));
  const history=createHistoryRepository(db),notes=createTopicRepository(db),sheets=createSheetRepository(db),links=createLinksRepository(db),lifecycle=createLifecycleRepository(db);
  const plans=(sub,input)=>createPlanRepository(db,{PROGRESS_HISTORY_ENABLED:'true'})(sub,validatePlan(input));
  const student=(id,name)=>({id,name,stage:'Community college',interest:'Art',gpa:'',color:'peach',needs:`PRIVATE ${name} needs`,notes:`PRIVATE ${name} notes`});
  for(const sub of ['alice','bob','admin'])await as(sub,()=>family(sub,{action:'save-account',account:{firstName:sub,email:`${sub}@example.invalid`,role:'student'}}));
  for(const sub of ['alice','bob'])await as(sub,()=>family(sub,{action:'save-student',student:student('same-id',sub)}));
  await as('bob',()=>family('bob',{action:'save-student',student:student('bob-only','bob')}));
  const accountIds=Object.fromEntries((await owner.query('SELECT id,auth0_subject FROM origen_accounts')).rows.map(r=>[r.auth0_subject,r.id]));
  const item=(id,sub,studentId='same-id')=>({id,studentId,mode:'planning',summary:`PRIVATE ${sub} summary`,sources:[],date:new Date().toISOString()});
  for(const sub of ['alice','bob'])await as(sub,()=>history(sub,{action:'save',item:item('same-summary',sub)}));
  await as('bob',()=>history('bob',{action:'save',item:item('bob-summary','bob')}));
  const noteId=randomUUID(),sheetId=randomUUID();
  await as('bob',()=>notes('bob',{action:'create',studentId:'same-id',id:noteId,note:{topic:'options',kind:'note',content:'PRIVATE bob notebook',language:'en'}}));
  await as('bob',()=>sheets('bob',{action:'create',studentId:'same-id',id:sheetId,reviewed:true,sheet:{...blankSheet('meeting'),goal:'PRIVATE bob sheet'}}));
  const plan=(await as('bob',()=>plans('bob',{action:'create',requestId:randomUUID(),plan:{studentId:'same-id',title:'PRIVATE bob plan',goal:'',category:'education',status:'active',summaryIds:['bob-summary'],steps:[{id:'step',title:'Ask counselor',action:'PRIVATE bob step',notes:'',status:'not-started',dueDate:null,sources:[]}]}}))).plans[0];

  await t.test('omitted SQL ownership filters still expose only the active account',async()=>{
   await as('alice',async()=>{
    const rows=(await db.query('SELECT account_id,summary FROM origen_conversation_summaries')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].account_id,accountIds.alice);assert.match(rows[0].summary,/alice/);
    assert.deepEqual((await db.query('SELECT * FROM origen_topic_notes')).rows,[]);
    assert.deepEqual((await db.query('SELECT * FROM origen_workspace_sheets')).rows,[]);
    assert.equal((await db.query('UPDATE origen_students SET notes=$1 WHERE account_id=$2',['forged',accountIds.bob])).rowCount,0);
    assert.equal((await db.query('DELETE FROM origen_conversation_summaries WHERE account_id=$1',[accountIds.bob])).rowCount,0);
    await assert.rejects(db.query("INSERT INTO origen_conversation_summaries(account_id,id,student_id,mode,summary,conversation_at) VALUES($1,'forged','same-id','planning','forged',now())",[accountIds.bob]),{code:'42501'});
    await assert.rejects(db.query('UPDATE origen_conversation_summaries SET account_id=$1',[accountIds.bob]),{code:'42501'});
    await assert.rejects(db.query('TRUNCATE origen_students CASCADE'),{code:'42501'});
    await assert.rejects(db.query('ALTER TABLE origen_students DISABLE ROW LEVEL SECURITY'),{code:'42501'});
   });
  });
  await t.test('summary, profile, notes, plans, sheets, and voice selection reject guessed foreign IDs',async()=>{
   await as('alice',async()=>{
    assert.deepEqual((await history('alice',{action:'find',id:'bob-summary'})).items,[]);
    for(const input of [{action:'load',studentId:'bob-only'},{action:'context',studentId:'bob-only'},{action:'save',item:item('forged','alice','bob-only')},{action:'delete',id:'bob-summary'}])await assert.rejects(history('alice',input),{status:404});
    await assert.rejects(family('alice',{action:'delete-student',id:'bob-only'}),{status:404});
    for(const action of ['read-note','delete'])await assert.rejects(notes('alice',{action,studentId:'same-id',id:noteId,version:1}),{status:404});
    await assert.rejects(notes('alice',{action:'source',studentId:'same-id',summaryId:'bob-summary'}),{status:404});
    await assert.rejects(plans('alice',{action:'delete',id:plan.id,version:1}),{status:404});
    await assert.rejects(sheets('alice',{action:'delete',studentId:'same-id',id:sheetId,version:1}),{status:404});
    await assert.rejects(sheets('alice',{action:'prepare',studentId:'same-id',notes:[{id:noteId,version:1}],actions:[],includeGoal:false,includeSources:true}),{status:404});
    for(const focus of [{kind:'note',noteId,version:1,studentId:'same-id',topic:'options'},{kind:'action',planId:plan.id,stepId:'step',version:1,studentId:'same-id',topic:'options'}])await assert.rejects(loadVoiceWorkspace(db,'alice',{studentId:'same-id',mode:'planning',focus}),{status:404});
    const service=createTopicService(db,{OPENAI_API_KEY:'synthetic'},async()=>assert.fail('foreign source must never reach a model'));
    await assert.rejects(service('alice',{action:'suggest',studentId:'same-id',summaryId:'bob-summary',language:'en'}),{status:404});
    await assert.rejects(history('bob',{action:'load'}),{status:403,message:'account_scope_mismatch'});
   });
  });
  await t.test('linked families retain academic sharing without receiving private content',async()=>{
   const invite=await as('bob',()=>links('bob',{action:'create',studentId:'same-id',role:'parent'}));
   await assert.rejects(as('alice',()=>links('alice',{action:'inspect',token:'x'.repeat(43)})),{status:410});
   const preview=await as('alice',()=>links('alice',{action:'inspect',token:invite.token}));assert.equal(preview.invitation.studentName,'bob');assert.doesNotMatch(JSON.stringify(preview),/PRIVATE/);
   const joined=await as('alice',()=>links('alice',{action:'accept',token:invite.token}));
   let loaded=await as('alice',()=>family('alice',{action:'load'})),shared=loaded.students.find(s=>s.id===joined.studentId);
   assert.equal(shared.name,'bob');assert.equal(shared.notes,'');assert.equal(shared.needs,'');
   assert.deepEqual((await as('alice',()=>history('alice',{action:'context',studentId:joined.studentId,mode:'planning'}))).items,[]);
   await as('alice',()=>family('alice',{action:'save-student',student:{...shared,interest:'Design',notes:'PRIVATE alice local note'}}));
   const bob=await as('bob',()=>family('bob',{action:'load'}));assert.equal(bob.students[0].interest,'Design');assert.equal(bob.students[0].notes,'PRIVATE bob notes');
   assert.equal((await as('alice',()=>db.query('SELECT * FROM origen_students WHERE account_id=$1',[accountIds.bob]))).rows.length,0);
   const exported=await as('alice',()=>lifecycle('alice',{action:'export'}));assert.doesNotMatch(JSON.stringify(exported),/PRIVATE bob/);assert.match(JSON.stringify(exported),/PRIVATE alice local note/);
   await as('bob',()=>links('bob',{action:'unlink',id:joined.links[0].id}));
   loaded=await as('alice',()=>family('alice',{action:'load'}));assert.equal(loaded.students.find(s=>s.id===joined.studentId).interest,'Design');assert.equal(loaded.students.find(s=>s.id===joined.studentId).notes,'PRIVATE alice local note');
   assert.equal((await as('alice',()=>db.query('SELECT * FROM origen_shared_profile($1)',[joined.studentId]))).rows.length,0);
  });
  await t.test('commit, rollback, errors, concurrent requests and pool reuse cannot inherit access',async()=>{
   for(let i=0;i<8;i++){
    const sub=i%2?'bob':'alice';const rows=await as(sub,()=>db.query('SELECT auth0_subject FROM origen_accounts'));assert.deepEqual(rows.rows.map(r=>r.auth0_subject),[sub]);
    assert.deepEqual((await db.query('SELECT * FROM origen_accounts')).rows,[]);
   }
   await as('bob',async()=>{const c=await db.connect();try{await c.query('BEGIN');await assert.rejects(c.query('SELECT nonexistent_column FROM origen_students'));await c.query('ROLLBACK');}finally{c.release();}});
   const results=await Promise.all(Array.from({length:12},(_,i)=>{const sub=i%2?'alice':'bob';return as(sub,async()=>assert.deepEqual((await db.query('SELECT auth0_subject FROM origen_accounts')).rows.map(r=>r.auth0_subject),[sub]));}));assert.equal(results.length,12);
   assert.equal((await runtimePool.query("SELECT current_setting('origen.subject',true) AS subject")).rows[0].subject,'');
   await as('alice',async()=>{const c=await db.connect();await c.query('BEGIN');c.release();});
   assert.deepEqual((await db.query('SELECT * FROM origen_conversation_summaries')).rows,[],'unfinished transactions destroy the connection');
   const unusual="auth0|quote'\\; SET origen.purpose='analytics'; --";
   await as(unusual,()=>family(unusual,{action:'load'}));
   assert.deepEqual((await as(unusual,()=>db.query('SELECT auth0_subject FROM origen_accounts'))).rows.map(r=>r.auth0_subject),[unusual]);
   assert.deepEqual((await as(unusual,()=>db.query('SELECT * FROM origen_conversation_summaries'))).rows,[]);
  });
  await t.test('context setup does not freeze a repeatable-read snapshot before serialization',async()=>{
   await as('alice',async()=>{
    const c=await db.connect();try{
     await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
     // Another transaction commits after BEGIN/context setup, before this
     // transaction's first data read (e.g. after waiting for its table lock).
     await owner.query("UPDATE origen_accounts SET first_name='Alice latest' WHERE auth0_subject='alice'");
     assert.equal((await c.query('SELECT first_name FROM origen_accounts')).rows[0].first_name,'Alice latest');
     await c.query('COMMIT');
    }finally{c.release();}
   });
  });
  await t.test('reporting counts records through views that exclude conversation and profile prose',async()=>{
   await as('admin',()=>runAsAnalytics(async()=>{
    assert.equal(Number((await db.query('SELECT count(*) FROM origen_conversation_summaries')).rows[0].count),3);
    await assert.rejects(db.query('SELECT summary FROM origen_conversation_summaries'),{code:'42703'});
    await assert.rejects(db.query('SELECT notes FROM origen_students'),{code:'42703'});
    for(const table of ['origen_topic_notes','origen_workspace_sheets','origen_plans','origen_plan_revisions'])assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows,[]);
    assert.deepEqual((await db.query(`SELECT * FROM ${schema}.origen_conversation_summaries`)).rows,[],'qualifying the private table does not bypass RLS');
   }));
   await as('alice',async()=>assert.deepEqual((await db.query(`SELECT * FROM ${schema}_reporting.origen_conversation_summaries`)).rows,[]));
  });
  await t.test('HTTP authentication is the only source of account and reporting authority',async()=>{
   for(const sub of ['alice','admin'])await as(sub,()=>createPermissionRepository(db).account(sub,{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   const seconds=Math.floor(Date.now()/1000);
   server=createServer(createApp({ADMIN_SUBJECTS:'admin',OPENAI_API_KEY:'synthetic'},async token=>({sub:token,iat:seconds,[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds,permissions:token==='admin'?[...new Set(Object.values(ADMIN_ACTIONS))]:token==='analyst'?['read:activity']:[]}),db,()=>{}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const call=async(sub,path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Authorization:`Bearer ${sub}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
   const read=await call('alice','/api/conversation-history',{action:'load',accountId:accountIds.bob,subject:'bob',purpose:'analytics'});assert.equal(read.status,200);assert.doesNotMatch(JSON.stringify(read.body),/PRIVATE bob/);
   assert.equal((await call('alice','/api/admin',{action:'overview',purpose:'analytics'})).status,403);
   const analytics=await call('analyst','/api/admin',{action:'overview'});assert.equal(analytics.status,200);assert.deepEqual(analytics.body.users,[]);assert.deepEqual(analytics.body.activity,[]);
   assert.equal((await call('analyst','/api/admin',{action:'users'})).status,403);
   assert.equal((await call('alice','/api/account-data',{action:'export',accountId:accountIds.bob})).status,400);
   const exported=await call('alice','/api/account-data',{action:'export'});assert.equal(exported.status,200);assert.doesNotMatch(JSON.stringify(exported.body),/PRIVATE bob/);
   const voice={action:'update-guide',mode:'planning',language:'en',role:'student',studentId:'same-id',memory:[{summary:'FORGED CONTEXT'}]};
   assert.equal((await call('alice','/api/profile-voice',{...voice,studentId:'bob-only'})).status,404);
   const configured=await call('alice','/api/profile-voice',voice);assert.equal(configured.status,200);assert.doesNotMatch(JSON.stringify(configured.body),/PRIVATE bob|FORGED CONTEXT/);assert.match(JSON.stringify(configured.body),/PRIVATE alice summary/);
   for(const action of ['overview','users','user-detail','user-history','user-conversations','review-queue','conversation-quality','voice-quality','onboarding-metrics','engagement','progress-report']){
    const input={action,...(['user-detail','user-history','user-conversations'].includes(action)?{id:accountIds.bob}:{})};
    const r=await call('admin','/api/admin',input);assert.equal(r.status,200,`${action}: ${JSON.stringify(r.body)}`);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE bob/);
   }
   await owner.query('INSERT INTO origen_staff_access_controls(subject_hash,blocked) VALUES($1,true)',[staffHash('admin')]);
   assert.equal((await call('admin','/api/admin',{action:'overview'})).body.error,'staff_access_revoked');
   // Suspension affects staff access only, without deleting private account data.
   assert.equal((await call('admin','/api/family',{action:'load'})).status,200);
   await owner.query('UPDATE origen_staff_access_controls SET blocked=false WHERE subject_hash=$1',[staffHash('admin')]);
   assert.equal((await call('admin','/api/admin',{action:'overview'})).body.error,'staff_access_revoked','unblocking does not revive old tokens');
  });
  await t.test('privileged audit is append-only, actor-bound, and cannot be read by runtime or administrators',async()=>{
   const seconds=Math.floor(Date.now()/1000),who={sub:'alice',[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds};
   await as('alice',()=>requireStaffAccess(db,who,{scope:'institution',action:'load'}));
   await as('alice',async()=>{
    for(const sql of ['SELECT * FROM origen_privileged_access_audit','DELETE FROM origen_privileged_access_audit','UPDATE origen_privileged_access_audit SET action=\'forged\'','DELETE FROM origen_staff_access_controls'])await assert.rejects(db.query(sql),{code:'42501'});
    await assert.rejects(db.query("INSERT INTO origen_privileged_access_audit(id,actor_hash,area,action,outcome) VALUES($1,$2,'admin','overview','authorized')",[randomUUID(),staffHash('bob')]),{code:'42501'});
    assert.deepEqual((await db.query('SELECT * FROM origen_staff_access_controls')).rows,[]);
   });
   const audit=(await owner.query('SELECT * FROM origen_privileged_access_audit')).rows;
   assert.ok(audit.some(r=>r.actor_hash===staffHash('admin')&&r.outcome==='denied'));
   assert.ok(audit.some(r=>r.area==='family'&&r.outcome==='completed'));
   assert.doesNotMatch(JSON.stringify(audit),/PRIVATE|@example|auth0\||Bearer/);
   await as('admin',()=>runAsAnalytics(()=>assert.rejects(db.query('SELECT * FROM origen_privileged_access_audit'),{code:'42501'})));
  });
  await t.test('guidance tools remain owner scoped and retention operates only in its explicit job context',async()=>{
   const guidance=createGuidanceRepository(db),sessionId=randomUUID(),segmentId=randomUUID(),config=guidanceConfig('synthetic','voice',{instructions:'Synthetic policy'});
   await as('bob',()=>guidance.begin('bob',{sessionId,segmentId,topic:'planning',role:'student',language:'en',targetKind:'student',studentId:'same-id'},config));
   const execution=await as('bob',()=>guidance.startExecution('bob',{sessionId,segmentId},config,'lookup_college_applications'));
   await assert.rejects(as('alice',()=>guidance.startExecution('alice',{sessionId,segmentId},config,'lookup_college_applications')),{status:404});
   await as('bob',()=>guidance.finishExecution('bob',execution,{status:'completed',durationMs:1}));
   await owner.query("UPDATE origen_guidance_sessions SET started_at=now()-interval '100 days'");
   await runRetentionJob(async()=>{await purgeGuidanceHistory(db);await purgeProgressHistory(db);await purgeConversationQuality(db);await purgeOnboardingEvents(db);await purgeAdminReviews(db);});
   assert.equal(Number((await owner.query('SELECT count(*) FROM origen_guidance_sessions')).rows[0].count),0);
   assert.equal(Number((await owner.query('SELECT count(*) FROM origen_conversation_summaries')).rows[0].count),3);
  });
  await t.test('account closure cascades under the restricted role and cannot erase someone else',async()=>{
   await as('alice',()=>lifecycle('alice',{action:'delete',confirmation:'DELETE'}));
   for(const table of ['origen_students','origen_conversation_summaries','origen_conversation_lifecycle','origen_topic_notes','origen_workspace_sheets','origen_plans'])assert.equal(Number((await owner.query(`SELECT count(*) FROM ${table} WHERE account_id=$1`,[accountIds.alice])).rows[0].count),0);
   await assert.rejects(as('alice',()=>family('alice',{action:'load'})),{status:403,message:'account_closed'});
   assert.equal((await as('bob',()=>history('bob',{action:'load'}))).items.length,2);
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await runtimePool?.end();
  await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);
  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await owner.query(`DROP ROLE IF EXISTS ${role}`);
  owner.release();await ownerPool.end();
 }
});

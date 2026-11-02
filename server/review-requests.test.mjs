import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateReviewRequest,createReviewRequestRepository} from './review-requests.mjs';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {migrateDatabase} from './database.mjs';
import {assertRuntimeIsolation} from './account-isolation.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';

const draft=(changes={})=>({action:'create',studentId:'alex',requestKey:randomUUID(),connectionId:randomUUID(),origin:'notebook',language:'en',kind:'question',originalQuestion:'Why is there an insurance charge if I already have coverage?',entries:[],...changes});

test('review requests preserve uncertainty and reject forged authority or lifecycle fields',()=>{
 const original='Maybe I am already covered.\nCan my coordinator check?';
 assert.equal(validateReviewRequest(draft({originalQuestion:original})).originalQuestion,original);
 for(const extra of [{accountId:randomUUID()},{coordinatorId:randomUUID()},{status:'submitted'},{confirmed:true},{approvedQuestion:'approved'},{publicationId:randomUUID()},{entries:[{id:randomUUID(),version:1,content:'forged'}]}])assert.throws(()=>validateReviewRequest(draft(extra)),/invalid_review_request/);
 for(const change of [{action:'submit'},{entries:null},{originalQuestion:' '},{originalQuestion:'x'.repeat(2001)},{originalQuestion:'a\x00b'},{proposedClarification:5},{language:'fr'},{origin:'model'},{kind:'resolved'},{entries:Array.from({length:21},()=>({id:randomUUID(),version:1}))}])assert.throws(()=>validateReviewRequest(draft(change)),/invalid_review_request/);
 const id=randomUUID();assert.throws(()=>validateReviewRequest(draft({entries:[{id,version:1},{id:id.toUpperCase(),version:1}]})),/invalid_review_request/);
 for(const version of [undefined,0,-1,1.5,NaN])assert.throws(()=>validateReviewRequest({action:'cancel',studentId:'alex',id,version}),/invalid_review_request/);
});

test('equivalent entry ordering and UUID case produce the same canonical selection',()=>{
 const a=randomUUID(),b=randomUUID(),input=draft({entries:[{id:a,version:1},{id:b,version:2}]});
 assert.deepEqual(validateReviewRequest(input),validateReviewRequest({...input,requestKey:input.requestKey.toUpperCase(),connectionId:input.connectionId.toUpperCase(),entries:[{id:b.toUpperCase(),version:2},{id:a.toUpperCase(),version:1}]}));
});

test('private review records enforce ownership, scope, versions, lifecycle and no delivery',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture({followThrough:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const repo=(input,sub='other')=>f.as(sub,()=>createReviewRequestRepository(f.db,{...f.env,ORIGEN_REVIEW_REQUESTS:'true'})(input));
 const raw=(input,sub='other')=>f.as(sub,async()=>(await f.db.query('SELECT origen_review_request_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result);
 const input=draft({connectionId:connection,entries:[{id:f.notes[0],version:1},{id:f.notes[1],version:1}],proposedClarification:'Please explain how the health insurance charge affects my bill.'});
 let request;
 await t.test('creates an attributed question without a publication, grant, notification, or note copy',async()=>{
  const counts=async()=>Object.fromEntries(await Promise.all(['origen_binder_publications','origen_binder_share_grants','origen_coordinator_notifications','origen_coordinator_outbox'].map(async table=>[table,(await f.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n])));
  const before=await counts();request=(await repo(input)).request;
  assert.equal(request.status,'draft');assert.equal(request.version,1);assert.equal(request.createdBy,'other');assert.equal(request.studentId,'alex');
  assert.equal(request.originalQuestion,input.originalQuestion);assert.equal(request.proposedClarification,input.proposedClarification);
  assert.equal(request.recipient.connectionId,connection);assert.equal(request.recipient.organizationId,f.org);assert.equal(request.recipient.coordinatorName,'staff');
  assert.equal(request.entries.length,2);assert.ok(request.entries.every(e=>e.version===1&&e.digest.length===64&&e.lineageRevision>0));
  assert.equal(request.approved,undefined);assert.equal(request.submittedAt,null);assert.equal(request.publication,null);assert.ok(!JSON.stringify(request).includes('Compare biology programs.'));
  assert.deepEqual(await counts(),before);
  const columns=(await f.owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='origen_review_request_entries'",[f.schema])).rows.map(x=>x.column_name);
  assert.ok(!columns.includes('content'));
 });
 await t.test('simultaneous retries reuse one record; distinct questions get distinct records',async()=>{
  const concurrent=draft({connectionId:connection,origin:'voice',language:'es',originalQuestion:'Creo que ya tengo seguro. ¿Pueden revisar este cargo?'});
  const results=await Promise.all(Array.from({length:5},()=>repo(concurrent)));
  assert.equal(new Set(results.map(r=>r.request.id)).size,1);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_requests WHERE account_id=$1 AND request_key=$2',[account,concurrent.requestKey])).rows[0].n,1);
  assert.notEqual(results[0].request.id,request.id);
  assert.equal((await repo({...input,entries:[...input.entries].reverse()})).request.id,request.id);
  await assert.rejects(repo({...input,originalQuestion:'A different concern'}),{status:409});
 });
 await t.test('parent, another account, other student and forged DB fields cannot access or construct a request',async()=>{
  for(const sub of ['reader','staff','colleague']){
   await assert.rejects(repo({action:'get',studentId:'alex',id:request.id},sub),{status:404});
   await assert.rejects(repo(draft({connectionId:connection}),sub));
  }
  await assert.rejects(repo({action:'get',studentId:'sam',id:request.id}),{status:404});
  await assert.rejects(repo(draft({studentId:'sam',connectionId:connection})),{status:403});
  for(const extra of [{status:'submitted'},{confirmed:true},{accountId:randomUUID()},{coordinatorId:randomUUID()}])assert.equal((await raw({...validateReviewRequest(input),requestKey:randomUUID(),...extra})).error,'invalid_review_request');
  assert.equal((await raw({...validateReviewRequest(input),enabled:true,requestKey:randomUUID(),originalQuestion:7})).error,'invalid_review_request');
 });
 await t.test('wrong-scope, family-derived, missing and stale notes reject the whole draft',async()=>{
  const ownSam=randomUUID();await f.note({action:'create',studentId:'sam',id:ownSam,note:{topic:'costs',kind:'note',content:'Other student private note',language:'en'}},'other');
  const parent=randomUUID();await f.note({action:'create',studentId:'alex',id:parent,note:{topic:'costs',kind:'note',content:'Parent private note',language:'en'}},'reader');
  for(const id of [ownSam,parent,f.notes[3],randomUUID()])await assert.rejects(repo(draft({connectionId:connection,entries:[{id:f.notes[0],version:1},{id,version:1}]})),{status:409});
  await assert.rejects(repo(draft({connectionId:connection,entries:[{id:f.notes[0],version:2}]})),{status:409});
 });
 await t.test('later note edits and deletion never silently rewrite selected evidence',async()=>{
  const before=(await repo({action:'get',studentId:'alex',id:request.id})).request;
  await f.note({action:'update',studentId:'alex',id:f.notes[0],version:1,note:{topic:'options',kind:'note',content:'New private wording',language:'en'}},'other');
  await f.note({action:'delete',studentId:'alex',id:f.notes[1],version:1},'other');
  const after=(await repo({action:'get',studentId:'alex',id:request.id})).request;
  assert.deepEqual(after.entries,before.entries);assert.ok(!JSON.stringify(after).includes('New private wording'));
  await assert.rejects(repo({...input,requestKey:randomUUID()}),{status:409});
 });
 await t.test('the runtime has only the scoped command; RLS also denies accidentally granted reads',async()=>{
  for(const table of ['origen_review_requests','origen_review_request_entries','origen_review_request_tombstones']){
   assert.equal((await f.owner.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`${f.schema}.${table}`])).rows[0].relrowsecurity,true);
   await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
   await assert.rejects(f.as('other',()=>f.db.query(`INSERT INTO ${table} DEFAULT VALUES`)),{code:'42501'});
   await f.owner.query(`GRANT SELECT ON ${table} TO ${f.role}`);
   assert.deepEqual((await f.as('other',()=>f.db.query(`SELECT * FROM ${table}`))).rows,[]);
   await assert.rejects(assertRuntimeIsolation(f.runtime,{schema:f.schema}),/restricted_database_runtime_required/);
   await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});
  }
  await assert.rejects(f.as('other',()=>f.db.query('SELECT origen_review_request_view($1)',[request.id])),{code:'42501'});
  const fn=(await f.owner.query("SELECT proconfig FROM pg_proc WHERE oid='origen_review_request_command(jsonb)'::regprocedure")).rows[0];
  assert.ok(fn.proconfig.some(s=>s===`search_path=${f.schema}, pg_temp`));
  assert.equal((await f.runtime.query('SELECT origen_review_request_command($1::jsonb) AS result',[JSON.stringify({action:'get',studentId:'alex',id:request.id})])).rows[0].result.error,'review_request_denied');
 });
 await t.test('cancellation checks versions and a create replay cannot resurrect a cancelled request',async()=>{
  await assert.rejects(repo({action:'cancel',studentId:'alex',id:request.id,version:7}),{status:409});
  const cancelled=(await repo({action:'cancel',studentId:'alex',id:request.id,version:1})).request;
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.version,2);assert.ok(cancelled.cancelledAt);
  assert.deepEqual((await repo(input)).request,cancelled);
  await assert.rejects(repo({action:'cancel',studentId:'alex',id:request.id,version:1}),{status:409});
  assert.deepEqual((await repo({action:'cancel',studentId:'alex',id:request.id,version:2})).request,cancelled);
 });
 await t.test('owner export includes requests, other exports do not; deletion clears child references',async()=>{
  const data=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));
  assert.ok(data.reviewRequests.some(r=>r.id===request.id));
  const other=await f.as('reader',()=>createLifecycleRepository(f.db)('reader',{action:'export'}));assert.deepEqual(other.reviewRequests,[]);
  const removableInput=draft({connectionId:connection,entries:[{id:f.notes[2],version:1}]});
  const removable=(await repo(removableInput)).request;
  await repo({action:'remove',studentId:'alex',id:removable.id,version:1});
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_entries WHERE request_id=$1',[removable.id])).rows[0].n,0);
  await assert.rejects(repo({action:'get',studentId:'alex',id:removable.id}),{status:404});
  assert.deepEqual(await repo({action:'remove',studentId:'alex',id:removable.id,version:1}),{removed:true});
  await assert.rejects(repo(removableInput),{status:404});
  const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));
  assert.ok(!exported.reviewRequests.some(r=>r.id===removable.id));assert.ok(exported.reviewRequestDeletions.some(r=>r.requestId===removable.id));
 });
 await t.test('revocation prevents new requests but private records survive coordinator offboarding',async()=>{
  await f.owner.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=$1",[connection]);
  await assert.rejects(repo(draft({connectionId:connection})),{status:403});
  await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);
  assert.equal((await repo({action:'get',studentId:'alex',id:request.id})).request.id,request.id);
 });
 await t.test('migrations reapply cleanly and student deletion erases private requests',async()=>{
  await migrateDatabase(f.owner);await assertRuntimeIsolation(f.runtime,{schema:f.schema});
  await f.family('other',{action:'delete-student',id:'alex'});
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_requests WHERE account_id=$1',[account])).rows[0].n,0);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_entries WHERE account_id=$1',[account])).rows[0].n,0);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_tombstones WHERE account_id=$1',[account])).rows[0].n,0);
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createApp} from './index.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {migrateDatabase} from './database.mjs';
import {assertRuntimeIsolation} from './account-isolation.mjs';
import {reviewRequestsEnabled,validateReviewRequest,assertReviewRequestsReady,createReviewRequestRepository} from './review-requests.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';

test('submission requires exact preview, digest, explicit boolean approval and server enablement',()=>{
 assert.equal(reviewRequestsEnabled({}),false);
 assert.equal(reviewRequestsEnabled({ORIGEN_REVIEW_REQUESTS:'true'}),false);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_REVIEW_REQUESTS:'true'}).length);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_REVIEW_REQUESTS:'yes'}).length);
 const input={action:'submit',studentId:'alex',id:randomUUID(),version:1,previewId:randomUUID(),digest:'a'.repeat(64),confirmed:true};
 assert.deepEqual(validateReviewRequest(input),input);
 for(const change of [{confirmed:false},{confirmed:'true'},{confirmed:undefined},{digest:''},{previewId:'wrong'},{enabled:true},{question:'changed'},{recipient:randomUUID()},{spokenYes:true}])assert.throws(()=>validateReviewRequest({...input,...change}),/invalid_review_request/);
});

test('request submission is exact, atomic, private until approval and independent of binder sharing',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture({followThrough:true,reviewRequests:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const call=(input,sub='other')=>f.call(sub,'/api/review-requests',{studentId:'alex',...input});
 const make=async({withNote=true,...changes}={})=>{
  const id=randomUUID();if(withNote)await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'question',content:'Can I waive my campus insurance charge?',language:'en'}},'other');
  return (await call({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',kind:'question',language:'en',originalQuestion:'I think I already have coverage. Can my coordinator review this?',proposedClarification:'Can you explain the insurance charge and waiver requirements?',entries:withNote?[{id,version:1}]:[],...changes})).request;
 };
 const preview=async(r,wording='original')=>(await call({action:'preview',id:r.id,version:r.version,wording})).preview;
 const submitInput=(r,p)=>({action:'submit',id:r.id,version:1,previewId:p.id,digest:p.digest,confirmed:true});
 const submit=async(r,p)=>(await call(submitInput(r,p))).request;
 const row=async r=>(await f.owner.query('SELECT * FROM origen_review_request_publications WHERE request_id=$1',[r.id])).rows[0];
 const raw=async input=>f.as('other',async()=>(await f.db.query('SELECT origen_review_request_command($1::jsonb) AS result',[JSON.stringify({studentId:'alex',enabled:true,...input})])).rows[0].result);
 await assertReviewRequestsReady(f.runtime,f.env);
 await assert.rejects(assertReviewRequestsReady({query:async()=>({rows:[]})},f.env),/migration_required/);
 await assertReviewRequestsReady(null,{});

 await t.test('preview identifies exact content and expires; no publication or notice yet',async()=>{
  const r=await make(),p=await preview(r);
  assert.equal(p.selection.question,r.originalQuestion);assert.equal(p.selection.studentName,'alex');
  assert.equal(p.selection.coordinatorName,'staff');assert.equal(p.selection.organizationId,f.org);
  assert.equal(p.selection.entries.length,1);assert.equal(p.selection.entries[0].id,r.entries[0].id);
  assert.equal(p.selection.originalQuestion,undefined);assert.equal(p.selection.proposedClarification,undefined);
  assert.equal(p.digest.length,64);assert.ok(Date.parse(p.expiresAt)<Date.now()+11*60000);assert.ok(Date.parse(p.accessExpiresAt)>Date.parse(p.expiresAt));
  assert.equal(await row(r),undefined);assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows[0].n,0);
 });
 await t.test('explicit clarification selection shares only that approved wording, with one durable queued notice',async()=>{
  const r=await make(),p=await preview(r,'clarification'),saved=await submit(r,p),stored=await row(r);
  assert.equal(saved.status,'submitted');assert.equal(saved.version,2);assert.equal(saved.publication.access,'active');assert.equal(saved.publication.notification,'pending');
  assert.equal(stored.payload.question,r.proposedClarification);assert.equal(stored.confirmed_by,'other');assert.equal(stored.recipient_subject,'staff');
  assert.equal(stored.payload.originalQuestion,undefined);assert.equal(stored.payload.proposedClarification,undefined);
  const notices=(await f.owner.query("SELECT * FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows;
  assert.equal(notices.length,1);assert.equal(notices[0].resource_id,stored.id);assert.ok(!JSON.stringify(notices).includes('insurance'));
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_previews WHERE request_id=$1',[r.id])).rows[0].n,0);
 });
 await t.test('standalone questions and multiple requests coexist without replacing shared binders',async()=>{
  const before=(await f.owner.query('SELECT count(*)::int AS n FROM origen_binder_publications')).rows[0].n;
  const a=await make({withNote:false,originalQuestion:'¿Por qué aparece este cargo?',language:'es'}),b=await make({withNote:false});
  const pa=await preview(a),pb=await preview(b);await submit(a,pa);await submit(b,pb);
  assert.equal((await row(a)).payload.entries.length,0);assert.equal((await row(a)).payload.question,a.originalQuestion);
  assert.notEqual((await row(a)).id,(await row(b)).id);
  assert.equal((await call({action:'get',id:a.id})).request.publication.access,'active');
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_binder_publications')).rows[0].n,before);
 });
 await t.test('concurrent retries publish once and preserve the original receipt',async()=>{
  const r=await make(),p=await preview(r),results=await Promise.all(Array.from({length:6},()=>submit(r,p)));
  assert.equal(new Set(results.map(x=>x.publication.id)).size,1);assert.equal(new Set(results.map(x=>x.submittedAt)).size,1);
  assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows[0].n,1);
  await assert.rejects(submit(r,{...p,digest:'b'.repeat(64)}),{status:409});
 });
 await t.test('superseded, expired, altered and unapproved previews cannot publish',async()=>{
  const r=await make(),old=await preview(r),current=await preview(r);
  await assert.rejects(submit(r,old),{status:409});
  for(const confirmed of [false,'true',null])assert.equal((await raw({...submitInput(r,current),confirmed})).error,'invalid_review_request');
  assert.equal((await raw({...submitInput(r,current),question:'Other question'})).error,'invalid_review_request');
  await assert.rejects(submit(r,{...current,digest:'b'.repeat(64)}),{status:409});
  await f.owner.query("UPDATE origen_review_request_previews SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 second' WHERE id=$1",[current.id]);
  await assert.rejects(submit(r,current),{status:409});assert.equal(await row(r),undefined);
 });
 await t.test('changed and deleted sources invalidate previews and scrub approved snapshots',async()=>{
  for(const afterSubmit of [false,true]){
   const r=await make(),p=await preview(r);if(afterSubmit)await submit(r,p);
   await f.note({action:'update',studentId:'alex',id:r.entries[0].id,version:1,note:{topic:'costs',kind:'question',content:'New private wording',language:'en'}},'other');
   if(afterSubmit){assert.deepEqual((await row(r)).payload,{});assert.equal((await call({action:'get',id:r.id})).request.publication.access,'unavailable');}
   else{await assert.rejects(submit(r,p),{status:409});assert.equal(await row(r),undefined);}
  }
  const r=await make(),p=await preview(r);await submit(r,p);await f.note({action:'delete',studentId:'alex',id:r.entries[0].id,version:1},'other');assert.deepEqual((await row(r)).payload,{});
 });
 await t.test('another account, student or coordinator cannot preview or confirm a private request',async()=>{
  const r=await make(),p=await preview(r);
  for(const actor of ['reader','staff','colleague']){
   await assert.rejects(call({action:'preview',id:r.id,version:1,wording:'original'},actor),{status:404});
   await assert.rejects(call(submitInput(r,p),actor),{status:404});
  }
  await assert.rejects(call({...submitInput(r,p),studentId:'sam'}),{status:404});
  for(const table of ['origen_review_request_previews','origen_review_request_publications'])await assert.rejects(f.as('staff',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
  for(const signature of ['origen_review_request_base_command(jsonb)','origen_review_request_base_view(uuid)','origen_review_request_live(uuid)','origen_review_request_invalidate(uuid,text)','origen_review_requests_expire()'])assert.equal((await f.owner.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[f.role,signature])).rows[0].allowed,false);
 });
 await t.test('an outbox failure rolls back publication and request status together',async()=>{
  const r=await make(),p=await preview(r);
  await f.owner.query("CREATE FUNCTION synthetic_reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='review-request' THEN RAISE EXCEPTION 'synthetic delivery failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_reject_notice BEFORE INSERT ON origen_coordinator_outbox FOR EACH ROW EXECUTE FUNCTION synthetic_reject_notice()");
  try{await assert.rejects(submit(r,p),{status:503});assert.equal(await row(r),undefined);assert.equal((await call({action:'get',id:r.id})).request.status,'draft');}
  finally{await f.owner.query('DROP TRIGGER synthetic_reject_notice ON origen_coordinator_outbox; DROP FUNCTION synthetic_reject_notice()');}
  assert.equal((await submit(r,p)).status,'submitted');
 });
 await t.test('withdrawal and deletion work with rollout off and prevent replay from restoring access',async()=>{
  const r=await make(),p=await preview(r);await submit(r,p);
  const off=input=>f.as('other',()=>createReviewRequestRepository(f.db,{})(input));
  await assert.rejects(off({studentId:'alex',...submitInput(r,p)}),{status:503});
  const withdrawn=(await off({action:'withdraw',studentId:'alex',id:r.id,version:2})).request;
  assert.equal(withdrawn.status,'withdrawn');assert.deepEqual((await row(r)).payload,{});
  assert.equal((await submit(r,p)).publication.access,'unavailable');
  assert.equal((await f.owner.query("SELECT status FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows[0].status,'suppressed');
  await off({action:'remove',studentId:'alex',id:r.id,version:3});await assert.rejects(submit(r,p),{status:404});assert.equal(await row(r),undefined);
 });
 await t.test('cancellation racing submission has one coherent winner',async()=>{
  const r=await make(),p=await preview(r);
  const results=await Promise.allSettled([call({action:'cancel',id:r.id,version:1}),submit(r,p)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const state=(await call({action:'get',id:r.id})).request;
  assert.ok(['submitted','cancelled'].includes(state.status));assert.equal(!!await row(r),state.status==='submitted');
 });
 await t.test('existing stop-all-sharing invalidates every request without deleting private questions',async()=>{
  const r=await make(),p=await preview(r);await submit(r,p);
  await f.call('other','/api/binder-sharing',{action:'revoke-all',studentId:'alex'});
  assert.deepEqual((await row(r)).payload,{});assert.equal((await call({action:'get',id:r.id})).request.originalQuestion,r.originalQuestion);
 });
 await t.test('maintenance expires previews/publications and keeps review notices held for the future coordinator destination',async()=>{
  const r=await make(),p=await preview(r);await submit(r,p);
  await f.sweep();assert.equal((await f.owner.query("SELECT status FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows[0].status,'pending');
  const waiting=await make(),wp=await preview(waiting);
  await f.owner.query("UPDATE origen_review_request_previews SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 second' WHERE id=$1",[wp.id]);
  await f.owner.query("UPDATE origen_review_request_publications SET published_at=now()-interval '31 days',expires_at=now()-interval '1 second' WHERE request_id=$1",[r.id]);
  await f.sweep();assert.deepEqual((await row(r)).payload,{});assert.equal((await row(r)).invalidation_reason,'expired');
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_previews WHERE id=$1',[wp.id])).rows[0].n,0);
 });
 await t.test('blocking and unblocking a coordinator cannot restore a previous preview or snapshot',async()=>{
  const r=await make(),p=await preview(r),waiting=await make(),wp=await preview(waiting);await submit(r,p);
  await f.owner.query("INSERT INTO origen_staff_access_controls(subject_hash) VALUES(encode(sha256(convert_to('staff','UTF8')),'hex'))");
  assert.deepEqual((await row(r)).payload,{});await assert.rejects(submit(waiting,wp),{status:403});
  await f.owner.query("UPDATE origen_staff_access_controls SET blocked=false WHERE subject_hash=encode(sha256(convert_to('staff','UTF8')),'hex')");
  await assert.rejects(submit(waiting,wp),{status:403});assert.equal((await call({action:'get',id:r.id})).request.publication.access,'unavailable');
  // An explicit new activation/connection still cannot reuse the old approval.
  await f.owner.query("UPDATE origen_coordinator_profiles SET status='active',revision=revision+1 WHERE auth0_subject='staff' AND institution_id=$1",[f.org]);
  await f.owner.query("UPDATE origen_binder_connections SET status='accepted',revision=revision+1 WHERE id=$1",[connection]);
  await assert.rejects(submit(waiting,wp),{status:409});
 });
 await t.test('permission and coordinator revisions invalidate previous previews and publications',async()=>{
  const r=await make(),p=await preview(r),other=await make(),op=await preview(other);await submit(r,p);
  await f.owner.query("UPDATE origen_coordinator_profiles SET revision=revision+1 WHERE auth0_subject='staff' AND institution_id=$1",[f.org]);
  assert.deepEqual((await row(r)).payload,{});await assert.rejects(submit(other,op),{status:409});
  const fresh=await make(),fp=await preview(fresh);await submit(fresh,fp);
  await f.owner.query("UPDATE origen_eligibility SET revision=revision+1 WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");
  assert.deepEqual((await row(fresh)).payload,{});await assert.rejects(async()=>preview(await make()),{status:403});
 });
 await t.test('export includes the approval receipt and account deletion removes all request records',async()=>{
  const data=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(data.reviewRequests.some(r=>r.publication?.submittedAt));
  await migrateDatabase(f.owner);await assertRuntimeIsolation(f.runtime,{schema:f.schema});
  await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
  for(const table of ['origen_review_requests','origen_review_request_previews','origen_review_request_publications','origen_review_request_entries','origen_review_request_tombstones'])assert.equal((await f.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE account_id=$1`,[account])).rows[0].n,0);
 });
});

test('restore clears approvals and replays deleted request receipts without copying private text',{skip:!process.env.DATABASE_TEST_URL,timeout:30000},async t=>{
 const f=await coordinatorPilotFixture({reviewRequests:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const call=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const drafts=[];
 for(let i=0;i<3;i++)drafts.push((await call({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',kind:'question',language:'en',originalQuestion:'PRIVATE_RESTORE_QUESTION',entries:[]})).request);
 const [submitted,waiting,removed]=drafts;
 const p=(await call({action:'preview',id:submitted.id,version:1,wording:'original'})).preview;
 await call({action:'submit',id:submitted.id,version:1,previewId:p.id,digest:p.digest,confirmed:true});
 await call({action:'preview',id:waiting.id,version:1,wording:'original'});
 const snapshot=(await f.owner.query('SELECT to_jsonb(r) AS row FROM origen_review_requests r WHERE id=$1',[removed.id])).rows[0].row;
 await call({action:'remove',id:removed.id,version:1});
 const manifest=await exportDeletionManifest(f.owner);assert.equal(manifest.reviewRequestTombstones.length,1);assert.ok(!JSON.stringify(manifest).includes('PRIVATE_RESTORE_QUESTION'));
 // Simulate a backup taken before removal and the separately retained manifest.
 await f.owner.query('DELETE FROM origen_review_request_tombstones');
 await f.owner.query('INSERT INTO origen_review_requests SELECT * FROM jsonb_populate_record(NULL::origen_review_requests,$1::jsonb)',[JSON.stringify(snapshot)]);
 await replayDeletionManifest(f.owner,manifest);await replayDeletionManifest(f.owner,manifest);
 assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_previews')).rows[0].n,0);
 assert.deepEqual((await f.owner.query('SELECT payload,invalidation_reason FROM origen_review_request_publications WHERE request_id=$1',[submitted.id])).rows[0],{payload:{},invalidation_reason:'restored'});
 assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_requests WHERE id=$1',[removed.id])).rows[0].n,0);
 assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_tombstones WHERE request_id=$1',[removed.id])).rows[0].n,1);
 const retry=await call({action:'submit',id:submitted.id,version:1,previewId:p.id,digest:p.digest,confirmed:true});
 assert.equal(retry.request.publication.access,'unavailable');
});

test('gateway authenticates review requests and keeps removal available when feature is off',{skip:!process.env.DATABASE_TEST_URL,timeout:30000},async t=>{
 const f=await coordinatorPilotFixture();t.after(()=>f.close());
 const server=createServer(createApp({ALLOWED_ORIGINS:'https://origen.example'},async token=>({sub:token}),f.db,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/review-requests`;
 const post=token=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://origen.example',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action:'get',studentId:'alex',id:randomUUID()})});
 assert.equal((await post()).status,401);const response=await post('other');assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});

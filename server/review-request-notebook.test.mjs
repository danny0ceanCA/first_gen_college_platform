import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createReviewRequestRepository,validateReviewRequest} from './review-requests.mjs';

test('notebook discovery rejects client authority and invalid cursors',()=>{
 for(const input of [{action:'list',studentId:'alex',accountId:randomUUID()},{action:'list',studentId:'alex',before:'bad'},{action:'options',studentId:'alex',enabled:true},{action:'options',studentId:'alex',before:randomUUID()}])assert.throws(()=>validateReviewRequest(input),/invalid_review_request/);
});
test('notebook discovery is scoped, paginated, eligible and removable during paused rollout',{skip:!process.env.DATABASE_TEST_URL,timeout:60000},async t=>{
 const f=await coordinatorPilotFixture({reviewRequests:true,followThrough:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const call=(input,actor='other')=>f.call(actor,'/api/review-requests',{studentId:'alex',...input});
 const ids=[];
 await t.test('choices include exact source versions and accepted recipients, excluding family content',async()=>{
  const data=await call({action:'options'});assert.equal(data.connections.length,1);assert.equal(data.connections[0].id,connection);
  assert.equal(data.entries.length,3);assert.ok(data.entries.every(e=>e.version===1&&e.content&&e.language==='en'));
  assert.ok(!JSON.stringify(data).includes('FAMILY_'));assert.ok(!JSON.stringify(data).includes('GLOBAL_SUMMARY_'));
  await assert.rejects(call({action:'options'},'reader'),{status:403});
  await assert.rejects(call({action:'options'},'staff'),{status:404});
 });
 await t.test('history has stable pages and never includes another student or account',async()=>{
  for(let i=0;i<33;i++)ids.push((await call({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:`Question ${i}`,entries:[{id:f.notes[i===0?1:0],version:1}]})).request.id);
  const first=await call({action:'list'});assert.equal(first.enabled,true);assert.equal(first.deliveryEnabled,false);assert.equal(first.requests.length,30);assert.equal(first.nextCursor,first.requests.at(-1).id);
  const next=await call({action:'list',before:first.nextCursor});assert.equal(next.requests.length,3);assert.equal(next.nextCursor,null);
  assert.equal(new Set([...first.requests,...next.requests].map(r=>r.id)).size,33);
  assert.ok(!first.requests.some(r=>r.id===ids[0]));assert.equal(first.activity.find(r=>r.entryId===f.notes[1]).id,ids[0]);
  assert.ok(!JSON.stringify(first.activity).includes('Question '));assert.equal(first.activity.length,2);
  assert.ok(first.requests.every(r=>r.studentId==='alex'&&r.createdBy==='other'));
  assert.equal((await call({action:'list'},'reader')).requests.length,0);
  await assert.rejects(call({action:'list',before:first.nextCursor},'reader'),{status:409});
  await assert.rejects(call({action:'list',studentId:'not-owned'}),{status:404});
  await assert.rejects(f.as('other',()=>f.db.query("SELECT origen_review_request_submission_command('{\"action\":\"export\"}')")),{code:'42501'});
 });
 await t.test('approved and withdrawn status survive reload, and paused mode preserves stop controls',async()=>{
  const id=ids.at(-1),preview=(await call({action:'preview',id,version:1,wording:'original'})).preview;
  await call({action:'submit',id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true});
  assert.equal((await call({action:'list'})).requests.find(r=>r.id===id).publication.notification,'pending');
  const paused=input=>f.as('other',()=>createReviewRequestRepository(f.db,{...f.env,ORIGEN_REVIEW_REQUESTS:'false'})({studentId:'alex',...input}));
  const list=await paused({action:'list'});assert.equal(list.enabled,false);assert.equal(list.requests.length,30);
  await assert.rejects(paused({action:'options'}),{status:503});
  await paused({action:'withdraw',id,version:2});assert.equal((await paused({action:'list'})).requests.find(r=>r.id===id).status,'withdrawn');
  await paused({action:'remove',id,version:3});assert.ok(!(await paused({action:'list'})).requests.some(r=>r.id===id));
 });
 await t.test('permission loss removes composition choices but preserves private history',async()=>{
  await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=encode(sha256(convert_to('other','UTF8')),'hex')");
  const data=await call({action:'list'});assert.equal(data.enabled,false);assert.ok(data.requests.length);
  await assert.rejects(call({action:'options'}),{status:403});
 });
});

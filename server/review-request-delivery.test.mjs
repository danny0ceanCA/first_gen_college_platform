import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {validateCoordinatorReview,reviewDeliveryEnabled,assertReviewDeliveryReady} from './review-request-delivery.mjs';
import {reviewReadback} from './review-request-voice.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';

test('structured responses reject client authority, invalid dates and unsafe resource links',()=>{
 const body={action:'respond',organizationId:randomUUID(),id:randomUUID(),publicationId:randomUUID(),operationId:randomUUID(),version:0,guidance:'Check the waiver requirements.'};
 assert.equal(validateCoordinatorReview(body).suggestedAction,'');
 for(const change of [{enabled:true},{author:'staff'},{studentId:'other'},{version:-1},{version:1.5},{followUpOn:'2027-02-30'},{resourceUrl:'javascript:alert(1)'},{resourceUrl:'http://example.test/'},{resourceUrl:'https://user:password@example.test/'},{guidance:''},{suggestedAction:'x'.repeat(1001)}])assert.throws(()=>validateCoordinatorReview({...body,...change}),/invalid_coordinator_review/);
 assert.equal(reviewDeliveryEnabled({}),false);
 const p={selection:{entries:[],coordinatorName:'Maria',organizationName:'College',studentName:'Alex',question:'What next?'},accessExpiresAt:'2027-01-01T00:00:00Z'};
 assert.match(reviewReadback(p,'en',true),/delivered to your coordinator/);assert.doesNotMatch(reviewReadback(p,'en',true),/not available yet/);
 assert.match(reviewReadback(p,'es',true),/se entregará/);assert.match(reviewReadback(p,'en',false),/not available yet/);
});

test('approved requests reach only the selected coordinator, with structured replies and truthful receipts',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=(input,actor='other')=>f.call(actor,'/api/review-requests',{studentId:'alex',...input});
 const staff=(input,actor='staff')=>f.call(actor,'/api/coordinator-review-requests',{organizationId:f.org,...input});
 const notices=(audience,actor)=>f.call(actor,'/api/coordinator-notifications',{action:'list',audience,...(audience==='staff'?{organizationId:f.org}:{studentId:'alex'})});
 async function make({note=false,approve=true,deliver=true}={}){
  let id;if(note){id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'note',content:'APPROVED_INSURANCE_NOTE',language:'en'}},'other');}
  const r=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:'PRIVATE_ORIGINAL_WORDING',proposedClarification:'Could I qualify for an insurance waiver?',entries:id?[{id,version:1}]:[]})).request;
  if(!approve)return r;
  const p=(await student({action:'preview',id:r.id,version:1,wording:'clarification'})).preview;
  const result=(await student({action:'submit',id:r.id,version:1,previewId:p.id,digest:p.digest,confirmed:true})).request;
  if(deliver)await f.sweep();return result;
 }
 const reply=(r,extra={})=>({action:'respond',id:r.id,publicationId:r.publication.id,version:0,operationId:randomUUID(),guidance:'Compare your current coverage with the campus waiver requirements.',suggestedAction:'Ask the health insurance office about the waiver deadline.',resourceUrl:'https://example.edu/waiver',followUpOn:'2027-02-01',...extra});
 await assertReviewDeliveryReady(f.runtime,f.env);await assertReviewDeliveryReady(null,{});
 await t.test('drafts and undelivered records are private; maintenance delivers one content-free notice',async()=>{
  const draft=await make({approve:false}),r=await make({note:true,deliver:false});
  assert.equal((await staff({action:'list'})).requests.length,0);
  for(const id of [draft.id,r.id])await assert.rejects(staff({action:'read',id}),{status:404});
  f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='false';await f.sweep();assert.equal((await student({action:'list'})).deliveryEnabled,false);assert.equal((await staff({action:'list'})).enabled,false);
  f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='true';await f.sweep();await f.sweep();
  const list=await staff({action:'list'});assert.equal(list.requests.length,1);assert.equal(list.requests[0].openedAt,null);assert.equal(list.requests[0].reviewedAt,null);assert.ok(!JSON.stringify(list).includes('INSURANCE_NOTE'));assert.equal((await student({action:'list'})).deliveryEnabled,true);
  const ns=(await notices('staff','staff')).notifications.filter(n=>n.kind==='review-request');assert.equal(ns.length,1);assert.ok(!JSON.stringify(ns).includes('insurance'));
  const link=await f.call('staff','/api/coordinator-notifications',{action:'open',audience:'staff',organizationId:f.org,id:ns[0].id});assert.equal(link.destination,'review-request');assert.equal(link.grantId,r.id);
  const read=await staff({action:'read',id:r.id});assert.equal(read.question,'Could I qualify for an insurance waiver?');assert.equal(read.entries.length,1);assert.ok(read.openedAt);assert.equal(read.reviewedAt,null);
  for(const secret of ['PRIVATE_ORIGINAL_WORDING','UNPUBLISHED_SENTINEL','FAMILY_CONVERSATION_SENTINEL','GLOBAL_SUMMARY_SENTINEL','sourceDigest','accountId','confirmedBy'])assert.ok(!JSON.stringify(read).includes(secret),secret);
  const receipt=(await student({action:'get',id:r.id})).request;assert.ok(receipt.coordinatorReview.openedAt);assert.equal(receipt.coordinatorReview.reviewedAt,null);assert.equal(receipt.publication.notification,'delivered');
  const reviewed=await staff({action:'review',id:r.id,publicationId:r.publication.id});assert.ok(reviewed.reviewedAt);assert.equal(reviewed.response,null);
 });
 await t.test('same-organization colleagues, owners, other organizations and unverified SQL actors cannot read',async()=>{
  const r=await make();for(const actor of ['colleague','owner','reader'])await assert.rejects(staff({action:'read',id:r.id},actor),e=>[403,404].includes(e.status));
  await assert.rejects(staff({action:'read',id:r.id,organizationId:randomUUID()}),{status:403});
  const raw=await f.as('staff',()=>f.db.query('SELECT origen_coordinator_review_command($1::jsonb) AS result',[JSON.stringify({action:'read',organizationId:f.org,id:r.id,enabled:true})]));assert.equal(raw.rows[0].result.error,'review_access_denied');
  await assert.rejects(f.as('staff',()=>f.db.query('SELECT * FROM origen_review_request_responses')),{code:'42501'});
  assert.equal((await f.owner.query("SELECT has_function_privilege($1,'origen_review_response_view(uuid)','EXECUTE') AS allowed",[f.role])).rows[0].allowed,false);
 });
 await t.test('response, optional action/link/date and retry receipt persist exactly once',async()=>{
  const r=await make(),input=reply(r),results=await Promise.all([staff(input),staff(input)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].response.version,1);
  const before=(await student({action:'get',id:r.id})).request;assert.equal(before.coordinatorReview.response.guidance,input.guidance);assert.equal(before.coordinatorReview.response.suggestedAction,input.suggestedAction);assert.equal(before.coordinatorReview.reviewedAt,null);
  await f.sweep();const ns=(await notices('student','other')).notifications.filter(n=>n.kind==='review-response');assert.equal(ns.length,1);
  const link=await f.call('other','/api/coordinator-notifications',{action:'open',audience:'student',studentId:'alex',id:ns[0].id});assert.equal(link.destination,'review-request');assert.equal(link.grantId,r.id);
  const updated=await staff(reply(r,{version:1,guidance:'Use the updated campus checklist.'}));assert.equal(updated.response.version,2);await assert.rejects(staff(reply(r,{version:1})),{status:409});await assert.rejects(staff({...input,guidance:'Changed retry'}),{status:409});
  assert.equal((await staff({action:'read',id:r.id})).response.guidance,'Use the updated campus checklist.');
  const download=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(JSON.stringify(download).includes('Use the updated campus checklist.'));
  const withdrawal={action:'withdraw-response',id:r.id,publicationId:r.publication.id,version:2,operationId:randomUUID()};await staff(withdrawal);await staff(withdrawal);
  const after=(await student({action:'get',id:r.id})).request;assert.equal(after.coordinatorReview.response.status,'withdrawn');assert.equal(after.coordinatorReview.response.guidance,'');assert.equal(after.coordinatorReview.response.resourceUrl,'');
  await assert.rejects(staff(reply(r,{version:3})),{status:409});await f.sweep();assert.equal((await notices('student','other')).notifications.filter(n=>n.kind==='review-response').length,0);
 });
 await t.test('a notification failure rolls the response back; an uncertain retry uses the same operation',async()=>{
  const r=await make(),input=reply(r);
  await f.owner.query("CREATE FUNCTION synthetic_reject_review_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='review-response' THEN RAISE EXCEPTION 'synthetic failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER synthetic_reject_review_response BEFORE INSERT ON origen_coordinator_outbox FOR EACH ROW EXECUTE FUNCTION synthetic_reject_review_response()");
  try{await assert.rejects(staff(input),{status:503});assert.equal((await student({action:'get',id:r.id})).request.coordinatorReview.response,null);}
  finally{await f.owner.query('DROP TRIGGER synthetic_reject_review_response ON origen_coordinator_outbox;DROP FUNCTION synthetic_reject_review_response()');}
  assert.equal((await staff(input)).response.version,1);
 });
 await t.test('withdrawal, source edits, expiry and deletion remove access and links',async()=>{
  for(const mode of ['withdraw','source','expiry','delete']){
   const r=await make({note:mode==='source'});await staff(reply(r));await f.sweep();
   if(mode==='withdraw')await student({action:'withdraw',id:r.id,version:2});
   if(mode==='source')await f.note({action:'update',studentId:'alex',id:r.entries[0].id,version:1,note:{topic:'costs',kind:'note',content:'New private text',language:'en'}},'other');
   if(mode==='expiry')await f.owner.query("UPDATE origen_review_request_publications SET published_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE request_id=$1",[r.id]);
   if(mode==='delete')await student({action:'remove',id:r.id,version:2});
   await assert.rejects(staff({action:'read',id:r.id}),{status:404});await assert.rejects(staff(reply(r,{version:1})),{status:404});
   assert.ok(!(await staff({action:'list'})).requests.some(x=>x.id===r.id));
   if(mode==='delete')assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_responses WHERE request_id=$1',[r.id])).rows[0].n,0);
   else assert.equal((await student({action:'get',id:r.id})).request.coordinatorReview.response.status,'available');
  }
 });
 await t.test('delivery pause holds new notices and blocks staff reads while student controls remain available',async()=>{
  const r=await make({deliver:false});f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='false';await f.sweep();await assert.rejects(staff({action:'read',id:r.id}),{status:503});assert.equal((await staff({action:'list'})).enabled,false);
  await student({action:'withdraw',id:r.id,version:2});f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='true';await f.sweep();await assert.rejects(staff({action:'read',id:r.id}),{status:404});
 });
 await t.test('revocation races have an ordered result and cannot leave readable access',async()=>{
  const r=await make();const results=await Promise.allSettled([staff(reply(r)),student({action:'withdraw',id:r.id,version:2})]);
  assert.equal(results[1].status,'fulfilled');if(results[0].status==='rejected')assert.equal(results[0].reason.status,404);
  await assert.rejects(staff({action:'read',id:r.id}),{status:404});
 });
 await t.test('metadata pagination reaches older requests without duplication or private prose',async()=>{
  const created=[];for(let i=0;i<32;i++)created.push(await make({deliver:false}));await f.sweep();
  const first=await staff({action:'list'});assert.equal(first.requests.length,30);assert.ok(first.nextCursor);
  const second=await staff({action:'list',before:first.nextCursor});assert.equal(second.nextCursor,null);
  const rows=[...first.requests,...second.requests],ids=new Set(rows.map(r=>r.id));assert.equal(ids.size,rows.length);
  for(const r of created)assert.ok(ids.has(r.id));assert.ok(!JSON.stringify(rows).includes('PRIVATE_ORIGINAL_WORDING'));assert.ok(rows.every(r=>!Object.hasOwn(r,'question')));
  await assert.rejects(staff({action:'list',before:randomUUID()}),{status:409});
  for(const r of created)await student({action:'remove',id:r.id,version:2});
 });
 await t.test('restoring an older response cannot resurrect withdrawn coordinator prose',async()=>{
  const r=await make();await staff(reply(r));const row=(await f.owner.query('SELECT * FROM origen_review_request_responses WHERE request_id=$1',[r.id])).rows[0];
  await staff({action:'withdraw-response',id:r.id,publicationId:r.publication.id,version:1,operationId:randomUUID()});const manifest=await exportDeletionManifest(f.owner);
  await f.owner.query('UPDATE origen_review_request_responses SET version=1,guidance=$2,suggested_action=$3,resource_url=$4,follow_up_on=$5,withdrawn_at=NULL WHERE request_id=$1',[r.id,row.guidance,row.suggested_action,row.resource_url,row.follow_up_on]);
  await replayDeletionManifest(f.owner,manifest);const restored=(await student({action:'get',id:r.id})).request;assert.equal(restored.coordinatorReview.response.guidance,'');assert.equal(restored.coordinatorReview.response.status,'withdrawn');await assert.rejects(staff({action:'read',id:r.id}),e=>[403,404].includes(e.status));
 });
});

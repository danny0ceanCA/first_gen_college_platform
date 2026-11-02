import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createReviewResponseConnectionRepository,validateReviewResponseInspection} from './review-response-connections.mjs';
import {validateReviewResponseReference,validateReviewResponseIntent} from '../src/reviewResponseConnection.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';

const source=(requestId,responseVersion=1)=>({kind:'review-response',requestId,responseVersion});
const untouched={opened:'not_recorded',discussed:'not_recorded',actionAccepted:'not_recorded'};
const databaseTest={skip:!process.env.DATABASE_TEST_URL,timeout:120000};

test('versioned references carry identity and purpose, never prose or client authority',()=>{
 const ref=source(randomUUID().toUpperCase());
 assert.deepEqual(validateReviewResponseReference(ref),{...ref,requestId:ref.requestId.toLowerCase()});
 for(const purpose of ['conversation-focus','private-choice','related-request'])assert.equal(validateReviewResponseIntent({purpose,source:ref}).purpose,purpose);
 for(const value of [null,[],{}, {...ref,kind:'coordinator-feedback'},{...ref,responseVersion:0},{...ref,responseVersion:1.5},{...ref,responseVersion:2147483648},{...ref,responseVersion:'1'},{...ref,requestId:'not-an-id'},{...ref,guidance:'Copied text'},{...ref,accountId:randomUUID()},{...ref,enabled:true}])assert.throws(()=>validateReviewResponseReference(value),/invalid_review_response_reference/);
 for(const value of [{purpose:'accept-action',source:ref},{purpose:'private-choice',source:ref,confirmed:true},{purpose:'related-request',source:ref,approved:true}])assert.throws(()=>validateReviewResponseIntent(value),/invalid_review_response_reference/);
 const input={action:'inspect',studentId:'alex',source:ref};
 assert.equal(validateReviewResponseInspection(input).source.requestId,ref.requestId.toLowerCase());
 for(const extra of [{enabled:true},{aiEligible:true},{studentOpened:true},{subject:'other'},{action:'accept'},{studentId:'\n'}])assert.throws(()=>validateReviewResponseInspection({...input,...extra}),/invalid_review_response_reference/);
});

async function fixture(t,options={}){
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true,...options});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const inspect=(id,version=1,actor='other',studentId='alex')=>f.as(actor,()=>createReviewResponseConnectionRepository(f.db)({action:'inspect',studentId,source:source(id,version)})).then(x=>x.connection);
 const reply=(r,version=0,guidance='Compare the waiver requirements.')=>staff({action:'respond',id:r.id,publicationId:r.publication.id,version,operationId:randomUUID(),guidance,suggestedAction:'Ask the insurance office.',resourceUrl:'https://example.edu/waiver',followUpOn:'2027-02-01'});
 const make=async({respond=true,note=false}={})=>{
  let id;if(note){id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'note',content:'SELECTED_NOTE',language:'en'}},'other');}
  const draft=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:'PRIVATE_ORIGINAL_QUESTION',proposedClarification:'Which waiver documents should I check?',entries:id?[{id,version:1}]:[]})).request;
  const preview=(await student({action:'preview',id:draft.id,version:1,wording:'clarification'})).preview;
  const r=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;
  await f.sweep();if(respond)await reply(r);return r;
 };
 return {...f,account,connection,student,staff,inspect,reply,make};
}

test('response connection metadata is exact, scoped, and read-only',databaseTest,async t=>{
 const f=await fixture(t);
 await t.test('metadata preserves attribution, question distinctions and separate receipt facts',async()=>{
  const r=await f.make(),c=await f.inspect(r.id);
  assert.equal(c.availability,'current');assert.deepEqual(c.source,source(r.id));
  assert.equal(c.request.originalQuestion,'PRIVATE_ORIGINAL_QUESTION');assert.equal(c.request.approvedQuestion,'Which waiver documents should I check?');assert.equal(c.request.approvedWording,'clarification');
  assert.equal(c.response.author.name,r.recipient.coordinatorName);assert.equal(c.response.organization.name,r.recipient.organizationName);assert.equal(c.response.author.coordinatorId,r.recipient.coordinatorId);assert.equal(c.response.organization.id,f.org);
  assert.ok(c.response.createdAt);assert.ok(c.response.updatedAt);assert.deepEqual(c.studentActivity,untouched);assert.equal(c.notification.status,'pending');assert.equal(c.notification.deliveredAt,null);
  assert.deepEqual(c.scope,{aiEligible:true,requestPublicationCurrent:true,historicalRequiresExplicitFocus:false});
  for(const secret of ['Compare the waiver','Ask the insurance office','example.edu','SELECTED_NOTE','UNPUBLISHED_SENTINEL','FAMILY_CONVERSATION_SENTINEL','GLOBAL_SUMMARY_SENTINEL','author_subject','accountId'])assert.ok(!JSON.stringify(c).includes(secret),secret);
  await f.sweep();const delivered=await f.inspect(r.id);assert.equal(delivered.notification.status,'delivered');assert.ok(delivered.notification.deliveredAt);assert.equal(delivered.request.coordinatorOpenedAt,null);assert.equal(delivered.request.coordinatorReviewedAt,null);assert.deepEqual(delivered.studentActivity,untouched);
  const ns=await f.call('other','/api/coordinator-notifications',{action:'list',audience:'student',studentId:'alex'});
  const notice=ns.notifications.find(n=>n.kind==='review-response'&&n.grantId===r.id)||ns.notifications.find(n=>n.kind==='review-response');
  assert.ok(notice);await f.call('other','/api/coordinator-notifications',{action:'open',audience:'student',studentId:'alex',id:notice.id});
  assert.deepEqual((await f.inspect(r.id)).studentActivity,untouched);
  await f.staff({action:'read',id:r.id});await f.staff({action:'review',id:r.id,publicationId:r.publication.id});
  const after=await f.inspect(r.id);assert.ok(after.request.coordinatorOpenedAt);assert.ok(after.request.coordinatorReviewedAt);assert.deepEqual(after.studentActivity,untouched);
  // A READ ONLY transaction would reject hidden activity/notification writes.
  await f.as('other',async()=>{const c=await f.db.connect();try{await c.query('BEGIN READ ONLY');const result=await createReviewResponseConnectionRepository(c)({action:'inspect',studentId:'alex',source:source(r.id)});assert.deepEqual(result.connection,after);await c.query('COMMIT');}finally{c.release();}});
  const receipt=(await f.student({action:'get',id:r.id})).request;assert.deepEqual(receipt.coordinatorReview.connection,after);
  const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(JSON.stringify(exported).includes('"kind":"review-response"'));
  const staff=await f.staff({action:'read',id:r.id});assert.ok(!JSON.stringify(staff).includes('PRIVATE_ORIGINAL_QUESTION'));assert.ok(!Object.hasOwn(staff,'studentActivity'));assert.ok(!Object.hasOwn(staff,'connection'));
 });
 await t.test('other accounts, other local students, staff, parents and unscoped SQL cannot inspect',async()=>{
  const r=await f.make();
  for(const actor of ['reader','staff','colleague','owner'])await assert.rejects(f.inspect(r.id,1,actor),{status:404});
  await assert.rejects(f.inspect(r.id,1,'other','sam'),{status:404});await assert.rejects(f.inspect(randomUUID()),{status:404});
  const input={action:'inspect',studentId:'alex',source:source(r.id)};
  assert.equal((await f.runtime.query('SELECT origen_review_response_connection_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result.error,'review_response_denied');
  for(const extra of [{enabled:true},{aiEligible:true},{action:'mark-discussed'},{source:{...source(r.id),kind:'coordinator-feedback'}},{source:{...source(r.id),responseVersion:2147483648}},{source:{...source(r.id),guidance:'Copied'}}]){
   const result=await f.as('other',()=>f.db.query('SELECT origen_review_response_connection_command($1::jsonb) AS result',[JSON.stringify({...input,...extra})]));assert.equal(result.rows[0].result.error,'invalid_review_response_reference');
  }
  await assert.rejects(f.as('other',()=>f.db.query('SELECT * FROM origen_review_request_responses')),{code:'42501'});
  const acl=(await f.owner.query("SELECT has_function_privilege($1,'origen_review_response_connection(uuid,integer)','EXECUTE') AS helper,has_function_privilege($1,'origen_review_response_provenance()','EXECUTE') AS trigger",[f.role])).rows[0];assert.deepEqual(acl,{helper:false,trigger:false});
  const functions=(await f.owner.query("SELECT p.provolatile,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname IN ('origen_review_response_connection','origen_review_response_connection_command')",[f.schema])).rows;
  assert.equal(functions.length,2);assert.ok(functions.every(p=>p.provolatile==='s'&&p.proconfig.some(c=>c.includes(f.schema))));
 });
 await t.test('no response, a revised response and a withdrawn response are distinct',async()=>{
  const r=await f.make({respond:false});assert.equal((await f.inspect(r.id)).reason,'no_response');
  await f.reply(r);const before=await f.inspect(r.id);await f.sweep();await f.reply(r,1,'UPDATED_GUIDANCE');
  assert.deepEqual(await f.inspect(r.id),{availability:'unavailable',reason:'response_changed',source:source(r.id),currentVersion:2});
  const current=await f.inspect(r.id,2);assert.equal(current.availability,'current');assert.equal(current.notification.status,'pending');assert.equal(current.notification.deliveredAt,null);assert.deepEqual(current.response.author,before.response.author);assert.equal(current.response.createdAt,before.response.createdAt);assert.notEqual(current.response.updatedAt,before.response.updatedAt);assert.deepEqual(current.studentActivity,untouched);
  await f.staff({action:'withdraw-response',id:r.id,publicationId:r.publication.id,version:2,operationId:randomUUID()});
  for(const version of [1,2,3]){const c=await f.inspect(r.id,version);assert.equal(c.availability,'unavailable');assert.equal(c.reason,'response_withdrawn');assert.ok(!Object.hasOwn(c,'response'));}
  const receipt=(await f.student({action:'get',id:r.id})).request;assert.equal(receipt.coordinatorReview.response.guidance,'');assert.equal(receipt.coordinatorReview.connection.reason,'response_withdrawn');
 });
 await t.test('request withdrawal, source changes and expiry retain a historical private receipt',async()=>{
  for(const mode of ['withdrawn','source_changed','expired']){
   const r=await f.make({note:mode==='source_changed'});await f.sweep();
   if(mode==='withdrawn')await f.student({action:'withdraw',id:r.id,version:2});
   if(mode==='source_changed')await f.note({action:'update',studentId:'alex',id:r.entries[0].id,version:1,note:{topic:'costs',kind:'note',content:'NEW_PRIVATE_NOTE',language:'en'}},'other');
   if(mode==='expired')await f.owner.query("UPDATE origen_review_request_publications SET published_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE request_id=$1",[r.id]);
   const c=await f.inspect(r.id);assert.equal(c.availability,'historical');assert.equal(c.reason,mode);assert.deepEqual(c.scope,{aiEligible:true,requestPublicationCurrent:false,historicalRequiresExplicitFocus:true});assert.equal(c.request.approvedQuestion,'Which waiver documents should I check?');assert.deepEqual(c.studentActivity,untouched);
   await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});
   assert.equal((await f.student({action:'get',id:r.id})).request.coordinatorReview.response.status,'available');
  }
 });
 await t.test('rollout pause preserves private receipts and cannot create a new voice/action capability',async()=>{
  const r=await f.make(),before=await f.inspect(r.id);const flags={...f.env};
  try{for(const key of Object.keys(f.env))if(key.startsWith('ORIGEN_'))f.env[key]='false';assert.deepEqual(await f.inspect(r.id),before);assert.equal((await f.student({action:'get',id:r.id})).request.coordinatorReview.connection.availability,'current');}
  finally{Object.assign(f.env,flags);}
  // The foundation has no mounted endpoint or registered tool. Existing request
  // endpoints cannot accept student activity or model-supplied capability flags.
  for(const extra of [{action:'mark-discussed'},{action:'accept-action'},{action:'get',id:r.id,aiEligible:true}])await assert.rejects(f.student(extra),{status:400});
 });
 await t.test('deletion removes provenance, metadata and response; old references do not revive it',async()=>{
  const r=await f.make();await f.student({action:'remove',id:r.id,version:2});await assert.rejects(f.inspect(r.id),{status:404});
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_responses WHERE request_id=$1',[r.id])).rows[0].n,0);
  const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(!JSON.stringify(exported).includes('"requestId":"'+r.id+'","responseVersion"'));
 });
 await t.test('migration replay is safe and student deletion cascades the new provenance',async()=>{
  const r=await f.make();await migrateDatabase(f.owner);assert.equal((await f.inspect(r.id)).availability,'current');
  await f.family('other',{action:'delete-student',id:'alex'});await assert.rejects(f.inspect(r.id),{status:404});
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_responses WHERE account_id=$1',[f.account])).rows[0].n,0);
 });
});

test('connection loss and directory changes preserve historical attribution without restoring staff access',databaseTest,async t=>{
 const f=await fixture(t),r=await f.make(),before=await f.inspect(r.id);
 await f.owner.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=$1",[f.connection]);
 await f.owner.query("UPDATE origen_coordinator_profiles SET display_name='Renamed coordinator' WHERE id=$1",[r.recipient.coordinatorId]);
 await f.owner.query("UPDATE origen_institutions SET draft=jsonb_set(draft,'{name}','\"Renamed institution\"') WHERE id=$1",[f.org]);
 const after=await f.inspect(r.id);assert.equal(after.availability,'historical');assert.equal(after.reason,'access_changed');assert.deepEqual(after.response,before.response);assert.equal(after.scope.aiEligible,true);assert.equal(after.scope.historicalRequiresExplicitFocus,true);
 await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});
 // Even a reopened relationship does not reactivate an old publication.
 await f.owner.query("UPDATE origen_binder_connections SET status='accepted',revision=revision+1 WHERE id=$1",[f.connection]);assert.equal((await f.inspect(r.id)).availability,'historical');
});

test('expired or revoked AI permission retains privacy controls but makes history ineligible for AI',databaseTest,async t=>{
 const f=await fixture(t,{permission:'approved'}),r=await f.make(),hash=createHash('sha256').update('other').digest('hex');
 await f.owner.query("UPDATE origen_eligibility SET permission_expires_at=now()-interval '1 minute' WHERE subject_hash=$1",[hash]);
 let c=await f.inspect(r.id);assert.equal(c.availability,'historical');assert.equal(c.scope.aiEligible,false);assert.equal(c.scope.requestPublicationCurrent,false);
 await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[hash]);
 c=await f.inspect(r.id);assert.equal(c.scope.aiEligible,false);assert.ok((await f.student({action:'get',id:r.id})).request);
 await f.owner.query("UPDATE origen_eligibility SET status='approved',permission_expires_at=now()+interval '1 day',revision=revision+1 WHERE subject_hash=$1",[hash]);
 c=await f.inspect(r.id);assert.equal(c.scope.aiEligible,true);assert.equal(c.availability,'historical');assert.equal(c.scope.historicalRequiresExplicitFocus,true);
 await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);assert.equal((await f.inspect(r.id)).scope.aiEligible,false);
});

test('restore keeps only version-fenced private history and never restores coordinator access',databaseTest,async t=>{
 const f=await fixture(t),retained=await f.make(),edited=await f.make(),withdrawn=await f.make(),removed=await f.make();
 await f.reply(edited,1,'CURRENT_EDIT');await f.staff({action:'withdraw-response',id:withdrawn.id,publicationId:withdrawn.publication.id,version:1,operationId:randomUUID()});
 const removedRow=(await f.owner.query('SELECT row_to_json(r) AS row FROM origen_review_requests r WHERE id=$1',[removed.id])).rows[0].row;
 await f.student({action:'remove',id:removed.id,version:2});const manifest=await exportDeletionManifest(f.owner);
 assert.ok(!JSON.stringify(manifest).includes('Compare the waiver'));assert.ok(!JSON.stringify(manifest).includes('Synthetic Community'));
 // Simulate an older backup after loading its rows, before allowing traffic.
 await f.owner.query("UPDATE origen_review_request_responses SET version=1,guidance='STALE_PROSE',withdrawn_at=NULL WHERE request_id=ANY($1::uuid[])",[[edited.id,withdrawn.id]]);
 await f.owner.query('INSERT INTO origen_review_requests SELECT * FROM jsonb_populate_record(NULL::origen_review_requests,$1::jsonb)',[JSON.stringify(removedRow)]);
 await replayDeletionManifest(f.owner,manifest);
 const history=await f.inspect(retained.id);assert.equal(history.availability,'historical');assert.equal(history.reason,'restored');assert.equal(history.scope.historicalRequiresExplicitFocus,true);assert.equal(history.notification.status,'not_recorded');assert.equal(history.notification.deliveredAt,null);assert.deepEqual(history.studentActivity,untouched);
 for(const r of [edited,withdrawn]){const c=await f.inspect(r.id);assert.equal(c.availability,'unavailable');assert.equal(c.reason,'response_withdrawn');assert.equal((await f.student({action:'get',id:r.id})).request.coordinatorReview.response.guidance,'');}
 await assert.rejects(f.inspect(removed.id),{status:404});await assert.rejects(f.staff({action:'read',id:retained.id}),e=>[403,404].includes(e.status));
});

test('upgrading existing responses backfills historical attribution and preserves withdrawal',databaseTest,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-response-upgrade-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const migrations=new URL('./migrations/',import.meta.url);
 for(const name of await readdir(migrations))if(/^\d+.*\.sql$/.test(name)&&Number.parseInt(name,10)<100)await copyFile(new URL(name,migrations),join(directory,name));
 const f=await fixture(t,{migrationDirectory:pathToFileURL(directory+'/')}),r=await f.make(),withdrawn=await f.make();
 await f.reply(r,1,'EXISTING_EDIT');await f.staff({action:'withdraw-response',id:withdrawn.id,publicationId:withdrawn.publication.id,version:1,operationId:randomUUID()});
 await f.owner.query("UPDATE origen_coordinator_profiles SET display_name='Changed since response' WHERE id=$1",[r.recipient.coordinatorId]);
 const before=(await f.student({action:'get',id:r.id})).request.coordinatorReview.response;assert.equal(before.version,2);
 await migrateDatabase(f.owner);await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});
 const c=await f.inspect(r.id,2);assert.equal(c.availability,'historical');assert.equal(c.response.author.name,r.recipient.coordinatorName);assert.equal(c.response.organization.name,r.recipient.organizationName);assert.deepEqual((await f.student({action:'get',id:r.id})).request.coordinatorReview.response,before);
 assert.equal((await f.inspect(withdrawn.id,2)).reason,'response_withdrawn');
 // The same existing account-deletion path erases new provenance with the body.
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
 await assert.rejects(f.inspect(r.id,2),{status:404});assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_responses WHERE account_id=$1',[f.account])).rows[0].n,0);
});

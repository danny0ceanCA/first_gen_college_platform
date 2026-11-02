import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {loadReviewResponseContext,verifyReviewResponseContext,validateReviewResponseContext,validateReviewResponseGuard,reviewResponseSearch,reviewResponseContextEnabled,assertReviewResponseContextReady} from './review-response-context.mjs';
import {createLiveMemoryRepository,createLiveMemoryService} from './live-memory.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';

const enabled={skip:!process.env.DATABASE_TEST_URL,timeout:120000};
const source=(id,version=1)=>({kind:'review-response',requestId:id,responseVersion:version});
test('lookup contracts reject scope/capability forgery; matching uses bounded English/Spanish topic vocabulary',()=>{
 const base={studentId:'alex',query:'Could you explain the insurance waiver?'};
 assert.deepEqual(validateReviewResponseContext(base),base);
 for(const extra of [{enabled:true},{subject:'other'},{mode:'focus'},{studentId:null},{query:'x'.repeat(1001)},{focus:source(randomUUID())},{voice:{sessionId:randomUUID()}}])assert.throws(()=>validateReviewResponseContext({...base,...extra}),{status:400});
 assert.equal(reviewResponseContextEnabled({},'other'),false);assert.equal(reviewResponseContextEnabled({ORIGEN_REVIEW_RESPONSE_CONTEXT:'true'},'other'),false);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_REVIEW_RESPONSE_CONTEXT:'true'}).some(x=>x.includes('requires review requests')));
 assert.ok(coordinatorConfigurationIssues({ORIGEN_REVIEW_RESPONSE_CONTEXT:'yes'}).some(x=>x.includes('use true or false')));
 assert.ok(reviewResponseSearch('¿Qué dijo sobre la exención del seguro?').terms.includes('waiver'));
 assert.ok(reviewResponseSearch('Could you explain health coverage?').terms.includes('seguro'));
 assert.deepEqual(reviewResponseSearch('Can you help me please?').terms,[]);
 assert.ok(reviewResponseSearch('x'.repeat(1000)).terms.length===0);
 const guard={source:source(randomUUID()),revision:'a'.repeat(64),mode:'focus'};assert.deepEqual(validateReviewResponseGuard(guard),guard);
 for(const extra of [{enabled:true},{mode:'historical'},{revision:'forged'}])assert.throws(()=>validateReviewResponseGuard({...guard,...extra}),{status:400});
});

async function fixture(t){
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true});t.after(()=>f.close());
 Object.assign(f.env,{ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on'});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const lookup=(selection,options={},actor='other',studentId='alex',db=f.db)=>f.as(actor,()=>loadReviewResponseContext(db,actor,{studentId,...selection},f.env,options));
 const verify=guard=>f.as('other',()=>verifyReviewResponseContext(f.db,'other','alex',guard,f.env));
 const reply=(r,version=0,guidance='Compare your insurance coverage with campus waiver requirements.')=>staff({action:'respond',id:r.id,publicationId:r.publication.id,version,operationId:randomUUID(),guidance,suggestedAction:'Ask the insurance office for the accepted proof.',resourceUrl:'https://example.edu/waiver',followUpOn:'2027-02-01'});
 const make=async(question='Which insurance waiver documents should I check?',{notes=[],respond=true,language='en'}={})=>{
  const draft=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language,kind:'question',originalQuestion:'UNAPPROVED_ORIGINAL',proposedClarification:question,entries:notes.map(id=>({id,version:1}))})).request;
  const preview=(await student({action:'preview',id:draft.id,version:1,wording:'clarification'})).preview;
  const r=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;
  await f.sweep();if(respond)await reply(r);return r;
 };
 return {...f,account,connection,student,staff,lookup,verify,reply,make};
}

test('bounded response retrieval preserves ownership, exact versions and meaningful relevance',enabled,async t=>{
 const f=await fixture(t),r=await f.make(undefined,{notes:[f.notes[1]]});
 await t.test('explicit focus returns exactly the selected response and approved question',async()=>{
  const result=await f.lookup({focus:source(r.id)});assert.equal(result.status,'retrieved');assert.deepEqual(result.response.source,source(r.id));assert.equal(result.response.guidance,'Compare your insurance coverage with campus waiver requirements.');assert.equal(result.response.approvedQuestion,'Which insurance waiver documents should I check?');assert.equal(result.response.author.name,r.recipient.coordinatorName);assert.equal(result.response.organization.id,f.org);assert.equal(result.response.untrusted,true);
  for(const secret of ['UNAPPROVED_ORIGINAL','UNPUBLISHED_SENTINEL','FAMILY_CONVERSATION_SENTINEL','GLOBAL_SUMMARY_SENTINEL','Ask about local scholarships.','openedAt','studentActivity','author_subject'])assert.ok(!JSON.stringify(result).includes(secret),secret);
  assert.equal((await f.verify(result.guard)).status,'current');
  const receipt=(await f.student({action:'get',id:r.id})).request;assert.deepEqual(receipt.coordinatorReview.connection.studentActivity,{opened:'not_recorded',discussed:'not_recorded',actionAccepted:'not_recorded'});assert.equal(receipt.coordinatorReview.openedAt,null);
 });
 await t.test('relevant spoken questions work in English and Spanish; unrelated topics and empty requests return none',async()=>{
  for(const query of ['Could you explain the insurance waiver?','¿Qué dijo sobre la exención del seguro?'])assert.equal((await f.lookup({query})).response.source.requestId,r.id);
  // Sharing the costs divider or a substring is insufficient evidence.
  for(const query of ['How do I improve my essay?','Can you explain FAFSA?','Are paid internships available?','Can you help me please?','Can I get that document?',''])assert.equal((await f.lookup({query})).status,'none',query);
  const scholarship=await f.make('Which scholarships are available?');await f.student({action:'withdraw',id:r.id,version:2});
  assert.equal((await f.lookup({query:'What about SHIP health coverage?'})).status,'none');
  assert.equal((await f.lookup({query:'Quiero hablar de becas.'})).response.source.requestId,scholarship.id);
  await f.student({action:'remove',id:scholarship.id,version:2});
 });
 await t.test('withdrawn requests are available only through exact explicit historical focus',async()=>{
  assert.equal((await f.lookup({query:'insurance waiver'})).status,'none');
  const result=await f.lookup({focus:source(r.id)});assert.equal(result.status,'retrieved');assert.equal(result.response.availability,'historical');assert.equal(result.response.historyReason,'withdrawn');assert.equal((await f.verify(result.guard)).status,'current');
  await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});
 });
 await t.test('multiple matching requests require clarification and contain no response bodies',async()=>{
  const a=await f.make('Which health insurance documents are accepted?'),b=await f.make('What is the insurance waiver deadline?');
  const result=await f.lookup({query:'Could we discuss health insurance?'});assert.equal(result.status,'clarification_required');assert.equal(result.reason,'multiple_responses');assert.equal(result.choices.length,2);assert.deepEqual(new Set(result.choices.map(c=>c.source.requestId)),new Set([a.id,b.id]));assert.ok(!JSON.stringify(result).includes('Compare your insurance coverage'));assert.ok(!Object.hasOwn(result,'guard'));
  assert.equal((await f.lookup({focus:source(a.id)})).response.source.requestId,a.id);assert.equal((await f.lookup({focus:source(b.id)})).response.source.requestId,b.id);
 });
 await t.test('cross-account, wrong student, staff, family scope and forged flags disclose no body',async()=>{
  for(const actor of ['reader','staff','colleague','owner'])assert.equal((await f.lookup({focus:source(r.id)},{},actor)).status,'unavailable');
  assert.equal((await f.lookup({focus:source(r.id)},{},'other','sam')).status,'unavailable');
  const unknown=await f.lookup({focus:source(randomUUID())});assert.equal(unknown.status,'unavailable');
  for(const extra of [{enabled:true},{aiEligible:true},{voice:{sessionId:randomUUID()}},{studentId:null}])await assert.rejects(f.call('other','/api/review-response-context',{action:'lookup',studentId:'alex',focus:source(r.id),...extra}),{status:400});
  const wire=await f.request('other','/api/review-response-context',{action:'lookup',studentId:'alex',focus:source(r.id)});assert.equal(wire.status,200);assert.equal(wire.cache,'no-store');
  assert.equal((await f.call('other','/api/review-response-context',{action:'verify',studentId:'alex',guards:[wire.body.guard]})).status,'current');
  await assert.rejects(f.call('other','/api/review-response-context',{action:'verify',studentId:'alex',guards:Array(9).fill(wire.body.guard)}),{status:400});
  const raw=(await f.runtime.query("SELECT origen_review_response_context_command($1::jsonb) AS result",[JSON.stringify({action:'read',studentId:'alex',source:source(r.id),mode:'focus'})])).rows[0].result;assert.equal(raw.error,'review_response_context_denied');
  await assert.rejects(f.as('other',()=>f.db.query('SELECT guidance FROM origen_review_request_responses')),{code:'42501'});
  await assert.rejects(f.as('reader',()=>loadReviewResponseContext(f.db,'other',{studentId:'alex',focus:source(r.id)},f.env)),{status:403});
  assert.equal((await f.owner.query("SELECT has_function_privilege($1,'origen_review_response_context_after_restore()','EXECUTE') AS allowed",[f.role])).rows[0].allowed,false);
 });
 await t.test('editing and withdrawal invalidate guards and never substitute newer content for old focus',async()=>{
  const a=await f.make(),old=await f.lookup({focus:source(a.id)});await f.reply(a,1,'EDITED_ADVICE');
  assert.notEqual((await f.verify(old.guard)).status,'current');assert.equal((await f.lookup({focus:source(a.id)})).status,'unavailable');
  const revised=await f.lookup({focus:source(a.id,2)});assert.equal(revised.response.guidance,'EDITED_ADVICE');assert.equal(revised.response.source.responseVersion,2);
  await f.staff({action:'withdraw-response',id:a.id,publicationId:a.publication.id,version:2,operationId:randomUUID()});assert.equal((await f.lookup({focus:source(a.id,3)})).status,'unavailable');assert.notEqual((await f.verify(revised.guard)).status,'current');
 });
 await t.test('an edit between source loading and final verification discards the body',async()=>{
  const a=await f.make();let changed=false;
  const db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,args)=>{const out=await c.query(sql,args);if(!changed&&sql.includes('origen_review_response_context_command')&&JSON.parse(args[0]).action==='read'){changed=true;await f.reply(a,1,'RACING_EDIT');}return out;}};}};
  const result=await f.lookup({focus:source(a.id)},{},'other','alex',db);assert.equal(changed,true);assert.equal(result.status,'unavailable');assert.ok(!Object.hasOwn(result,'response'));
 });
 await t.test('source changes, expiry and deletion invalidate loaded context without silently reclassifying it',async()=>{
  for(const mode of ['source','expiry','remove']){
   const id=randomUUID();if(mode==='source')await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'note',content:'Private source',language:'en'}},'other');
   const a=await f.make(undefined,{notes:mode==='source'?[id]:[]}),old=await f.lookup({focus:source(a.id)});
   if(mode==='source')await f.note({action:'update',studentId:'alex',id,version:1,note:{topic:'costs',kind:'note',content:'Changed source',language:'en'}},'other');
   if(mode==='expiry')await f.owner.query("UPDATE origen_review_request_publications SET published_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE request_id=$1",[a.id]);
   if(mode==='remove')await f.student({action:'remove',id:a.id,version:2});
   assert.notEqual((await f.verify(old.guard)).status,'current');const result=await f.lookup({focus:source(a.id)});assert.equal(result.status,mode==='remove'?'unavailable':'retrieved');if(mode!=='remove')assert.equal(result.response.availability,'historical');
  }
 });
 await t.test('server pause and personalization pause stop old guards while owner history remains',async()=>{
  const a=await f.make(),old=await f.lookup({focus:source(a.id)});
  for(const key of ['ORIGEN_REVIEW_RESPONSE_CONTEXT','ORIGEN_PERSONALIZATION_RETRIEVAL']){
   const previous=f.env[key];f.env[key]='false';assert.equal((await f.lookup({focus:source(a.id)})).reason,'paused');assert.equal((await f.verify(old.guard)).reason,'paused');assert.ok((await f.student({action:'get',id:a.id})).request);if(previous===undefined)delete f.env[key];else f.env[key]=previous;
  }
  await assertReviewResponseContextReady(f.runtime,f.env);await assertReviewResponseContextReady(null,{});
  await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_review_response_context_command(jsonb) FROM ${f.role}`);try{await assert.rejects(assertReviewResponseContextReady(f.runtime,f.env),/migration_required/);}finally{await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_review_response_context_command(jsonb) TO ${f.role}`);}
 });
});

test('voice recall uses verified speech, returns one exact response per turn and rejects superseded turns',enabled,async t=>{
 const f=await fixture(t),a=await f.make(),b=await f.make('What should I write in my admissions essay?');
 const repo=createLiveMemoryRepository(f.db,f.env),service=createLiveMemoryService(f.db,f.env),run=input=>f.as('other',()=>repo('other',input));
 const revision=(await f.memory({action:'revision',studentId:'alex'},'other')).revision,session=await run({action:'open',studentId:'alex',revision});
 const transcript='Could we go over the insurance waiver?',turn={sessionId:session.id,sequence:1,turnId:'verified-turn',transcript};await run({...turn,action:'turn',language:'en'});
 const legacy=await f.as('other',()=>service('other',{...turn,action:'read',query:'insurance'}));assert.equal(legacy.reviewResponse,undefined);
 const result=await f.as('other',()=>service('other',{...turn,action:'read',query:'essay admissions',responseContextProtocol:'review-response-v1'}));assert.equal(result.reviewResponse.status,'retrieved');assert.equal(result.reviewResponse.response.source.requestId,a.id);assert.ok(result.reviewResponseGuard);assert.ok(!JSON.stringify(result.reviewResponse).includes(b.id));
 const first=await f.lookup({focus:source(a.id)},{voice:turn});assert.equal(first.status,'unavailable'); // changing retrieval mode cannot replace the already bound turn context
 assert.equal((await f.lookup({focus:source(b.id)},{voice:turn})).status,'unavailable');
 const retry=await f.as('other',()=>service('other',{...turn,action:'read',query:'scholarships',responseContextProtocol:'review-response-v1'}));assert.deepEqual(retry.reviewResponse.response.source,result.reviewResponse.response.source);
 const stored=(await f.owner.query('SELECT review_response_sequence,review_response_request,review_response_version,review_response_revision FROM origen_live_memory_sessions WHERE id=$1',[session.id])).rows[0];assert.equal(stored.review_response_sequence,1);assert.equal(stored.review_response_request,a.id);assert.ok(!JSON.stringify(stored).includes('insurance'));
 await run({...turn,sequence:2,turnId:'new-turn',transcript:'Tell me about the essay.',action:'turn',language:'en'});
 await assert.rejects(f.as('other',()=>service('other',{...turn,action:'read',query:'insurance'})),{status:409});
 const second=await f.as('other',()=>service('other',{...turn,sequence:2,turnId:'new-turn',transcript:'Tell me about the essay.',action:'read',query:'insurance',responseContextProtocol:'review-response-v1'}));assert.equal(second.reviewResponse.response.source.requestId,b.id);
 const concurrent={...turn,sequence:3,turnId:'concurrent-turn',transcript:'Can I select a response?'};await run({...concurrent,action:'turn',language:'en'});
 const raced=await Promise.all([f.lookup({focus:source(a.id)},{voice:concurrent}),f.lookup({focus:source(b.id)},{voice:concurrent})]);assert.equal(raced.filter(x=>x.status==='retrieved').length,1);assert.equal(raced.filter(x=>x.reason==='turn_context_changed').length,1);
});

test('candidate limits apply after relevance matching and overflow requires clarification',enabled,async t=>{
 const f=await fixture(t),old=await f.make('Which insurance waiver applies?');
 for(let i=0;i<31;i++)await f.make('Which essay prompt should I select '+i+'?');
 const relevant=await f.lookup({query:'Could we discuss insurance?'});assert.equal(relevant.status,'retrieved');assert.equal(relevant.response.source.requestId,old.id);
 const bounded=await f.lookup({query:'Which essay did we discuss?'});assert.equal(bounded.status,'clarification_required');assert.equal(bounded.reason,'candidate_limit');assert.equal(bounded.choices.length,3);assert.ok(!Object.hasOwn(bounded,'response'));assert.ok(!JSON.stringify(bounded).includes('Compare your insurance coverage'));
});

test('permission changes and restore invalidate response context even when a private receipt survives',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),loaded=await f.lookup({focus:source(r.id)}),hash=createHash('sha256').update('other').digest('hex');
 await f.owner.query("UPDATE origen_eligibility SET age_band='13to17',status='approved',permission_expires_at=now()-interval '1 minute',revision=revision+1 WHERE subject_hash=$1",[hash]);
 assert.equal((await f.verify(loaded.guard)).status,'unavailable');assert.equal((await f.lookup({focus:source(r.id)})).status,'unavailable');
 await f.owner.query("UPDATE origen_eligibility SET age_band='18plus',status='adult',revision=revision+1 WHERE subject_hash=$1",[hash]);
 assert.notEqual((await f.verify(loaded.guard)).status,'current');const history=await f.lookup({focus:source(r.id)});assert.equal(history.response.availability,'historical');
 const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);assert.notEqual((await f.verify(history.guard)).status,'current');assert.equal((await f.lookup({query:'insurance waiver'})).status,'none');
 await f.family('other',{action:'delete-student',id:'alex'});assert.equal((await f.lookup({focus:source(r.id)})).status,'unavailable');
});

test('retrieval deadlines and cancellation release late connections without returning context',async()=>{
 let released=false,queried=false;const env={ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_REVIEW_REQUESTS:'true',ORIGEN_BINDER_SHARING:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_PERSONALIZATION_MODE:'on'};
 let releaseConnection;const pending=new Promise(resolve=>{releaseConnection=resolve;});const db={connect:()=>pending};
 const task=loadReviewResponseContext(db,'student',{studentId:'alex',focus:source(randomUUID())},env);
 await assert.rejects(task,{name:'TimeoutError'});releaseConnection({query:async()=>{queried=true;},release:()=>{released=true;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(released,true);assert.equal(queried,false);
 const abort=new AbortController();abort.abort();await assert.rejects(loadReviewResponseContext(db,'student',{studentId:'alex',focus:source(randomUUID())},env,{signal:abort.signal}),{name:'AbortError'});
});

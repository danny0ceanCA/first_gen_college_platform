import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {checkCoordinatorDatabase} from '../ops/coordinator-readiness.mjs';
import {coordinatorFlags,reviewRequestFlags,coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';

test('review request rollout rejects incomplete dependency combinations',()=>{
 const all=Object.fromEntries([...coordinatorFlags,...reviewRequestFlags].map(k=>[k,'true']));
 assert.deepEqual(coordinatorConfigurationIssues(all),[]);
 for(const key of ['ORIGEN_REVIEW_REQUESTS','ORIGEN_BINDER_SHARING','ORIGEN_COORDINATOR_LINKING','ORIGEN_COORDINATOR_ACCOUNTS','ORIGEN_COORDINATOR_BINDER_VIEWING'])assert.ok(coordinatorConfigurationIssues({...all,[key]:'false'}).length,key);
 for(const key of reviewRequestFlags)assert.ok(coordinatorConfigurationIssues({...all,[key]:'yes'}).length,key);
});

test('release readiness checks all request migrations and runtime grants even with flags off',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture();t.after(()=>f.close());const options={schema:f.schema,env:{}};
 const initial=await checkCoordinatorDatabase(f.runtime,f.maintenance,options);
 assert.equal(initial.passed,true,JSON.stringify(initial.checks));assert.equal(initial.changesApplied,false);
 for(const flag of reviewRequestFlags)assert.equal(initial.flags[flag],false);
 for(const [check,fn] of [['review-requests','origen_review_request_command'],['review-voice','origen_review_voice_command'],['review-delivery','origen_coordinator_review_command'],['review-response-context','origen_review_response_context_command'],['review-response-context','origen_review_response_choice_command']]){
  await f.owner.query(`REVOKE EXECUTE ON FUNCTION ${fn}(jsonb) FROM ${f.role}`);
  try{const result=await checkCoordinatorDatabase(f.runtime,f.maintenance,options);assert.equal(result.passed,false);assert.equal(result.checks.find(c=>c.id===check).passed,false,check);}
  finally{await f.owner.query(`GRANT EXECUTE ON FUNCTION ${fn}(jsonb) TO ${f.role}`);}
 }
 for(const [migration,check] of [['099_review_request_delivery.sql','review-delivery'],['103_review_response_followups.sql','review-response-context']]){
  const row=(await f.owner.query('DELETE FROM origen_schema_migrations WHERE name=$1 RETURNING *',[migration])).rows[0];
  try{const result=await checkCoordinatorDatabase(f.runtime,f.maintenance,options);assert.equal(result.checks.find(c=>c.id===check).passed,false);assert.equal(result.checks.find(c=>c.id==='migration-checksums').passed,false);}
  finally{await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[row.name,row.checksum]);}
 }

});

test('release rehearsal pauses queued responses, preserves privacy controls and cascades student deletion',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true,reviewDelivery:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const notices=()=>f.call('other','/api/coordinator-notifications',{action:'list',audience:'student',studentId:'alex'});
 const draft=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:'Could I qualify for an insurance waiver?',entries:[]})).request;
 const preview=(await student({action:'preview',id:draft.id,version:1,wording:'original'})).preview;
 const submitted=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;
 await f.sweep();await staff({action:'respond',id:draft.id,publicationId:submitted.publication.id,version:0,operationId:randomUUID(),guidance:'Check the current campus waiver requirements.'});
 f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='false';await f.sweep();
 assert.equal((await notices()).notifications.some(n=>n.kind==='review-response'),false);
 assert.equal((await f.owner.query("SELECT status FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-response'",[draft.id])).rows[0].status,'pending');
 await assert.rejects(staff({action:'read',id:draft.id}),{status:503});
 assert.equal((await student({action:'get',id:draft.id})).request.coordinatorReview.response.status,'available');
 f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='true';await f.sweep();assert.equal((await notices()).notifications.filter(n=>n.kind==='review-response').length,1);
 f.env.ORIGEN_REVIEW_REQUESTS='false';f.env.ORIGEN_REVIEW_REQUEST_VOICE='false';f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='false';
 await student({action:'withdraw',id:draft.id,version:2});
 f.env.ORIGEN_REVIEW_REQUESTS='true';f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='true';await f.sweep();await assert.rejects(staff({action:'read',id:draft.id}),{status:404});assert.equal((await notices()).notifications.filter(n=>n.kind==='review-response').length,0);
 await f.family('other',{action:'delete-student',id:'alex'});
 for(const table of ['origen_review_requests','origen_review_request_responses','origen_review_request_publications','origen_review_voice_sessions'])assert.equal((await f.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE account_id=$1 AND student_id='alex'`,[account])).rows[0].n,0,table);
});

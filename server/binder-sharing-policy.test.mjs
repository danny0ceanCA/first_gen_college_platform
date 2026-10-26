import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {evaluateBinderPublication,serializeSharedBinderEntry,inheritSharingClassification,coordinatorConfigurationIssues,coordinatorFlags} from './binder-sharing-policy.mjs';
import {eligibleBinderFacts,protectedBinderFixtures,sharingNow} from './fixtures/binder-sharing.mjs';
import {validateTopicRequest} from './topic-notes.mjs';
import {createApp} from './index.mjs';
import {productionConfigIssues} from './production-config.mjs';

test('only exact confirmed and fully verified student-only entries can be serialized',()=>{
 const facts=eligibleBinderFacts();assert.deepEqual(evaluateBinderPublication(facts,sharingNow),{allowed:true,reason:'eligible'});
 Object.assign(facts.entry,{quote:'PRIVATE_FAMILY_SENTINEL',translations:{es:'PRIVATE_FAMILY_SENTINEL'},summary:'PRIVATE_FAMILY_SENTINEL',accountToken:'secret'});
 assert.deepEqual(serializeSharedBinderEntry(facts,sharingNow),{id:'note',topic:'options',kind:'note',language:'en',content:'Compare campus visit dates.'});
 assert.ok(!JSON.stringify(serializeSharedBinderEntry(facts,sharingNow)).includes('PRIVATE_FAMILY_SENTINEL'));
});
test('family, parent, mixed and unknown sources stay private across edit, translation and copy fixtures',()=>{
 for(const {facts,classification,operation} of protectedBinderFixtures()){
  assert.equal(evaluateBinderPublication(facts,sharingNow).allowed,false,`${classification}/${operation}`);
  assert.throws(()=>serializeSharedBinderEntry({...facts,allowed:true},sharingNow),{status:403,message:'binder_entry_not_shareable'});
 }
});
test('all ancestors including prompt context must have complete student-only provenance',()=>{
 for(const key of ['classification','complete','active','studentId','accountId']){
  const facts=eligibleBinderFacts(),source={accountId:'student-account',studentId:'student',classification:'student_only',complete:true,active:true};
  source[key]=key==='classification'?'family':key.endsWith('Id')?'another-person':false;facts.lineage.ancestors=[source];
  assert.equal(evaluateBinderPublication(facts,sharingNow).reason,'private_source');
 }
 for(const sourceKind of ['summary','transcript','recording']){const facts=eligibleBinderFacts();facts.lineage.sourceKind=sourceKind;assert.equal(evaluateBinderPublication(facts,sharingNow).allowed,false);}
});
test('ownership, organization, consent, expiry and every relevant revision fail closed',()=>{
 const changes=[['actor','accountId','other'],['actor','subject','other'],['student','ownershipVerified',false],['student','parentManaged',true],['student','role','parent'],['student','eligibility','approved'],['student','closed',true],['student','permissionRevision',3],['coordinator','membershipActive',false],['coordinator','organizationVerified',false],['coordinator','organizationEnabled',false],['coordinator','emailVerified',false],['coordinator','mfaVerified',false],['coordinator','revision',4],['connection','status','requested'],['connection','coordinatorId','other'],['connection','studentId','other'],['connection','revision',3],['grant','status','revoked'],['grant','expiresAt','2026-10-18T12:00:00Z'],['grant','grantorSubject','parent'],['grant','topics',['applications']],['entry','accountId','other'],['entry','studentId','sibling'],['entry','status','suggested'],['entry','topic','family'],['entry','version',3],['entry','digest','other'],['lineage','revision',3],['lineage','sourceId','other'],['preview','confirmed',false],['preview','grantId','other'],['preview','policyVersion','old'],['preview','expiresAt','invalid']];
 for(const [record,key,value] of changes){const facts=eligibleBinderFacts();facts[record][key]=value;assert.equal(evaluateBinderPublication(facts,sharingNow).allowed,false,`${record}.${key}`);}
 for(const record of Object.keys(eligibleBinderFacts())){const facts=eligibleBinderFacts();delete facts[record];assert.equal(evaluateBinderPublication(facts,sharingNow).allowed,false,record);}
 assert.equal(evaluateBinderPublication().allowed,false);
 assert.equal(evaluateBinderPublication(null).allowed,false);
 const malformed=eligibleBinderFacts();malformed.lineage.ancestors=[null];assert.equal(evaluateBinderPublication(malformed,sharingNow).allowed,false);
});
test('current guardian permission allows student choice, but expired or absent permission does not',()=>{
 const facts=eligibleBinderFacts();facts.student.eligibility='approved';
 facts.student.permissionExpiresAt=new Date(sharingNow+60000).toISOString();
 assert.equal(evaluateBinderPublication(facts,sharingNow).allowed,true);
 for(const expiry of [undefined,'invalid',new Date(sharingNow).toISOString()]){
  facts.student.permissionExpiresAt=expiry;
  assert.equal(evaluateBinderPublication(facts,sharingNow).reason,'permission_required');
 }
});
test('protected classifications cannot be relaxed by safe or unknown derivations',()=>{
 assert.equal(inheritSharingClassification([]),'unknown');
 assert.equal(inheritSharingClassification(['student_only','untrusted']),'unknown');
 assert.equal(inheritSharingClassification(['student_only','student_only']),'student_only');
 for(const label of ['family','parent','mixed'])assert.equal(inheritSharingClassification([label,'student_only','unknown']),label);
 assert.equal(inheritSharingClassification(['family','parent']),'mixed');
});
test('existing note API discards forged ownership and provenance claims',()=>{
 const result=validateTopicRequest({action:'create',studentId:'student',id:randomUUID(),accountId:'other',lineage:{classification:'student_only'},note:{topic:'options',kind:'note',content:'My note',language:'en',classification:'student_only',complete:true,source_summary_id:'family',origin:'trusted'}});
 assert.deepEqual(Object.keys(result).sort(),['action','id','note','studentId']);
 assert.deepEqual(result.note,{topic:'options',kind:'note',content:'My note',language:'en'});
});
test('Phase 4 allows publication only with provisioning and linking, with independent feedback authorization',()=>{
 assert.deepEqual(coordinatorConfigurationIssues({}),[]);
 assert.deepEqual(coordinatorConfigurationIssues(Object.fromEntries(coordinatorFlags.map(key=>[key,'false']))),[]);
 assert.deepEqual(coordinatorConfigurationIssues({ORIGEN_COORDINATOR_ACCOUNTS:'true'}),[]);
 assert.deepEqual(coordinatorConfigurationIssues({ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true'}),[]);
 assert.deepEqual(coordinatorConfigurationIssues({ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_COORDINATOR_VOICE_LINKING:'true'}),[]);
 for(const key of coordinatorFlags)for(const value of (key==='ORIGEN_COORDINATOR_ACCOUNTS'?['yes','1']:['true','yes','1'])){
  assert.ok(coordinatorConfigurationIssues({[key]:value}).some(s=>s.startsWith(key)));
  assert.ok(productionConfigIssues({[key]:value}).some(s=>s.startsWith(key)));
 }
});
test('disabled coordinator provisioning/viewing APIs return no content or database calls',async t=>{
 let databaseCalls=0;const logs=[];
 const app=createApp({ORIGEN_BINDER_SHARING:'true'},async()=>({sub:'staff'}),{query(){databaseCalls++;throw new Error('must not query');}},line=>logs.push(line));
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await app.flushLogs();});
 // Connections dispatches authenticated, ownership-checked stop controls even
 // while paused; binder-sharing-stop-controls.test exercises that gateway.
 for(const path of ['coordinator-access','coordinator-binders']){
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({code:'PRIVATE_FAMILY_SENTINEL',classification:'student_only'})});
  assert.equal(res.status,503);assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(await res.json(),{error:'coordinator_sharing_unavailable'});
 }
 assert.equal(databaseCalls,0);await app.flushLogs();assert.ok(!JSON.stringify(logs).includes('PRIVATE_FAMILY_SENTINEL'));
});

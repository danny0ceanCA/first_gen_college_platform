import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCoordinatorPilot,pilotGates} from './coordinator-readiness.mjs';
const now=new Date('2026-10-18T12:00:00Z'),fingerprint='a'.repeat(64),revision='b'.repeat(40);
function fixture(){
 const verification={kind:'coordinator-local-verification',schemaVersion:1,sourceFingerprint:fingerprint,checkedAt:now.toISOString(),disposablePostgres:true,sourceUnchanged:true,build:true,logging:true,suites:Object.fromEntries(['server','operations'].map(id=>[id,{tests:10,pass:10,fail:0,skipped:0,cancelled:0}]))};
 const record={schemaVersion:1,stage:'staging',release:{revision,sourceFingerprint:fingerprint,deploymentRef:'synthetic-release'},cohort:{organizationId:'00000000-0000-4000-8000-000000000001',organizationCount:1,coordinators:2,students:5,adultStudentOwnedOnly:true,consentConfirmed:true,testAccountBypass:false},knownRevocationOrDeletionDefects:0,unauthorizedDisclosures:0,backup:{recoveryHorizonDays:7,deletionEvidenceDays:30},gates:pilotGates.map(id=>({id,status:'verified',owner:'synthetic-owner',reviewedBy:'synthetic-reviewer',evidence:['synthetic-evidence'],checkedAt:now.toISOString(),expiresAt:'2026-10-19T12:00:00Z',revision,sourceFingerprint:fingerprint})),workflowMatrix:['en','es'].flatMap(language=>['mobile','desktop'].map(device=>({language,device,passed:true,liveAuth0:true,liveVoice:true,evidence:'synthetic-evidence'})))};
 return {record,verification};
}
const assess=(r,v)=>assessCoordinatorPilot(r,v,{sourceFingerprint:fingerprint,now});
test('pilot readiness accepts only a complete current release record without applying changes',()=>{const f=fixture(),result=assess(f.record,f.verification);assert.equal(result.ready,true);assert.equal(result.changesApplied,false);});
test('readiness blocks missing, malformed, stale, duplicate and source-mismatched evidence',()=>{
 for(const mutate of [f=>{f.record.gates=[];},f=>{f.record.gates.push(f.record.gates[0]);},f=>{f.record.gates[0].status='pending';},f=>{f.record.gates[0].checkedAt='2030-01-01';},f=>{f.record.gates[0].expiresAt='2020-01-01';},f=>{f.record.gates[0].revision='c'.repeat(40);},f=>{f.verification.sourceFingerprint='d'.repeat(64);},f=>{f.verification.checkedAt='2020-01-01';},f=>{f.record.release.sourceFingerprint='d'.repeat(64);},f=>{f.record.gates={};},f=>{f.record.workflowMatrix={};}]){const f=fixture();mutate(f);assert.equal(assess(f.record,f.verification).ready,false);}
 for(const value of [null,{},[],true,'secret-sentinel'])assert.equal(assess(value,value).ready,false);
});
test('readiness refuses skipped tests, fake success, broader cohorts and mocked provider coverage',()=>{
 for(const mutate of [f=>{f.verification.suites.server.skipped=1;},f=>{f.verification.suites.server.tests=0;},f=>{f.verification.suites.operations.fail=1;},f=>{f.verification.sourceUnchanged=false;},f=>{f.verification.disposablePostgres=false;},f=>{f.record.cohort.organizationCount=2;},f=>{f.record.cohort.coordinators=4;},f=>{f.record.cohort.testAccountBypass=true;},f=>{f.record.cohort.adultStudentOwnedOnly=false;},f=>{f.record.workflowMatrix[0].liveVoice=false;},f=>{f.record.backup.deletionEvidenceDays=1;},f=>{f.record.knownRevocationOrDeletionDefects=1;}]){const f=fixture();mutate(f);assert.equal(assess(f.record,f.verification).ready,false);}
});
test('readiness reports do not echo operator-supplied evidence or identities',()=>{const f=fixture();f.record.gates[0].owner='PRIVATE_OWNER_SENTINEL';f.record.gates[0].evidence=['PRIVATE_NOTE_SENTINEL'];f.record.gates[0].status='PRIVATE_STATUS_SENTINEL';assert.doesNotMatch(JSON.stringify(assess(f.record,f.verification)),/PRIVATE_/);});

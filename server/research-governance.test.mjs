import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createResearchSandbox,validateProtocol} from '../research/sandbox/governance.mjs';
import {syntheticResearchExercise} from '../research/sandbox/demo.mjs';
const protocol=JSON.parse(await readFile(new URL('../research/sandbox/protocol.v1.json',import.meta.url),'utf8'));
const scope={studyId:protocol.studyId,version:1};
async function setup(n=20){const lab=await createResearchSandbox();const {noticeHash}=await lab.register(protocol);for(let i=0;i<n;i++){const subject=`synthetic-person-${i}`;await lab.permission({...scope,subject,eventId:randomUUID(),action:'consent',language:'en',noticeHash,adultSelfConfirmed:true});await lab.measure({...scope,subject,month:'2026-10',response:i<10?'helpful':'partly'});}return {lab,noticeHash};}
test('synthetic export and withdrawal exercise blocks stale access, suppresses small cells and revokes recipients',async()=>{
 const report=await syntheticResearchExercise();assert.equal(report.productionDataRead,false);assert.equal(report.realParticipantsEnrolled,0);
 assert.equal(report.released.payload.participantCount,20);assert.equal(report.released.payload.counts.helpful,10);
 assert.equal(report.withdrawal.blockedStoredDatasetAccess,true);assert.equal(report.withdrawal.futureCohortSize,19);assert.equal(report.withdrawal.complementarySuppression,true);assert.equal(report.revocation.blockedAccess,true);
 assert.ok(report.audit.denied>=2);assert.equal(report.liveReadiness,false);
 assert.doesNotMatch(JSON.stringify(report.released.payload),/synthetic-person-|participant_id|synthetic_subject/);
});
test('permission is notice/version scoped and retries cannot rewrite choices; no minors or linked-person consent',async()=>{
 const {lab,noticeHash}=await setup(0);try{
  const input={...scope,subject:'synthetic-person-one',eventId:randomUUID(),action:'consent',language:'es',noticeHash,adultSelfConfirmed:true};
  await assert.rejects(lab.permission({...input,noticeHash:'old'}),/notice_version_mismatch/);
  await assert.rejects(lab.permission({...input,adultSelfConfirmed:false}),/adult_self_only/);
  await assert.rejects(lab.permission({...input,multiPerson:true}),/adult_self_only/);
  await lab.permission(input);assert.equal((await lab.permission(input)).replayed,true);
  await assert.rejects(lab.permission({...input,action:'decline'}),/permission_id_conflict/);
  await lab.permission({...input,eventId:randomUUID(),action:'decline'});
  await assert.rejects(lab.measure({...scope,subject:input.subject,month:'2026-10',response:'helpful'}),/current_permission_required/);
  await lab.register({...protocol,version:2});
  await assert.rejects(lab.measure({...scope,version:2,subject:input.subject,month:'2026-10',response:'helpful'}),/current_permission_required/);
  await assert.rejects(lab.register(protocol),/protocol_version_immutable/);
  await assert.rejects(lab.release({...scope,actor:protocol.recipients[0]}),/study_suspended/);
 }finally{await lab.close();}
});
test('recipient grants are separate from institution membership, study scope and model-training purposes',async()=>{
 const {lab}=await setup();try{
  await assert.rejects(lab.release({...scope,actor:'synthetic-institution-owner'}),/recipient_not_authorized/);
  await lab.register({...protocol,studyId:'synthetic-other-study',recipients:['synthetic-other-recipient']});
  await assert.rejects(lab.release({...scope,actor:'synthetic-other-recipient'}),/recipient_not_authorized/);
  const m=await lab.release({...scope,actor:protocol.recipients[0]});
  await assert.rejects(lab.read({...scope,studyId:'synthetic-other-study',actor:'synthetic-other-recipient',manifestId:m.manifestId}),/dataset_unavailable/);
  for(const bad of [{...protocol,modelTraining:true},{...protocol,fields:['summaries']},{...protocol,synthetic:false},{...protocol,permittedUses:['model-training']},{...protocol,minCellSize:1}])assert.throws(()=>validateProtocol(bad),/invalid_synthetic_protocol/);
 }finally{await lab.close();}
});
test('small cohorts cannot release; suspension blocks access while still allowing withdrawal',async()=>{
 const {lab,noticeHash}=await setup(9);try{
  await assert.rejects(lab.release({...scope,actor:protocol.recipients[0]}),/cohort_too_small/);
  await lab.suspend(scope);await assert.rejects(lab.release({...scope,actor:protocol.recipients[0]}),/study_suspended/);
  await lab.permission({...scope,subject:'synthetic-person-0',eventId:randomUUID(),action:'withdraw',language:'en',noticeHash});
  const audit=await lab.audit();assert.ok(audit.events.some(e=>e.reason==='cohort_too_small'));assert.ok(audit.events.some(e=>e.action==='permission'&&e.outcome==='allowed'));
 }finally{await lab.close();}
});
test('unauthorized measurement fields and periods are rejected, missing reports remain distinct from unknown',async()=>{
 const {lab,noticeHash}=await setup(20);try{
  await assert.rejects(lab.measure({...scope,subject:'synthetic-person-0',response:'Raw private notes',month:'2026-10'}),/unauthorized_field/);
  await assert.rejects(lab.measure({...scope,subject:'synthetic-person-0',response:'helpful',month:'2027-10'}),/measurement_outside_window/);
  await lab.measure({...scope,subject:'synthetic-person-0',response:'unknown',month:'2026-10'});
  const released=await lab.release({...scope,actor:protocol.recipients[0]});
  assert.equal(released.payload.counts,null);assert.equal(released.payload.missingness,'withheld with entire breakdown');
  for(let i=1;i<10;i++)await lab.measure({...scope,subject:`synthetic-person-${i}`,response:'unknown',month:'2026-10'});
  for(let i=20;i<30;i++)await lab.permission({...scope,subject:`synthetic-person-${i}`,eventId:randomUUID(),action:'consent',language:'es',noticeHash,adultSelfConfirmed:true});
  const complete=await lab.release({...scope,actor:protocol.recipients[0]});assert.equal(complete.payload.participantCount,30);assert.equal(complete.payload.counts.unknown,10);assert.equal(complete.payload.counts.missing,10);
 }finally{await lab.close();}
});
test('serialized release/withdrawal cannot restore withdrawn membership and expired datasets cannot be read',async()=>{
 let time=new Date('2026-10-01');const lab=await createResearchSandbox({now:()=>time});try{
  const {noticeHash}=await lab.register(protocol);
  for(let i=0;i<20;i++)await lab.permission({...scope,subject:`synthetic-person-${i}`,eventId:randomUUID(),action:'consent',language:'en',noticeHash,adultSelfConfirmed:true});
  const [m]=await Promise.all([lab.release({...scope,actor:protocol.recipients[0]}),lab.permission({...scope,subject:'synthetic-person-0',eventId:randomUUID(),action:'withdraw',language:'es',noticeHash})]);
  await assert.rejects(lab.read({...scope,actor:protocol.recipients[0],manifestId:m.manifestId}),/dataset_unavailable/);
  const next=await lab.release({...scope,actor:protocol.recipients[0]});assert.equal(next.payload.participantCount,19);
  time=new Date('2026-12-01');assert.equal((await lab.purgeExpired()).removed,2);await assert.rejects(lab.read({...scope,actor:protocol.recipients[0],manifestId:next.manifestId}),/dataset_unavailable/);
 }finally{await lab.close();}
});

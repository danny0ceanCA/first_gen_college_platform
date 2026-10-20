import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';

const enabled={skip:!process.env.DATABASE_TEST_URL};
const subjectHash=createHash('sha256').update('other').digest('hex');
for(const boundary of ['withdrawal','expiry-change','permission-deletion','role-change','family-link']){
 test(`guardian-approved student sharing revokes on ${boundary} without pilot enrollment`,enabled,async t=>{
  const f=await coordinatorPilotFixture({permission:'approved'});t.after(()=>f.close());
  const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_student_pilots')).rows[0].n,0);
  const student=(path,input)=>f.call('other',`/api/${path}`,{studentId:'alex',...input});
  const staff=(path,input)=>f.call('staff',`/api/${path}`,{organizationId:f.org,...input});
  const code=(await f.call('staff','/api/coordinator-access',{action:'rotate-code',id:f.org})).code;
  const ctx={...await student('coordinator-connections',{action:'open',channel:'screen'}),sequence:0};
  const found=await student('coordinator-connections',{action:'lookup',...ctx,code});
  const card=await student('coordinator-connections',{action:'prepare',...ctx,challengeId:found.challengeId});
  const connection=await student('coordinator-connections',{action:'confirm',...ctx,...card,confirmed:true,topics:['options']});
  await staff('coordinator-connections',{action:'accept',connectionId:connection.connectionId});
  const preview=await student('binder-sharing',{action:'preview',connectionId:connection.connectionId,topics:['options'],entryIds:[f.notes[0]]});
  await student('binder-sharing',{action:'publish',previewId:preview.previewId,confirmed:true});
  const grantId=(await student('binder-sharing',{action:'status'})).grants[0].id;
  assert.equal((await staff('coordinator-binders',{action:'read',grantId})).entries.length,1);
  if(boundary==='withdrawal')await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[subjectHash]);
  if(boundary==='expiry-change')await f.owner.query("UPDATE origen_eligibility SET permission_expires_at=now()-interval '1 second' WHERE subject_hash=$1",[subjectHash]);
  if(boundary==='permission-deletion')await f.owner.query('DELETE FROM origen_eligibility WHERE subject_hash=$1',[subjectHash]);
  if(boundary==='role-change')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[account]);
  if(boundary==='family-link')await f.owner.query("INSERT INTO origen_student_links(owner_account_id,owner_student_id,member_account_id,member_student_id,member_role) SELECT $1,'alex',id,'alex','parent' FROM origen_accounts WHERE auth0_subject='reader'",[account]);
  await assert.rejects(staff('coordinator-binders',{action:'read',grantId}),{status:404});
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_connections WHERE id=$1',[connection.connectionId])).rows[0].status,'revoked');
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_share_grants WHERE id=$1',[grantId])).rows[0].status,'revoked');
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  // Restoring eligibility never restores an earlier confirmation or publication.
  await f.owner.query("DELETE FROM origen_student_links WHERE owner_account_id=$1",[account]);
  await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[account]);
  await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version,permission_expires_at) VALUES($1,'13to17','grade9plus','approved','synthetic',now()+interval '30 days') ON CONFLICT(subject_hash) DO UPDATE SET status='approved',permission_expires_at=now()+interval '30 days',revision=origen_eligibility.revision+1",[subjectHash]);
  await student('coordinator-connections',{action:'available'});
  await assert.rejects(staff('coordinator-binders',{action:'read',grantId}),{status:404});
 });
}

test('permission expiry is checked at access time without waiting for a cleanup job',enabled,async t=>{
 const f=await coordinatorPilotFixture({permission:'approved'});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 await f.owner.query("UPDATE origen_eligibility SET permission_expires_at=clock_timestamp()+interval '0.5 seconds' WHERE subject_hash=$1",[subjectHash]);
 assert.equal((await f.owner.query("SELECT origen_coordinator_student_ready($1,'alex') AS ready",[account])).rows[0].ready,true);
 await f.owner.query('SELECT pg_sleep(0.6)');
 assert.equal((await f.owner.query("SELECT origen_coordinator_student_ready($1,'alex') AS ready",[account])).rows[0].ready,false);
});

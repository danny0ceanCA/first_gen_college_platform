import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReadiness,REQUIRED_GATES} from './readiness.mjs';
import {rehearseRecovery,replaySyntheticClosures} from './recovery-rehearsal.mjs';
import {fixture} from '../server/family-fixture.mjs';
import {subjectHash,accountClosed} from '../server/account-lifecycle.mjs';
import {createLinksRepository} from '../server/account-links.mjs';
import {createHistoryRepository} from '../server/history.mjs';
const now=new Date('2026-10-07T12:00:00Z');
const valid=()=>({schemaVersion:1,gates:REQUIRED_GATES.map(id=>({id,status:'verified',owner:'Synthetic test owner',approvedBy:'Synthetic reviewer',evidence:['synthetic evidence'],checkedAt:'2026-10-07T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z'}))});
test('readiness fails closed for pending, missing, duplicate, stale and future evidence',()=>{
 assert.equal(assessReadiness(valid(),now).ready,true);
 for(const mutate of [r=>r.gates.pop(),r=>r.gates.push(r.gates[0]),r=>r.gates[0].status='pending',r=>r.gates[0].owner='',r=>r.gates[0].approvedBy='',r=>r.gates[0].evidence=[],r=>r.gates[0].expiresAt='2026-10-06',r=>r.gates[0].checkedAt='2026-10-08']){const r=valid();mutate(r);assert.equal(assessReadiness(r,now).ready,false);}
});
test('synthetic stale restore cannot resurrect a closed account after replay',async()=>assert.equal((await rehearseRecovery()).status,'passed'));
for(const closing of ['owner','member'])test(`closure replay detaches family links and preserves the other account when the ${closing} closes`,async()=>{
 const f=await fixture();try{
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Synthetic',stage:'10th grade',notes:'OWNER PRIVATE',needs:'OWNER NEEDS'}});
  const links=createLinksRepository(f.pool),history=createHistoryRepository(f.pool);
  const invite=await links('owner',{action:'create',studentId:'s',role:'student'}),joined=await links('member',{action:'accept',token:invite.token});
  await f.run('member',{action:'save-student',student:{id:joined.studentId,name:'Synthetic',stage:'10th grade',notes:'MEMBER PRIVATE',needs:'MEMBER NEEDS'}});
  // Linked reads use the owner's academic fields. A surviving member must keep
  // the latest academic snapshot, rather than its stale invitation-time row.
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Updated synthetic',stage:'11th grade',notes:'OWNER PRIVATE',needs:'OWNER NEEDS'}});
  for(const subject of ['owner','member'])await history(subject,{action:'save',item:{id:'private-summary',studentId:subject==='owner'?'s':joined.studentId,mode:'planning',date:new Date().toISOString(),summary:`${subject.toUpperCase()} HISTORY`,sources:[]}});
  const survivor=closing==='owner'?'member':'owner',survivingAccount=(await f.pool.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[survivor])).rows[0].id;
  const before=(await f.pool.query('SELECT * FROM origen_conversation_summaries WHERE account_id=$1',[survivingAccount])).rows;
  const receipts=[{subject_hash:subjectHash(closing),closed_at:new Date().toISOString()}];
  await replaySyntheticClosures(f.pool,receipts);await replaySyntheticClosures(f.pool,receipts);
  assert.equal(await accountClosed(f.pool,closing),true);assert.equal(await accountClosed(f.pool,survivor),false);
  assert.deepEqual((await f.pool.query('SELECT auth0_subject FROM origen_accounts')).rows,[{auth0_subject:survivor}]);
  assert.equal((await f.pool.query('SELECT * FROM origen_student_links')).rows.length,0);
  const students=(await f.pool.query('SELECT * FROM origen_students')).rows;assert.equal(students.length,1);
  assert.equal(students[0].account_id,survivingAccount);assert.equal(students[0].id,survivor==='owner'?'s':joined.studentId);
  assert.equal(students[0].name,'Updated synthetic');assert.equal(students[0].stage,'11th grade');
  assert.equal(students[0].notes,`${survivor.toUpperCase()} PRIVATE`);assert.equal(students[0].needs,`${survivor.toUpperCase()} NEEDS`);
  const summaries=(await f.pool.query('SELECT * FROM origen_conversation_summaries')).rows;assert.deepEqual(summaries,before);
  assert.ok(!JSON.stringify({students,summaries}).includes(`${closing.toUpperCase()} PRIVATE`));assert.ok(!JSON.stringify(summaries).includes(`${closing.toUpperCase()} HISTORY`));
  await assert.rejects(f.run(closing,{action:'load'}),{status:403,message:'account_closed'});
 }finally{await f.pool.end();}
});

for(const obligation of ['membership','review'])test(`closure replay still halts for institutional ${obligation} without changing family records`,async()=>{
 const f=await fixture();try{
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Synthetic',stage:'10th grade',notes:'OWNER PRIVATE'}});
  const links=createLinksRepository(f.pool),invite=await links('owner',{action:'create',studentId:'s',role:'student'});await links('member',{action:'accept',token:invite.token});
  const institution=(await f.pool.query("INSERT INTO origen_institutions(slug,draft) VALUES('synthetic-institution','{}') RETURNING id")).rows[0].id;
  if(obligation==='membership'){
   await f.pool.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('owner','Synthetic','synthetic@example.test','Coordinator')");
   await f.pool.query("INSERT INTO origen_institution_members(institution_id,auth0_subject) VALUES($1,'owner')",[institution]);
  }else await f.pool.query("INSERT INTO origen_institution_reviews(institution_id,revision,reviewer_subject,action,note) VALUES($1,1,'owner','verify','Synthetic review')",[institution]);
  const tables=['origen_accounts','origen_students','origen_student_links','origen_family_invites','origen_institution_members','origen_institution_reviews'];
  const before={};for(const table of tables)before[table]=(await f.pool.query(`SELECT * FROM ${table}`)).rows;
  await assert.rejects(replaySyntheticClosures(f.pool,[{subject_hash:subjectHash('owner'),closed_at:new Date().toISOString()}]),{status:409,message:obligation==='membership'?'institution_membership_requires_review':'reviewer_records_require_review'});
  for(const table of tables)assert.deepEqual((await f.pool.query(`SELECT * FROM ${table}`)).rows,before[table]);
  assert.equal(await accountClosed(f.pool,'owner'),false);
 }finally{await f.pool.end();}
});

// Synthetic only. This module never reads DATABASE_URL or connects to a provider.
import {fixture} from '../server/family-fixture.mjs';
import {createLifecycleRepository,subjectHash,accountClosed} from '../server/account-lifecycle.mjs';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const tables=['origen_accounts','origen_students','origen_conversation_summaries'];
export async function syntheticSnapshot(pool){
 const snapshot={};for(const table of tables)snapshot[table]=(await pool.query(`SELECT * FROM ${table}`)).rows;
 return structuredClone(snapshot);
}
export async function restoreSyntheticSnapshot(pool,snapshot){
 for(const table of tables)for(const row of snapshot[table]){
  const columns=Object.keys(row);await pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
 }
}
// Deliberately scoped to isolated fixtures. Existing lifecycle safeguards stop
// replay when restored family links or institution obligations need review.
export async function replaySyntheticClosures(pool,receipts){
 const accounts=(await pool.query('SELECT auth0_subject FROM origen_accounts')).rows;
 const close=createLifecycleRepository(pool);
 for(const receipt of receipts){
  if(!/^[a-f0-9]{64}$/.test(receipt.subject_hash)||!Number.isFinite(Date.parse(receipt.closed_at)))throw new Error('Invalid closure receipt');
  for(const account of accounts)if(subjectHash(account.auth0_subject)===receipt.subject_hash)await close(account.auth0_subject,{action:'delete',confirmation:'DELETE'});
  await pool.query('INSERT INTO origen_closed_accounts(subject_hash,closed_at) VALUES($1,$2) ON CONFLICT(subject_hash) DO NOTHING',[receipt.subject_hash,receipt.closed_at]);
 }
}
export async function rehearseRecovery(){
 const original=await fixture(),restored=await fixture();
 try{
  await original.run('synthetic-closed',{action:'save-student',student:{id:'student-a',name:'Synthetic A',stage:'10th grade',notes:'synthetic private note'}});
  await original.run('synthetic-survivor',{action:'save-student',student:{id:'student-b',name:'Synthetic B',stage:'11th grade',notes:'survivor note'}});
  const snapshot=await syntheticSnapshot(original.pool);
  await createLifecycleRepository(original.pool)('synthetic-closed',{action:'delete',confirmation:'DELETE'});
  const receipts=(await original.pool.query('SELECT * FROM origen_closed_accounts')).rows;
  await restoreSyntheticSnapshot(restored.pool,snapshot);
  const resurrectedBeforeReplay=!(await accountClosed(restored.pool,'synthetic-closed'));
  await replaySyntheticClosures(restored.pool,receipts);
  await replaySyntheticClosures(restored.pool,receipts);
  const blocked=await accountClosed(restored.pool,'synthetic-closed');
  const remaining=(await restored.pool.query('SELECT * FROM origen_students')).rows;
  const survivor=(await restored.run('synthetic-survivor',{action:'load'})).students;
  if(!resurrectedBeforeReplay||!blocked||remaining.length!==1||survivor[0]?.name!=='Synthetic B')throw new Error('Recovery invariant failed');
  return {schemaVersion:1,performedAt:new Date().toISOString(),status:'passed',method:'isolated pg-mem synthetic stale snapshot, closure replay twice',checks:['stale restore reproduces resurrection risk','closure receipt blocks closed identity','private student rows removed','surviving account preserved','replay idempotent'],limitations:['Not PostgreSQL backup/PITR evidence','Only accounts/students/summaries snapshot; no production or phase 2/3 tables','Linked family and institution conflicts require operator review before reopening traffic','No measured RPO/RTO or provider identity deletion']};
 }finally{await original.pool.end();await restored.pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await rehearseRecovery();await writeFile(new URL('./latest-recovery.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}

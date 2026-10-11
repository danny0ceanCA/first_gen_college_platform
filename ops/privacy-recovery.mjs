import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kinds={student:'origen_students',summary:'origen_conversation_summaries',note:'origen_topic_notes',plan:'origen_plans',sheet:'origen_workspace_sheets'};
const subjectHash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validateDeletionManifest(manifest){
 const {checksum,...payload}=manifest||{};
 if(payload.version!==1||!date(payload.exportedAt)||!Array.isArray(payload.deletions)||!Array.isArray(payload.closures)||!hex(checksum)||checksum!==hash(payload))throw new Error('invalid_deletion_manifest');
 for(const r of payload.deletions)if(!hex(r.subject_hash)||!uuid(r.account_id)||!['account',...Object.keys(kinds)].includes(r.kind)||typeof r.record_id!=='string'||!r.record_id||r.record_id.length>128||!date(r.deleted_at))throw new Error('invalid_deletion_manifest');
 for(const r of payload.closures)if(!hex(r.subject_hash)||!date(r.closed_at)||r.completed_at!==null&&!date(r.completed_at))throw new Error('invalid_deletion_manifest');
 return payload;
}
// Operator credential only, invoked while writes are stopped for final cutover.
// A checksum detects damage; it does NOT authenticate a manifest's source.
export async function exportDeletionManifest(pool){
 const c=await pool.connect();try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const deletions=(await c.query('SELECT subject_hash,account_id,kind,record_id,deleted_at FROM origen_deletion_journal ORDER BY id')).rows;
  const closures=(await c.query('SELECT c.subject_hash,c.closed_at,i.completed_at FROM origen_closed_accounts c LEFT JOIN origen_identity_closures i USING(subject_hash) ORDER BY c.subject_hash')).rows;
  const payload=JSON.parse(JSON.stringify({version:1,exportedAt:new Date().toISOString(),deletions,closures}));
  await c.query('COMMIT');return {...payload,checksum:hash(payload)};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function replayDeletionManifest(pool,manifest){
 const payload=validateDeletionManifest(manifest),c=await pool.connect();try{
  await c.query('BEGIN');
  // Serialize operator replays. Traffic must remain disabled: an exclusive
  // advisory lock alone cannot stop applications that do not take this lock.
  await c.query('SELECT pg_advisory_xact_lock(728419,5)');
  const accounts=(await c.query('SELECT id,auth0_subject FROM origen_accounts FOR UPDATE')).rows;
  const closed=new Set([...payload.closures.map(r=>r.subject_hash),...payload.deletions.filter(r=>r.kind==='account').map(r=>r.subject_hash)]);
  for(const account of accounts){
   const sh=subjectHash(account.auth0_subject);if(!closed.has(sh))continue;
   if((await c.query('SELECT institution_id FROM origen_institution_members WHERE auth0_subject=$1',[account.auth0_subject])).rows.length)throw new Error('restored_institution_ownership_requires_review');
   // A later authorized closure could only occur after unlinking. Preserve the
   // other participant's independent local profile, remove only the stale link.
   await c.query('DELETE FROM origen_student_links WHERE owner_account_id=$1 OR member_account_id=$1',[account.id]);
   await c.query('DELETE FROM origen_accounts WHERE id=$1',[account.id]);
  }
  const representatives=(await c.query('SELECT auth0_subject FROM origen_institution_representatives')).rows;
  for(const row of representatives)if(closed.has(subjectHash(row.auth0_subject)))await c.query('DELETE FROM origen_institution_representatives WHERE auth0_subject=$1',[row.auth0_subject]);
  for(const r of payload.deletions){
   const account=accounts.find(a=>a.id===r.account_id);
   if(account&&subjectHash(account.auth0_subject)!==r.subject_hash)throw new Error('restored_account_identity_mismatch');
   if(r.kind!=='account')await c.query(`DELETE FROM ${kinds[r.kind]} WHERE account_id=$1 AND id=$2`,[r.account_id,r.record_id]);
   // Import even when the row was absent in the older backup. This rejects a
   // delayed retry that might otherwise re-create it after traffic resumes.
   await c.query('INSERT INTO origen_deletion_journal(subject_hash,account_id,kind,record_id,deleted_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,kind,record_id) DO NOTHING',[r.subject_hash,r.account_id,r.kind,r.record_id,r.deleted_at]);
  }
  for(const r of payload.closures){
   await c.query('INSERT INTO origen_closed_accounts(subject_hash,closed_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.subject_hash,r.closed_at]);
   if(r.completed_at)await c.query('UPDATE origen_identity_closures SET completed_at=$2 WHERE subject_hash=$1',[r.subject_hash,r.completed_at]);
  }
  for(const sh of closed)await c.query('INSERT INTO origen_closed_accounts(subject_hash) VALUES($1) ON CONFLICT DO NOTHING',[sh]);
  await c.query('COMMIT');return {replayed:payload.deletions.length,closures:closed.size,checksum:manifest.checksum};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

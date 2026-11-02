import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kinds={student:'origen_students',summary:'origen_conversation_summaries',note:'origen_topic_notes',plan:'origen_plans',sheet:'origen_workspace_sheets',memory:'origen_student_memories','coordinator-feedback':'origen_coordinator_feedback'};
const subjectHash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validateDeletionManifest(manifest){
 const {checksum,...payload}=manifest||{};
 if(payload.version!==1||!date(payload.exportedAt)||!Array.isArray(payload.deletions)||!Array.isArray(payload.closures)||!hex(checksum)||checksum!==hash(payload))throw new Error('invalid_deletion_manifest');
 for(const r of payload.deletions)if(!hex(r.subject_hash)||!uuid(r.account_id)||!['account',...Object.keys(kinds)].includes(r.kind)||typeof r.record_id!=='string'||!r.record_id||r.record_id.length>128||!date(r.deleted_at))throw new Error('invalid_deletion_manifest');
 for(const r of payload.closures)if(!hex(r.subject_hash)||!date(r.closed_at)||r.completed_at!==null&&!date(r.completed_at))throw new Error('invalid_deletion_manifest');
 if(payload.memoryExclusions!==undefined){
  if(!Array.isArray(payload.memoryExclusions))throw new Error('invalid_deletion_manifest');
  for(const r of payload.memoryExclusions)if(!uuid(r.account_id)||typeof r.summary_id!=='string'||!r.summary_id||r.summary_id.length>128||typeof r.source_version!=='string'||r.source_version.length>128)throw new Error('invalid_deletion_manifest');
 }
 if(payload.memoryFences!==undefined){
  if(!Array.isArray(payload.memoryFences))throw new Error('invalid_deletion_manifest');
  for(const r of payload.memoryFences)if(!uuid(r.account_id)||!uuid(r.id)||!Number.isSafeInteger(r.version)||r.version<1)throw new Error('invalid_deletion_manifest');
 }
 if(payload.coordinatorFeedbackFences!==undefined){
  if(!Array.isArray(payload.coordinatorFeedbackFences))throw new Error('invalid_deletion_manifest');
  for(const r of payload.coordinatorFeedbackFences)if(!uuid(r.account_id)||!uuid(r.id)||!Number.isSafeInteger(r.version)||r.version<1||typeof r.hidden!=='boolean')throw new Error('invalid_deletion_manifest');
 }
 if(payload.coordinatorFeedbackTombstones!==undefined){
  if(!Array.isArray(payload.coordinatorFeedbackTombstones))throw new Error('invalid_deletion_manifest');
  for(const r of payload.coordinatorFeedbackTombstones)if(!uuid(r.account_id)||!hex(r.author_hash)||!uuid(r.request_id)||!uuid(r.feedback_id)||typeof r.deleted!=='boolean')throw new Error('invalid_deletion_manifest');
 }
 if(payload.studentFollowUpReportFences!==undefined){
  if(!Array.isArray(payload.studentFollowUpReportFences))throw new Error('invalid_deletion_manifest');
  for(const r of payload.studentFollowUpReportFences)if(!uuid(r.account_id)||!uuid(r.id)||!Number.isSafeInteger(r.version)||r.version<1)throw new Error('invalid_deletion_manifest');
 }
 for(const field of ['outcomeEpisodeFences','outcomeEvidenceFences','outcomeObservationFences','outcomeDisputeFences'])if(payload[field]!==undefined){
  if(!Array.isArray(payload[field]))throw new Error('invalid_deletion_manifest');
  for(const r of payload[field])if(!uuid(r.account_id)||!uuid(r.id)||!Number.isSafeInteger(r.version)||r.version<1)throw new Error('invalid_deletion_manifest');
 }
 if(payload.reviewResponseFences!==undefined){
  if(!Array.isArray(payload.reviewResponseFences))throw new Error('invalid_deletion_manifest');
  for(const r of payload.reviewResponseFences)if(!uuid(r.account_id)||!uuid(r.request_id)||!Number.isSafeInteger(r.version)||r.version<1||typeof r.withdrawn!=='boolean')throw new Error('invalid_deletion_manifest');
 }
 if(payload.reviewRequestTombstones!==undefined){
  if(!Array.isArray(payload.reviewRequestTombstones))throw new Error('invalid_deletion_manifest');
  for(const r of payload.reviewRequestTombstones)if(!uuid(r.account_id)||typeof r.student_id!=='string'||!r.student_id||r.student_id.length>128||!uuid(r.request_id)||!uuid(r.request_key)||!date(r.deleted_at))throw new Error('invalid_deletion_manifest');
 }
 return payload;
}
// Operator credential only, invoked while writes are stopped for final cutover.
// A checksum detects damage; it does NOT authenticate a manifest's source.
export async function exportDeletionManifest(pool){
 const c=await pool.connect();try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const deletions=(await c.query('SELECT subject_hash,account_id,kind,record_id,deleted_at FROM origen_deletion_journal ORDER BY id')).rows;
  const closures=(await c.query('SELECT c.subject_hash,c.closed_at,i.completed_at FROM origen_closed_accounts c LEFT JOIN origen_identity_closures i USING(subject_hash) ORDER BY c.subject_hash')).rows;
  const memoryReady=(await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_student_memories'")).rows.length;
  const memoryExclusions=memoryReady?(await c.query('SELECT account_id,summary_id,source_version FROM origen_memory_batches WHERE suppressed=true ORDER BY account_id,summary_id')).rows:[];
  const memoryFences=memoryReady?(await c.query("SELECT account_id,id,version FROM origen_student_memories WHERE status<>'superseded' AND version>1 ORDER BY account_id,id")).rows:[];
  const coordinatorReady=(await c.query("SELECT to_regprocedure('origen_coordinator_export()') AS fn")).rows[0]?.fn;
  const coordinatorFeedbackFences=coordinatorReady?(await c.query('SELECT account_id,id,version,(hidden_at IS NOT NULL) AS hidden FROM origen_coordinator_feedback ORDER BY account_id,id')).rows:[];
  const coordinatorFeedbackTombstones=coordinatorReady?(await c.query('SELECT account_id,author_hash,request_id,feedback_id,deleted FROM origen_coordinator_feedback_tombstones ORDER BY author_hash,request_id')).rows:[];
  const reviewsReady=(await c.query("SELECT to_regprocedure('origen_review_request_command(jsonb)') AS fn")).rows[0]?.fn;
  const reviewRequestTombstones=reviewsReady?(await c.query('SELECT account_id,student_id,request_id,request_key,deleted_at FROM origen_review_request_tombstones ORDER BY account_id,request_key')).rows:[];
  const responsesReady=(await c.query("SELECT to_regprocedure('origen_review_response_view(uuid)') AS fn")).rows[0]?.fn;
  const reviewResponseFences=responsesReady?(await c.query('SELECT account_id,request_id,version,(withdrawn_at IS NOT NULL) AS withdrawn FROM origen_review_request_responses ORDER BY account_id,request_id')).rows:[];
  const followUpReady=(await c.query("SELECT to_regprocedure('origen_student_follow_up_after_restore()') AS fn")).rows[0]?.fn;
  const studentFollowUpReportFences=followUpReady?(await c.query('SELECT account_id,id,version FROM origen_student_follow_up_reports ORDER BY account_id,id')).rows:[];
  const outcomesReady=(await c.query("SELECT to_regprocedure('origen_outcome_evidence_after_restore()') AS fn")).rows[0]?.fn;
  const outcomeEpisodeFences=outcomesReady?(await c.query('SELECT account_id,id,version FROM origen_outcome_episodes ORDER BY account_id,id')).rows:[];
  const outcomeEvidenceFences=outcomesReady?(await c.query('SELECT account_id,id,version FROM origen_outcome_evidence ORDER BY account_id,id')).rows:[];
  const observationReady=(await c.query("SELECT to_regprocedure('origen_outcome_observation_after_restore()') AS fn")).rows[0]?.fn;
  const outcomeObservationFences=observationReady?(await c.query('SELECT account_id,id,version FROM origen_outcome_observations ORDER BY account_id,id')).rows:[];
  const outcomeDisputeFences=observationReady?(await c.query('SELECT account_id,observation_id AS id,version FROM origen_outcome_observation_disputes ORDER BY account_id,observation_id')).rows:[];
  const payload=JSON.parse(JSON.stringify({version:1,outcomeObservationFences,outcomeDisputeFences,outcomeEpisodeFences,outcomeEvidenceFences,studentFollowUpReportFences,reviewResponseFences,memoryExclusions,memoryFences,coordinatorFeedbackFences,coordinatorFeedbackTombstones,reviewRequestTombstones,exportedAt:new Date().toISOString(),deletions,closures}));
  await c.query('COMMIT');return {...payload,checksum:hash(payload)};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function replayDeletionManifest(pool,manifest){
 const payload=validateDeletionManifest(manifest),c=await pool.connect();try{
  await c.query('BEGIN');
  // Serialize operator replays. Traffic must remain disabled: an exclusive
  // advisory lock alone cannot stop applications that do not take this lock.
  await c.query('SELECT pg_advisory_xact_lock(728419,5)');
  // Restored cooldowns and pending voice confirmations are not reliable current
  // consent/context. Discard this bounded metadata rather than resurrect it.
  if((await c.query("SELECT to_regprocedure('origen_review_voice_command(jsonb)') AS fn")).rows[0]?.fn)await c.query('DELETE FROM origen_review_voice_sessions');
  if((await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_guidance_questions'")).rows.length){
   await c.query('DELETE FROM origen_guidance_questions');
   await c.query('DELETE FROM origen_live_memory_sessions');
  }
  if((await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='origen_checkpoint_text'")).rows.length){
   await c.query("UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE status NOT IN ('complete','cancelled')");
   await c.query('DELETE FROM origen_checkpoint_text');
   await c.query('UPDATE origen_recovery_epochs SET epoch=epoch+1');
  }
  // Fail closed after every restore, even if revocation evidence was newer than
  // the last exported manifest. No old recipient, code or publication survives.
  // A new pilot approval, recipient connection and student publication are required.
  if((await c.query("SELECT to_regprocedure('origen_review_request_invalidate(uuid,text)') AS fn")).rows[0]?.fn){
   await c.query("SELECT origen_review_request_invalidate(id,'restored') FROM origen_review_requests ORDER BY id");
  }
  if((await c.query("SELECT to_regprocedure('origen_review_response_context_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_review_response_context_after_restore()');
  if((await c.query("SELECT to_regprocedure('origen_review_response_choices_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_review_response_choices_after_restore()');
  if((await c.query("SELECT to_regprocedure('origen_review_followups_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_review_followups_after_restore()');
  if((await c.query("SELECT to_regprocedure('origen_follow_up_conversations_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_follow_up_conversations_after_restore()');
  if((await c.query("SELECT to_regprocedure('origen_conversation_opening_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_conversation_opening_after_restore()');
  if((await c.query("SELECT to_regprocedure('origen_student_follow_up_after_restore()') AS fn")).rows[0]?.fn){
   await c.query('SELECT origen_student_follow_up_after_restore()');
   // An old, deleted or subsequently corrected report is not restored as truth.
   // Older manifests without this field conservatively remove these reports.
   await c.query(`DELETE FROM origen_student_follow_up_reports r WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS f(account_id uuid,id uuid,version integer)
    WHERE f.account_id=r.account_id AND f.id=r.id AND f.version=r.version)`,[JSON.stringify(payload.studentFollowUpReportFences||[])]);
  }
  if((await c.query("SELECT to_regprocedure('origen_outcome_evidence_after_restore()') AS fn")).rows[0]?.fn){
   for(const [table,field] of [['origen_outcome_evidence','outcomeEvidenceFences'],['origen_outcome_episodes','outcomeEpisodeFences']])await c.query(`DELETE FROM ${table} r WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS f(account_id uuid,id uuid,version integer)
    WHERE f.account_id=r.account_id AND f.id=r.id AND f.version=r.version)`,[JSON.stringify(payload[field]||[])]);
   await c.query('SELECT origen_outcome_evidence_after_restore()');
  }
  if((await c.query("SELECT to_regprocedure('origen_outcome_observation_after_restore()') AS fn")).rows[0]?.fn){
   // A restored observation must not outlive a missing or superseded disagreement.
   // Dropping that observation also fences stale approval/delete requests by ID.
   await c.query(`DELETE FROM origen_outcome_observations o WHERE
    EXISTS(SELECT 1 FROM origen_outcome_observation_disputes d WHERE d.observation_id=o.id AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS f(account_id uuid,id uuid,version integer) WHERE f.account_id=d.account_id AND f.id=d.observation_id AND f.version=d.version))
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS f(account_id uuid,id uuid,version integer) WHERE f.id=o.id AND f.account_id=o.account_id AND NOT EXISTS(
      SELECT 1 FROM origen_outcome_observation_disputes d WHERE d.observation_id=f.id AND d.version=f.version))`,[JSON.stringify(payload.outcomeDisputeFences||[])]);
   for(const [table,key,field] of [['origen_outcome_observations','id','outcomeObservationFences'],['origen_outcome_observation_disputes','observation_id','outcomeDisputeFences']])await c.query(`DELETE FROM ${table} r WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS f(account_id uuid,id uuid,version integer)
    WHERE f.account_id=r.account_id AND f.id=r.${key} AND f.version=r.version)`,[JSON.stringify(payload[field]||[])]);
   await c.query('SELECT origen_outcome_observation_after_restore()');
  }
  if((await c.query("SELECT to_regprocedure('origen_outcome_evaluation_after_restore()') AS fn")).rows[0]?.fn)await c.query('SELECT origen_outcome_evaluation_after_restore()');
  const coordinatorReady=(await c.query("SELECT to_regprocedure('origen_coordinator_export()') AS fn")).rows[0]?.fn;
  if(coordinatorReady){
   await c.query("UPDATE origen_coordinator_organizations SET status='suspended',revision=revision+1 WHERE status='active'");
   await c.query("UPDATE origen_coordinator_profiles SET status='disabled',revision=revision+1 WHERE status='active'");
   await c.query("UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1 WHERE status<>'revoked'");
   await c.query("UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE status IN ('requested','accepted')");
   await c.query('UPDATE origen_coordinator_codes SET revoked_at=coalesce(revoked_at,now())');
   await c.query("UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,now()) WHERE content<>''");
   await c.query('DELETE FROM origen_binder_previews');
   await c.query('DELETE FROM origen_coordinator_outbox');
   await c.query('DELETE FROM origen_coordinator_notifications');
   for(const r of payload.coordinatorFeedbackFences||[])await c.query('DELETE FROM origen_coordinator_feedback WHERE account_id=$1 AND id=$2 AND (version<>$3 OR $4)',[r.account_id,r.id,r.version,r.hidden]);
   await c.query('DELETE FROM origen_coordinator_feedback WHERE NOT (id=ANY($1::uuid[]))',[(payload.coordinatorFeedbackFences||[]).map(r=>r.id)]);
   // Legacy manifests cannot establish safe feedback state. Remove restored
   // guidance rather than expose a hidden, edited or removed historical copy.
   if(payload.coordinatorFeedbackFences===undefined)await c.query('DELETE FROM origen_coordinator_feedback');
  }
  if(coordinatorReady)for(const r of payload.coordinatorFeedbackTombstones||[])await c.query('INSERT INTO origen_coordinator_feedback_tombstones SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM origen_accounts WHERE id=$1) ON CONFLICT(author_hash,request_id) DO UPDATE SET deleted=origen_coordinator_feedback_tombstones.deleted OR EXCLUDED.deleted',[r.account_id,r.author_hash,r.request_id,r.feedback_id,r.deleted]);
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
  // Keep source suppression and version fences with the separately protected
  // deletion journal. Neither manifest field contains private prose.
  for(const r of payload.memoryExclusions||[]){
   const account=accounts.find(a=>a.id===r.account_id);if(!account||closed.has(subjectHash(account.auth0_subject)))continue;
   const source=(await c.query('SELECT id FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2',[r.account_id,r.summary_id])).rows.length;
   if(source)await c.query('INSERT INTO origen_memory_batches(account_id,summary_id,source_version,suppressed) VALUES($1,$2,$3,true) ON CONFLICT(account_id,summary_id) DO UPDATE SET suppressed=true',[r.account_id,r.summary_id,r.source_version]);
   else await c.query("INSERT INTO origen_deletion_journal(subject_hash,account_id,kind,record_id) VALUES($1,$2,'summary',$3) ON CONFLICT DO NOTHING",[subjectHash(account.auth0_subject),r.account_id,r.summary_id]);
  }
  for(const r of payload.memoryFences||[])await c.query("UPDATE origen_student_memories SET status='deleted',last_action='delete',content='',source_quote='' WHERE account_id=$1 AND id=$2 AND version<$3 AND status<>'superseded'",[r.account_id,r.id,r.version]);
  if((await c.query("SELECT to_regprocedure('origen_review_response_view(uuid)') AS fn")).rows[0]?.fn){
   const scrub="UPDATE origen_review_request_responses SET guidance='',suggested_action='',resource_url='',follow_up_on=NULL,withdrawn_at=coalesce(withdrawn_at,clock_timestamp()),updated_at=clock_timestamp()";
   for(const r of payload.reviewResponseFences||[])await c.query(scrub+' WHERE account_id=$1 AND request_id=$2 AND (version<>$3 OR $4)',[r.account_id,r.request_id,r.version,r.withdrawn]);
   await c.query(scrub+' WHERE NOT (request_id=ANY($1::uuid[]))',[(payload.reviewResponseFences||[]).map(r=>r.request_id)]);
  }
  if((await c.query("SELECT to_regprocedure('origen_review_request_command(jsonb)') AS fn")).rows[0]?.fn)for(const r of payload.reviewRequestTombstones||[]){
   await c.query('DELETE FROM origen_review_requests WHERE account_id=$1 AND (id=$2 OR request_key=$3)',[r.account_id,r.request_id,r.request_key]);
   await c.query('INSERT INTO origen_review_request_tombstones(account_id,student_id,request_id,request_key,deleted_at) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM origen_students WHERE account_id=$1 AND id=$2) ON CONFLICT(account_id,request_key) DO NOTHING',[r.account_id,r.student_id,r.request_id,r.request_key,r.deleted_at]);
  }
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

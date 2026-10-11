import {createHash} from 'node:crypto';
import {adminWindow} from './admin-overview.mjs';
import {onboardingUUID} from './onboarding-events.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const kinds=['profile_save','connection','playback','handoff','summary_processing','summary_save','telemetry_gap'];
const labels={profile_save:'Profile save request failed',connection:'Voice connection failed',playback:'Browser playback unavailable',handoff:'Home handoff failed',summary_processing:'Summary processing failed',summary_save:'Summary storage request failed',telemetry_gap:'Diagnostic delivery gap reported'};
export function reviewFilters(input,now=new Date()){
 const {days=30,page=1,status='active',kind='all',recovery='all',evidence='failures',asOf}=input;
 const cutoff=asOf===undefined?+now:typeof asOf==='string'?Date.parse(asOf):NaN;
 if(![7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>10000||!['all','active','open','investigating','resolved'].includes(status)||!['all',...kinds].includes(kind)||!['all','observed','unknown'].includes(recovery)||!['all','failures','gaps'].includes(evidence)||!Number.isFinite(cutoff)||cutoff>+now||cutoff<+now-86400000)throw fail(400,'invalid_review_filter');
 return {page,status,kind,recovery,evidence,window:adminWindow(days,new Date(cutoff))};
}
// A row is one kind of failure in one explicitly linked visit, voice attempt or
// summary segment. No joins on nearby timestamps and no inferred abandonment.
export const reviewFactsSQL=`WITH onboarding AS (
 SELECT e.* FROM origen_onboarding_events e JOIN origen_onboarding_attempts a ON a.account_id=e.account_id AND a.id=e.attempt_id
 WHERE e.received_at<$2 AND a.last_received_at>=$3
), quality AS (SELECT * FROM origen_voice_quality_events WHERE received_at>=$4 AND received_at<$2),
raw_failures AS (
 SELECT account_id,'onboarding'::text AS source,attempt_id AS scope_id,attempt_id,NULL::uuid AS session_id,NULL::uuid AS segment_id,
 CASE name WHEN 'save_failed' THEN 'profile_save' WHEN 'voice_connection_failed' THEN 'connection' WHEN 'audio_playback_blocked' THEN 'playback' WHEN 'tracking_delivery_gap' THEN 'telemetry_gap' ELSE 'handoff' END AS kind,
 producer||':'||sequence AS event_id,received_at,sequence, 'browser'::text AS evidence
 FROM onboarding WHERE producer='client' AND name IN ('save_failed','voice_connection_failed','audio_playback_blocked','home_transition_failed','native_handoff_failed','tracking_delivery_gap')
 UNION ALL
 SELECT account_id,'voice',attempt_id,NULL,session_id,NULL,'connection',sequence::text,received_at,sequence,'browser' FROM quality q
 WHERE (event='connection_failure' OR (event='connection_state' AND connection_state='failed'))
 AND NOT EXISTS(SELECT 1 FROM onboarding o WHERE o.account_id=q.account_id AND o.name='voice_connection_failed' AND o.metadata->>'voiceAttemptId'=q.attempt_id::text AND o.received_at>=q.received_at)
 UNION ALL
 SELECT x.account_id,'summary',COALESCE(x.segment_id,x.id),NULL,x.session_id,x.segment_id,
 CASE WHEN x.error_code='summary_storage_failed' THEN 'summary_save' ELSE 'summary_processing' END,x.id::text,x.finished_at,0,'server'
 FROM origen_ai_executions x JOIN origen_guidance_sessions s ON s.account_id=x.account_id AND s.id=x.session_id
 WHERE x.operation='summary' AND x.status='failed' AND x.finished_at<$2 AND s.started_at>=$4
), grouped AS (
 SELECT account_id,source,scope_id,kind,attempt_id,session_id,segment_id,evidence,count(*)::integer AS occurrences,min(received_at) AS first_at,max(received_at) AS latest_at,max(sequence) AS last_sequence,
 md5((array_agg(event_id||':'||received_at::text ORDER BY received_at DESC,event_id DESC))[1]) AS evidence_revision,
 md5(account_id::text||':'||source||':'||scope_id::text||':'||COALESCE(session_id::text,'')||':'||kind) AS issue_key
 FROM raw_failures GROUP BY account_id,source,scope_id,kind,attempt_id,session_id,segment_id,evidence
 HAVING max(received_at)>=$1
), facts AS (
 SELECT g.*,a.first_name,r.id AS review_id,r.status AS previous_status,
 CASE WHEN r.evidence_revision=g.evidence_revision THEN r.status ELSE 'open' END AS status,
 (r.id IS NOT NULL AND r.evidence_revision<>g.evidence_revision) AS new_evidence,
 CASE
 WHEN g.kind='profile_save' THEN (SELECT min(saved_at) FROM origen_onboarding_attempts WHERE account_id=g.account_id AND saved_at>g.latest_at AND saved_at<$2)
 WHEN g.source='onboarding' AND g.kind IN ('connection','playback','handoff') THEN
 (SELECT min(received_at) FROM onboarding WHERE account_id=g.account_id AND attempt_id=g.scope_id AND producer='client' AND sequence>g.last_sequence AND name=ANY(CASE g.kind WHEN 'connection' THEN ARRAY['voice_connected'] WHEN 'playback' THEN ARRAY['audio_playback_started','audio_playback_resumed'] ELSE ARRAY['home_reached','native_handoff_acknowledged'] END))
 WHEN g.source='voice' THEN (SELECT min(received_at) FROM quality WHERE account_id=g.account_id AND attempt_id=g.scope_id AND session_id=g.session_id AND sequence>g.last_sequence AND event='connection_state' AND connection_state='connected')
 WHEN g.source='summary' THEN (SELECT min(e.received_at) FROM origen_guidance_events e JOIN origen_summary_segments l ON l.account_id=e.account_id AND l.segment_id=g.segment_id AND l.summary_id=e.payload->>'summaryId' JOIN origen_conversation_summaries m ON m.account_id=l.account_id AND m.id=l.summary_id WHERE e.account_id=g.account_id AND e.session_id=g.session_id AND e.producer='server' AND e.name='summary.saved' AND e.received_at>g.latest_at AND e.received_at<$2 AND m.created_at<$2)
 END AS recovery_at
 FROM grouped g JOIN origen_accounts a ON a.id=g.account_id
 LEFT JOIN LATERAL (SELECT id,status,evidence_revision FROM origen_admin_issue_reviews WHERE account_id=g.account_id AND issue_key=g.issue_key AND created_at<$2 ORDER BY id DESC LIMIT 1) r ON true
), selected AS (SELECT * FROM facts WHERE
 ($5='all' OR status=$5 OR ($5='active' AND status<>'resolved')) AND ($6='all' OR kind=$6)
 AND ($7='all' OR ($7='observed' AND recovery_at IS NOT NULL) OR ($7='unknown' AND recovery_at IS NULL))
 AND ($8='all' OR ($8='gaps' AND kind='telemetry_gap') OR ($8='failures' AND kind<>'telemetry_gap')))`;
const revision=row=>createHash('sha256').update(`${row.account_id}:${row.issue_key}:${row.evidence_revision}:${row.review_id||'0'}`).digest('hex');
function present(row){return {key:row.issue_key,accountId:row.account_id,name:row.first_name,source:row.source,scopeId:row.scope_id,attemptId:row.attempt_id,sessionId:row.session_id,kind:row.kind,title:labels[row.kind],evidence:row.evidence,occurrences:row.occurrences,firstAt:row.first_at,latestAt:row.latest_at,status:row.status,newEvidence:row.new_evidence,recoveryAt:row.recovery_at,revision:revision(row)};}
function params(f,now,env){return [f.window.start,f.window.end,new Date(+now-onboardingSettings(env).retentionDays*86400000).toISOString(),new Date(+now-90*86400000).toISOString(),f.status,f.kind,f.recovery,f.evidence];}
async function coverage(db,env){
 const dates=Object.fromEntries((await db.query("SELECT name,applied_at FROM origen_schema_migrations WHERE name IN ('029_admin_issue_reviews.sql','027_onboarding_events.sql','019_voice_quality.sql','015_guidance_history.sql')")).rows.map(x=>[x.name,x.applied_at]));
 return {available:!!dates['029_admin_issue_reviews.sql'],dates,onboardingRetentionDays:onboardingSettings(env).retentionDays,guidanceEnabled:env.GUIDANCE_HISTORY_ENABLED==='true'};
}
export async function adminReviewQueue(db,input,now=new Date(),env={}){
 const f=reviewFilters(input,now),tracking=await coverage(db,env);
 if(!tracking.available)return {coverage:tracking,items:[],total:0,page:f.page,pageSize:20,window:f.window};
 const p=params(f,now,env);
 const rows=(await db.query(`${reviewFactsSQL} SELECT *,count(*) OVER() AS total FROM selected ORDER BY latest_at DESC,issue_key LIMIT 20 OFFSET $9`,[...p,(f.page-1)*20])).rows;
 const counts=(await db.query(`${reviewFactsSQL} SELECT count(*) AS total,count(*) FILTER(WHERE status='open') AS open,count(*) FILTER(WHERE status='investigating') AS investigating,count(*) FILTER(WHERE status='resolved') AS resolved,count(*) FILTER(WHERE recovery_at IS NOT NULL) AS recovered FROM selected`,p)).rows[0];
 return {coverage:tracking,items:rows.map(present),counts:Object.fromEntries(Object.entries(counts).map(([key,n])=>[key,Number(n)])),total:Number(counts.total),page:f.page,pageSize:20,window:f.window};
}
function validateKey(input){if(!onboardingUUID(input.accountId)||typeof input.key!=='string'||! /^[a-f0-9]{32}$/.test(input.key))throw fail(400,'invalid_review_item');}
export async function adminReviewHistory(db,input){
 validateKey(input);const page=input.page??1;if(!Number.isInteger(page)||page<1||page>10000)throw fail(400,'invalid_review_filter');
 const p=[input.accountId,input.key];
 const rows=(await db.query('SELECT id::text,status,reason,created_at FROM origen_admin_issue_reviews WHERE account_id=$1 AND issue_key=$2 ORDER BY id DESC LIMIT 20 OFFSET $3',[...p,(page-1)*20])).rows;
 const total=Number((await db.query('SELECT count(*) AS total FROM origen_admin_issue_reviews WHERE account_id=$1 AND issue_key=$2',p)).rows[0].total);
 return {items:rows,total,page,pageSize:20};
}
export async function adminReviewEvidence(db,input,now=new Date(),env={}){
 validateKey(input);const f=reviewFilters({...input,days:90,status:'all',evidence:'all'},now);
 const found=(await db.query(`${reviewFactsSQL} SELECT * FROM selected WHERE account_id=$9 AND issue_key=$10`,[...params(f,now,env),input.accountId,input.key])).rows[0];
 if(!found)throw fail(404,'review_evidence_unavailable');
 // Select only technical outcomes. Profile fields, summary content and raw
 // payloads never enter this endpoint, even if old producers stored more data.
 const sql=found.source==='onboarding'?`SELECT producer||':'||sequence AS id,received_at AS at,name AS event,producer AS evidence FROM origen_onboarding_events WHERE account_id=$1 AND attempt_id=$2 AND received_at<$3 AND name IN ('onboarding_opened','save_requested','save_failed','save_succeeded','profile_saved','voice_start_requested','voice_connected','voice_connection_failed','audio_playback_blocked','audio_playback_started','audio_playback_resumed','home_transition_failed','home_reached','native_handoff_failed','native_handoff_acknowledged','tracking_delivery_gap','tracking_delivery_recovered')`:
 found.source==='voice'?`SELECT sequence::text AS id,received_at AS at,CASE WHEN event='connection_state' THEN 'connection_'||connection_state ELSE event END AS event,'client'::text AS evidence FROM origen_voice_quality_events WHERE account_id=$1 AND attempt_id=$2 AND received_at<$3 AND session_id=$4 AND event IN ('session_start','connection_state','connection_failure','session_cleanup')`:
 `SELECT id::text,finished_at AS at,CASE WHEN status='completed' THEN 'summary_processing_completed' WHEN error_code='summary_storage_failed' THEN 'summary_storage_failed' ELSE 'summary_processing_failed' END AS event,'server'::text AS evidence FROM origen_ai_executions WHERE account_id=$1 AND COALESCE(segment_id,id)=$2 AND operation='summary' AND status IN ('completed','failed') AND finished_at<$3`;
 const p=[input.accountId,found.scope_id,f.window.end,...(found.source==='voice'?[found.session_id]:[])];
 const rows=(await db.query(`WITH events AS (${sql}) SELECT * FROM events ORDER BY at DESC,id DESC LIMIT 30 OFFSET $${p.length+1}`,[...p,(f.page-1)*30])).rows;
 const total=Number((await db.query(`WITH events AS (${sql}) SELECT count(*) AS total FROM events`,p)).rows[0].total);
 return {items:rows,total,page:f.page,pageSize:30,window:f.window};
}
export async function reviewQueueItem(database,subject,input,now=new Date(),env={}){
 validateKey(input);
 const reasons={open:['reopened'],investigating:['investigating'],resolved:['recovery_observed','fix_verified','review_complete']};
 if(!subject||! /^[a-f0-9]{64}$/.test(input.revision||'')||!reasons[input.status]?.includes(input.reason))throw fail(400,'invalid_review_decision');
 const c=await database.connect();try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.accountId+':'+input.key]);
  const f=reviewFilters({days:90,status:'all',evidence:'all'},now);
  const row=(await c.query(`${reviewFactsSQL} SELECT * FROM selected WHERE account_id=$9 AND issue_key=$10`,[...params(f,now,env),input.accountId,input.key])).rows[0];
  if(!row)throw fail(404,'review_evidence_unavailable');
  // Decisions committed while this request waited on the lock still count.
  const latest=(await c.query('SELECT id,status,evidence_revision FROM origen_admin_issue_reviews WHERE account_id=$1 AND issue_key=$2 ORDER BY id DESC LIMIT 1',[input.accountId,input.key])).rows[0];
  row.review_id=latest?.id;
  row.status=latest?.evidence_revision===row.evidence_revision?latest.status:'open';
  if(revision(row)!==input.revision)throw fail(409,'review_changed');
  if(input.reason==='recovery_observed'&&!row.recovery_at)throw fail(409,'recovery_not_recorded');
  if(row.status===input.status)throw fail(409,'review_changed');
  await c.query('INSERT INTO origen_admin_issue_reviews(account_id,issue_key,evidence_revision,status,reason,reviewer_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.accountId,input.key,row.evidence_revision,input.status,input.reason,createHash('sha256').update(subject).digest('hex'),now]);
  await c.query('COMMIT');return {saved:true};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export async function purgeAdminReviews(db,now=new Date(),env={}){
 if(!db)return;
 await db.query('DELETE FROM origen_admin_issue_reviews WHERE created_at<$1',[new Date(+now-90*86400000)]);
 // Remove decisions whose source no longer exists, including configured shorter
 // onboarding retention. No content or long-lived shadow incident database.
 const f=reviewFilters({days:90,status:'all',evidence:'all'},now);
 await db.query(`${reviewFactsSQL} DELETE FROM origen_admin_issue_reviews r WHERE NOT EXISTS(SELECT 1 FROM facts f WHERE f.account_id=r.account_id AND f.issue_key=r.issue_key)`,params(f,now,env));
}

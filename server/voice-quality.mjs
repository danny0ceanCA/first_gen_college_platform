import {guardAccountTransaction} from './account-guard.mjs';
import {adminWindow} from './admin-overview.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const events=new Set(['session_start','session_cleanup','connection_state','connection_failure','response_failed','response_cancelled','empty_interruption_recovered','transcription_timeout','lookup_success','lookup_failure','lookup_cache_hit','guide_update_complete','guide_update_failed','spoken_language_changed','spoken_language_update_failed','voice_usage_save_failed','welcome_save_failed']);
const codes=new Set(['authentication_required','invalid_token','quota_exceeded','model_unavailable','missing_api_key','invalid_api_key','busy','rate_limited','unsupported','network_error','NotAllowedError','NotFoundError','NotReadableError','invalid_voice_response','voice_unavailable','connection_timeout','connection_failed','connection_lost','disconnected','failed','response_failed','server_error']);
export function qualityEvent(input){
 if(!input||!uuid(input.attemptId)||!uuid(input.sessionId)||!Number.isInteger(input.sequence)||input.sequence<1||input.sequence>100000||!events.has(input.event))return null;
 return {attemptId:input.attemptId,sessionId:input.sessionId,sequence:input.sequence,event:input.event,
  mode:['profile','planning','finance','admissions','loans'].includes(input.mode)?input.mode:null,
  language:['en','es'].includes(input.language)?input.language:null,
  code:input.code?(codes.has(input.code)?input.code:'other'):null,
  connectionState:['new','connecting','connected','disconnected','failed','closed'].includes(input.connectionState)?input.connectionState:null,
  durationMs:Number.isFinite(input.durationMs)&&input.durationMs>=0?Math.min(600000,Math.round(input.durationMs)):null};
}
export async function storeQualityEvent(database,subject,input){
 const event=qualityEvent(input);if(!database||!subject||!event)return;
 const c=await database.connect();try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const owner=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[subject])).rows[0]?.id;
  if(owner)await c.query(`INSERT INTO origen_voice_quality_events(account_id,attempt_id,session_id,sequence,event,mode,language,code,connection_state,duration_ms)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE (SELECT count(*) FROM origen_voice_quality_events WHERE account_id=$1 AND attempt_id=$2)<1000 ON CONFLICT DO NOTHING`,[owner,event.attemptId,event.sessionId,event.sequence,event.event,event.mode,event.language,event.code,event.connectionState,event.durationMs]);
  await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
const cohort=`WITH attempts AS (
 SELECT account_id,attempt_id,session_id,min(received_at) FILTER(WHERE event='session_start') AS started_at,
 min(received_at) FILTER(WHERE event='connection_state' AND connection_state='connected') AS connected_at,
 bool_or(event='connection_failure' OR (event='connection_state' AND connection_state='failed')) AS failed,
 max(mode) FILTER(WHERE event='session_start') AS topic,max(language) FILTER(WHERE event='session_start') AS language
 FROM origen_voice_quality_events WHERE received_at>=$1 AND received_at<$2 GROUP BY account_id,attempt_id,session_id), selected AS
 (SELECT * FROM attempts WHERE started_at>=$1 AND started_at<$2 AND ($3='all' OR topic=$3) AND ($4='all' OR language=$4)), events AS
 (SELECT e.* FROM origen_voice_quality_events e JOIN selected s USING(account_id,attempt_id,session_id) WHERE e.received_at<$2)
`;
export async function adminVoiceQuality(database,days=30,now=new Date(),filters={}){
 if(![7,30,90].includes(days))throw Object.assign(new Error('invalid_period'),{status:400});
 const topic=filters.topic??'all',language=filters.language??'all';
 if(!['all','profile','planning','finance','admissions','loans'].includes(topic)||!['all','en','es'].includes(language))throw Object.assign(new Error('invalid_quality_filter'),{status:400});
 const window=adminWindow(days,now),params=[window.start,window.end,topic,language];
 const [totals,topics,errors,recent,tracking]=await Promise.all([
  database.query(cohort+`SELECT count(*) AS attempts,count(*) FILTER(WHERE connected_at IS NOT NULL) AS connected,
   count(*) FILTER(WHERE connected_at IS NULL AND failed) AS start_failures,count(*) FILTER(WHERE connected_at IS NOT NULL AND failed) AS call_failures,
   count(*) FILTER(WHERE connected_at IS NULL AND NOT failed) AS unknown,
   (SELECT count(*) FROM events WHERE event='response_cancelled') AS cancellations,
   (SELECT count(*) FROM events WHERE event='response_failed') AS reply_failures,
   (SELECT count(*) FROM events WHERE event='guide_update_failed') AS guide_failures,
   (SELECT count(*) FROM events WHERE event='guide_update_complete') AS guide_changes,
   (SELECT count(*) FROM events WHERE event='lookup_success') AS lookup_successes,
   (SELECT count(*) FROM events WHERE event='lookup_failure') AS lookup_failures,
   (SELECT count(*) FROM events WHERE event='lookup_cache_hit') AS cache_hits,
   (SELECT avg(duration_ms) FROM events WHERE event='lookup_success') AS lookup_ms,
   (SELECT count(*) FROM events WHERE event='transcription_timeout') AS transcription_timeouts,
   (SELECT count(*) FROM events WHERE event='spoken_language_update_failed') AS language_failures
   FROM selected`,params),
  database.query(cohort+`SELECT topic,language,count(*) AS attempts,count(*) FILTER(WHERE connected_at IS NOT NULL) AS connected,count(*) FILTER(WHERE failed) AS failures FROM selected GROUP BY topic,language ORDER BY count(*) DESC,topic,language`,params),
  database.query(cohort+`SELECT event,COALESCE(code,'unspecified') AS code,count(*) AS count FROM events WHERE event IN ('connection_failure','response_failed','guide_update_failed','lookup_failure','transcription_timeout','spoken_language_update_failed') GROUP BY event,code ORDER BY count(*) DESC,event,code LIMIT 20`,params),
  database.query(cohort+`SELECT session_id,attempt_id,event,code,received_at FROM events WHERE event IN ('connection_failure','response_failed','guide_update_failed','lookup_failure','transcription_timeout','spoken_language_update_failed') ORDER BY received_at DESC,attempt_id,sequence DESC LIMIT 30`,params),
  database.query("SELECT applied_at FROM origen_schema_migrations WHERE name='019_voice_quality.sql'")
 ]);
 return {totals:totals.rows[0],topics:topics.rows,errors:errors.rows,recent:recent.rows,measuredSince:tracking.rows[0]?.applied_at||null,window,generatedAt:window.end};
}

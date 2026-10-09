import {adminWindow} from './admin-overview.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';

// Each row is one retained visit. Aggregate in PostgreSQL before reading it;
// no profile answers, transcript, audio, or provider identifiers are selected.
export const onboardingCohortSQL=`WITH visits AS (
 SELECT account_id,id,started_at,resumed,
 CASE WHEN saved_at >= started_at AND saved_at < $2 THEN saved_at END AS saved_at
 FROM origen_onboarding_attempts WHERE started_at >= $1 AND started_at < $2
), openings AS (
 SELECT DISTINCT ON(e.account_id,e.attempt_id) e.account_id,e.attempt_id,
 CASE WHEN e.metadata->>'language' IN ('en','es') THEN e.metadata->>'language' ELSE 'unknown' END AS language,
 CASE WHEN e.metadata->>'method' IN ('voice','manual','name') THEN e.metadata->>'method' ELSE 'unknown' END AS method,
 e.metadata->>'captureVersion' = '3' AS phase3,e.metadata->>'deliveryVersion' = '1' AS delivery
 FROM origen_onboarding_events e JOIN visits v ON v.account_id=e.account_id AND v.id=e.attempt_id
 WHERE e.producer='client' AND e.name='onboarding_opened' AND e.received_at < $2
 ORDER BY e.account_id,e.attempt_id,e.sequence
), audio AS (
 SELECT DISTINCT ON(e.account_id,e.attempt_id) e.account_id,e.attempt_id,
 CASE WHEN e.metadata->>'durationMs' ~ '^[0-9]{1,6}$' THEN
  CASE WHEN (e.metadata->>'durationMs')::integer <= 600000 THEN (e.metadata->>'durationMs')::integer END END AS first_audio_ms
 FROM origen_onboarding_events e JOIN visits v ON v.account_id=e.account_id AND v.id=e.attempt_id
 WHERE e.producer='client' AND e.name='first_agent_audio' AND e.received_at < $2
 ORDER BY e.account_id,e.attempt_id,e.sequence
), signals AS (
 SELECT e.account_id,e.attempt_id,
 sum(CASE WHEN e.name='voice_start_requested' THEN 1 ELSE 0 END) AS voice_starts,
 sum(CASE WHEN e.name='voice_connected' THEN 1 ELSE 0 END) AS connections,
 sum(CASE WHEN e.name='home_reached' THEN 1 ELSE 0 END) AS home,
 sum(CASE WHEN e.name='native_handoff_acknowledged' THEN 1 ELSE 0 END) AS native_ack,
 sum(CASE WHEN e.name='microphone_denied' THEN 1 ELSE 0 END) AS microphone_denied,
 sum(CASE WHEN e.name IN ('microphone_failed','voice_connection_failed') THEN 1 ELSE 0 END) AS connection_failed,
 sum(CASE WHEN e.name='audio_playback_blocked' THEN 1 ELSE 0 END) AS playback_blocked,
 sum(CASE WHEN e.name='user_speech_transcription' AND e.metadata->>'status'='timeout' THEN 1 ELSE 0 END) AS transcription_timeout,
 sum(CASE WHEN e.name='save_failed' THEN 1 ELSE 0 END) AS save_failed,
 min(CASE WHEN e.name='save_failed' THEN e.received_at END) AS first_save_failure,
 sum(CASE WHEN e.name='validation_failed' THEN 1 ELSE 0 END) AS validation_failed,
 sum(CASE WHEN e.name='save_confirmation_interrupted' THEN 1 ELSE 0 END) AS confirmation_interrupted,
 sum(CASE WHEN e.name IN ('home_transition_failed','native_handoff_failed') THEN 1 ELSE 0 END) AS transition_failed,
 sum(CASE WHEN e.name='setup_method_changed' THEN 1 ELSE 0 END) AS setup_changes
 ,sum(CASE WHEN e.name='save_requested' THEN 1 ELSE 0 END) AS save_requests
 ,sum(CASE WHEN e.name IN ('home_transition_started','native_handoff_requested') THEN 1 ELSE 0 END) AS handoff_requests
 ,sum(CASE WHEN e.name='tracking_delivery_recovered' THEN 1 ELSE 0 END) AS delivery_recovered
 ,sum(CASE WHEN e.name='tracking_delivery_gap' THEN 1 ELSE 0 END) AS delivery_gap
 FROM origen_onboarding_events e JOIN visits v ON v.account_id=e.account_id AND v.id=e.attempt_id
 WHERE e.producer='client' AND e.received_at < $2
 GROUP BY e.account_id,e.attempt_id
)
SELECT v.account_id,v.id,v.started_at,v.saved_at,v.resumed,
 COALESCE(o.language,'unknown') AS language,COALESCE(o.method,'unknown') AS method,COALESCE(o.phase3,false) AS phase3,COALESCE(o.delivery,false) AS delivery,
 s.voice_starts,s.connections,s.home,s.native_ack,s.microphone_denied,s.connection_failed,s.playback_blocked,
 s.transcription_timeout,s.save_failed,s.first_save_failure,s.validation_failed,s.confirmation_interrupted,
 s.transition_failed,s.setup_changes,s.save_requests,s.handoff_requests,s.delivery_recovered,s.delivery_gap,a.first_audio_ms
FROM visits v LEFT JOIN openings o ON o.account_id=v.account_id AND o.attempt_id=v.id
 LEFT JOIN signals s ON s.account_id=v.account_id AND s.attempt_id=v.id
 LEFT JOIN audio a ON a.account_id=v.account_id AND a.attempt_id=v.id
ORDER BY v.started_at,v.account_id,v.id`;

const day=86400000;
const issueKeys=['microphone_denied','connection_failed','playback_blocked','transcription_timeout','validation_failed','save_failed','confirmation_interrupted','transition_failed'];
const count=()=>({attempts:0,saved:0,home:0,issues:0,mature:0,savedWithin24h:0});
const median=values=>{if(!values.length)return null;values.sort((a,b)=>a-b);const mid=Math.floor(values.length/2);return values.length%2?values[mid]:(values[mid-1]+values[mid])/2;};
export function onboardingCohortReport(rows,window,measuredSince=window.start){
 const totals={...count(),users:0,savedUsers:0,returningUsers:0,returningSavedUsers:0,voiceVisits:0,connectedVisits:0,phase3VoiceVisits:0,firstAudioVisits:0,nativeAcknowledged:0,saveRecoveryVisits:0,setupChangeVisits:0};
 const users=new Set(),savedUsers=new Set(),returning=new Set(),returningSaved=new Set(),daily=new Map(),segments=new Map(),saveTimes=[],audioTimes=[];
 const issues=Object.fromEntries(issueKeys.map(key=>[key,0]));
 const end=Date.parse(window.end);
 for(const row of rows){
  const start=+new Date(row.started_at),saved=row.saved_at?+new Date(row.saved_at):null;
  if(!Number.isFinite(start)||start<Date.parse(window.start)||start>=end)continue;
  const confirmed=saved!==null&&Number.isFinite(saved)&&saved>=start&&saved<end;
  const hasIssue=issueKeys.some(key=>Number(row[key])>0),mature=start<=end-day,within=confirmed&&saved-start<=day;
  const add=bucket=>{bucket.attempts++;if(confirmed)bucket.saved++;if(Number(row.home)>0)bucket.home++;if(hasIssue)bucket.issues++;if(mature){bucket.mature++;if(within)bucket.savedWithin24h++;}};
  add(totals);users.add(row.account_id);if(confirmed){savedUsers.add(row.account_id);saveTimes.push(saved-start);}
  if(row.resumed){returning.add(row.account_id);if(confirmed)returningSaved.add(row.account_id);}
  const date=new Date(start).toISOString().slice(0,10);if(!daily.has(date))daily.set(date,count());add(daily.get(date));
  const language=['en','es'].includes(row.language)?row.language:'unknown',method=['voice','manual','name'].includes(row.method)?row.method:'unknown',key=language+':'+method;
  if(!segments.has(key))segments.set(key,{language,method,...count()});add(segments.get(key));
  for(const key of issueKeys)if(Number(row[key])>0)issues[key]++;
  if(Number(row.voice_starts)>0){
   totals.voiceVisits++;if(Number(row.connections)>0)totals.connectedVisits++;
   if(row.phase3===true){
    totals.phase3VoiceVisits++;
    // First sample per visit, not a retry-weighted mean. Null is never zero.
    const duration=Number(row.first_audio_ms);
    if(row.first_audio_ms!==null&&row.first_audio_ms!==undefined&&Number.isInteger(duration)&&duration>=0&&duration<=600000){totals.firstAudioVisits++;audioTimes.push(duration);}
   }
  }
  if(Number(row.native_ack)>0)totals.nativeAcknowledged++;
  if(confirmed&&row.first_save_failure&&+new Date(row.first_save_failure)<=saved)totals.saveRecoveryVisits++;
  if(Number(row.setup_changes)>0)totals.setupChangeVisits++;
 }
 Object.assign(totals,{users:users.size,savedUsers:savedUsers.size,returningUsers:returning.size,returningSavedUsers:returningSaved.size});
 const series=[];for(let at=Date.parse(window.start.slice(0,10));at<end;at+=day){const date=new Date(at).toISOString().slice(0,10);series.push({date,tracked:!!measuredSince&&at+day>Date.parse(measuredSince),...(daily.get(date)||count())});}
 return {totals,issues,timings:{medianSaveMs:median(saveTimes),saveSamples:saveTimes.length,medianFirstAudioMs:median(audioTimes),audioSamples:audioTimes.length},segments:[...segments.values()].sort((a,b)=>b.attempts-a.attempts||a.language.localeCompare(b.language)||a.method.localeCompare(b.method)),series};
}

export async function adminOnboardingMetrics(database,input={},now=new Date(),env={}){
 const days=input.days??30;
 if(![7,30,90].includes(days))throw Object.assign(new Error('invalid_period'),{status:400});
 const window=adminWindow(days,now);
 let tracking;
 try{tracking=(await database.query("SELECT applied_at FROM origen_schema_migrations WHERE name='027_onboarding_events.sql'")).rows[0];}catch(error){if(error.code!=='42P01')throw error;}
 const measuredSince=tracking?.applied_at??null;
 const coverage={available:!!measuredSince,measuredSince,retentionDays:onboardingSettings(env).retentionDays};
 if(!measuredSince)return {coverage,window,generatedAt:window.end,...onboardingCohortReport([],window,null)};
 const rows=(await database.query(onboardingCohortSQL,[window.start,window.end])).rows;
 return {coverage,window,generatedAt:window.end,...onboardingCohortReport(rows,window,measuredSince)};
}

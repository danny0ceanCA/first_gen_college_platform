import {adminWindow} from './admin-overview.mjs';
import {onboardingUUID} from './onboarding-events.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';

const pageSize=30;
const onboarding={
 home_reached:['Home page reached','The browser reported arriving at the web home page.',false],
 save_requested:['Profile save requested','The browser requested a profile save.',false],
 save_succeeded:['Save confirmation received','The browser received a success response; server-confirmed saves appear separately.',false],
 save_failed:['Profile save request failed','The browser reported a failed save request. A later save may have succeeded.',true],
 validation_failed:['Required profile information missing','The browser reported missing information when saving.',true],
 microphone_denied:['Microphone permission denied','The browser could not obtain microphone permission.',true],
 microphone_failed:['Microphone could not start','The browser reported a microphone error.',true],
 voice_connection_failed:['Onboarding voice connection failed','The browser reported a failed voice connection.',true],
 audio_playback_blocked:['Audio playback unavailable','Browser playback was blocked or unavailable; audibility is unknown.',true],
 save_confirmation_interrupted:['Spoken save confirmation interrupted','The spoken confirmation was interrupted. This does not establish a profile-save failure.',true],
 home_transition_failed:['Home transition failed','The browser reported a home transition failure.',true],
 home_guide_update_failed:['Home guide update failed','The browser could not complete the guide update.',true],
 native_handoff_failed:['Native handoff failed','The browser reported a native handoff failure.',true],
 logout_selected:['Log out selected','The user selected log out; completion is not established by this event.',false],
 logout_failed:['Log out request failed','The browser reported a failed log out request.',true],
 tracking_delivery_gap:['Diagnostic history gap reported','The browser reported dropped diagnostics. Missing events cannot be reconstructed.',false],
 tracking_delivery_recovered:['Diagnostic delivery recovered','Queued diagnostics reached the server after retries.',false]
};
const voice={
 connection_failure:['Voice connection problem','A voice connection failure was reported.'],
 response_failed:['Voice response failed','The voice client reported a failed response.'],
 guide_update_failed:['Guide update failed','The voice client reported a guide update failure.'],
 lookup_failure:['Information lookup failed','The voice client reported a failed lookup.'],
 transcription_timeout:['Speech transcription timed out','The voice client reported a transcription timeout.'],
 spoken_language_update_failed:['Spoken-language update failed','The voice client reported a language update failure.']
};
const sqlNames=names=>names.map(name=>`'${name}'`).join(','); // Internal constants only.
const topic=value=>({profile:'Onboarding',planning:'Planning',finance:'College costs',admissions:'Applications',loans:'Loans'})[value]||'Voice';
export function historyFilters(input,now){
 const {id,days=30,page=1,category='all',asOf}=input;
 const cutoff=asOf===undefined?+now:typeof asOf==='string'?Date.parse(asOf):NaN;
 if(!onboardingUUID(id)||![7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>10000||!['all','access','onboarding','voice','summaries','problems'].includes(category)||!Number.isFinite(cutoff)||cutoff>+now||cutoff<+now-86400000)throw Object.assign(new Error('invalid_history_filter'),{status:400});
 return {id,page,category,window:adminWindow(days,new Date(cutoff))};
}

// Server receipt/storage time orders the feed, including delayed browser events.
// No transcript, profile content, provider response or summary text is selected.
export const userHistorySQL=`WITH events AS (
 SELECT 'registered'::text AS id,'registered'::text AS kind,'access'::text AS category,false AS problem,created_at AS recorded_at,NULL::timestamptz AS occurred_at,'server'::text AS evidence,NULL::uuid AS attempt_id,'{}'::jsonb AS details FROM origen_accounts WHERE id=$1
 UNION ALL SELECT 'login:'||id,'sign_in','access',false,created_at,NULL,'server',NULL,'{}'::jsonb FROM origen_login_activity WHERE account_id=$1
 UNION ALL SELECT 'opening','onboarding_started','onboarding',false,onboarding_started_at,NULL,'server',NULL,'{}'::jsonb FROM origen_accounts a WHERE id=$1 AND onboarding_started_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_onboarding_attempts o WHERE o.account_id=a.id AND o.started_at<$3)
 UNION ALL SELECT 'visit:'||id,'onboarding_visit','onboarding',false,started_at,NULL,'server',id,jsonb_build_object('resumed',resumed) FROM origen_onboarding_attempts WHERE account_id=$1
 UNION ALL SELECT 'profile:first','profile_saved','onboarding',false,onboarding_completed_at,NULL,'server',NULL,'{}'::jsonb FROM origen_accounts a WHERE id=$1 AND onboarding_completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_onboarding_attempts o WHERE o.account_id=a.id AND o.saved_at=a.onboarding_completed_at)
 UNION ALL SELECT 'profile:'||id,'profile_saved','onboarding',false,saved_at,NULL,'server',id,'{}'::jsonb FROM origen_onboarding_attempts WHERE account_id=$1 AND saved_at IS NOT NULL
 UNION ALL SELECT 'onboarding:'||attempt_id||':'||producer||':'||sequence,name,'onboarding',name IN (${sqlNames(Object.keys(onboarding).filter(name=>onboarding[name][2]))}),received_at,occurred_at,'browser',attempt_id,'{}'::jsonb FROM origen_onboarding_events WHERE account_id=$1 AND producer='client' AND name IN (${sqlNames(Object.keys(onboarding))})
 UNION ALL SELECT 'call:'||id,'voice_call','voice',false,started_at,NULL,'server',NULL,jsonb_build_object('topic',topic,'seconds',CASE WHEN last_seen_at<$3 THEN seconds ELSE NULL END,'endedAt',CASE WHEN ended_at<$3 THEN ended_at ELSE NULL END) FROM origen_voice_activity WHERE account_id=$1
 UNION ALL SELECT 'quality:'||attempt_id||':'||sequence,event,'voice',true,received_at,NULL,'browser',NULL,'{}'::jsonb FROM origen_voice_quality_events WHERE account_id=$1 AND event IN (${sqlNames(Object.keys(voice))})
 UNION ALL SELECT 'summary:'||md5(id),'summary_stored','summaries',false,created_at,NULL,'server',NULL,jsonb_build_object('topic',mode) FROM origen_conversation_summaries WHERE account_id=$1
 UNION ALL SELECT 'generation:'||id,'summary_generation_failed','summaries',true,finished_at,NULL,'server',NULL,'{}'::jsonb FROM origen_ai_executions WHERE account_id=$1 AND operation='summary' AND status='failed'
), visible AS (SELECT * FROM events WHERE recorded_at>=$2 AND recorded_at<$3)`;
const categorySQL="($4='all' OR category=$4 OR ($4='problems' AND problem))";

export function presentHistoryEvent(row){
 let title,note;
 const definitions={
  registered:['Account registered','An app account was created.'],
  sign_in:['Signed in','A successful web sign-in return was recorded.'],
  onboarding_started:['Onboarding opened','An account-level opening milestone was recorded. Detailed visit history may be missing.'],
  onboarding_visit:['Onboarding visit recorded',row.details?.resumed?'Another visit was recorded for this account.':'First retained visit; earlier history may be unavailable.'],
  profile_saved:['Profile saved','The server confirmed the profile save.'],
  summary_stored:['Conversation summary stored',`${topic(row.details?.topic)} · a summary record is currently stored. This is its first storage time, which may differ from the conversation time.`],
  summary_generation_failed:['Summary processing failed','The server recorded a failed summary operation. Older records combine generation, storage and post-processing; later attempts may have succeeded.']
 };
 if(row.kind==='voice_call'){
  title=`${topic(row.details?.topic)} conversation`;
  const seconds=row.details?.seconds;
  note=`Starting topic · ${typeof seconds==='number'?`${(seconds/60).toLocaleString('en-US',{maximumFractionDigits:1})} recorded connected minutes`:'Duration at this report cutoff is unavailable'}. ${row.details?.endedAt?'An end receipt was recorded.':'No end receipt recorded by the cutoff; this does not mean the call is active.'}`;
 }else [title,note]=definitions[row.kind]||onboarding[row.kind]||voice[row.kind]||['Recorded event',''];
 return {id:row.id,kind:row.kind,category:row.category,problem:row.problem,recordedAt:row.recorded_at,occurredAt:row.occurred_at,evidence:row.evidence,attemptId:row.attempt_id,title,note};
}

export function historyRecap(account,counts){
 const n=key=>Number(counts[key]||0),saved=!!account.onboarding_completed_at;
 const title=saved?'Profile save confirmed':account.onboarding_started_at||n('visits')?'Setup started; save not confirmed':'No confirmed profile save';
 const lines=[saved?'The account has a server-confirmed setup completion.':'The available history does not confirm a completed profile save.'];
 lines.push(`${n('visits')} onboarding visit${n('visits')===1?'':'s'} and ${n('calls')} conversation record${n('calls')===1?'':'s'} in this period.`);
 lines.push(n('home_arrivals')?'The browser reported reaching the home page in this period.':'Home arrival was not recorded in this period; the navigation outcome is unknown.');
 lines.push(n('summaries')?`${n('summaries')} stored summary record${n('summaries')===1?'':'s'} first saved in this period.`:'No stored summary was first saved in this period. This does not establish a save failure.');
 if(n('problems'))lines.push(`${n('problems')} recorded problem signal${n('problems')===1?'':'s'}; these may describe the same incident and do not establish that it is still unresolved.`);
 else lines.push('No problem signals were recorded in this period; unreported problems are still possible.');
 if(n('gaps'))lines.push('The browser reported gaps in diagnostic delivery.');
 return {title,lines};
}

export async function adminUserHistory(database,input,now=new Date(),env={}){
 const f=historyFilters(input,now);
 const account=(await database.query('SELECT id,CASE WHEN onboarding_started_at<$2 THEN onboarding_started_at END AS onboarding_started_at,CASE WHEN onboarding_completed_at<$2 THEN onboarding_completed_at END AS onboarding_completed_at FROM origen_accounts WHERE id=$1 AND created_at<$2',[f.id,f.window.end])).rows[0];
 if(!account)throw Object.assign(new Error('user_not_found'),{status:404});
 const params=[f.id,f.window.start,f.window.end,f.category];
 const [stats,rows,tracking]=await Promise.all([
  database.query(`${userHistorySQL} SELECT count(*) FILTER(WHERE ${categorySQL}) AS total,count(*) FILTER(WHERE kind='onboarding_visit') AS visits,count(*) FILTER(WHERE kind='voice_call') AS calls,count(*) FILTER(WHERE kind='home_reached') AS home_arrivals,count(*) FILTER(WHERE kind='summary_stored') AS summaries,count(*) FILTER(WHERE kind='summary_generation_failed') AS summary_failures,count(*) FILTER(WHERE problem) AS problems,count(*) FILTER(WHERE kind='tracking_delivery_gap') AS gaps FROM visible`,params),
  database.query(`${userHistorySQL} SELECT * FROM visible WHERE ${categorySQL} ORDER BY recorded_at DESC,id DESC LIMIT 30 OFFSET $5`,[...params,(f.page-1)*pageSize]),
  database.query("SELECT name,applied_at FROM origen_schema_migrations WHERE name IN ('017_admin_activity.sql','027_onboarding_events.sql','019_voice_quality.sql','015_guidance_history.sql')")
 ]);
 const counts=Object.fromEntries(Object.entries(stats.rows[0]).map(([key,value])=>[key,Number(value)]));
 return {events:rows.rows.map(presentHistoryEvent),counts,recap:historyRecap(account,counts),total:counts.total,page:f.page,pageSize,category:f.category,window:f.window,coverage:{measuredSince:Object.fromEntries(tracking.rows.map(row=>[row.name,row.applied_at])),onboardingRetentionDays:onboardingSettings(env).retentionDays,guidanceEnabled:env.GUIDANCE_HISTORY_ENABLED==='true'}};
}

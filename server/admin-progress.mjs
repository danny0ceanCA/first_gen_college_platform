import {adminWindow} from './admin-overview.mjs';
import {engagementRate} from './admin-engagement.mjs';
import {progressEnabled} from './progress-history.mjs';

export function progressFilters(input={}){
 if(Object.keys(input).some(k=>!['action','days'].includes(k))||![7,30,90].includes(input.days??30))throw Object.assign(new Error('invalid_progress_filter'),{status:400});
 return {days:input.days??30};
}
export const progressSQL=`WITH reports AS MATERIALIZED (
 SELECT account_id,kind,value,response_status,prompt_id,definition_id,definition_version FROM origen_progress_reports WHERE recorded_at>=$1 AND recorded_at<$2
), feedback AS (
 SELECT * FROM reports WHERE kind='feedback' AND definition_id='guidance-helpfulness' AND definition_version=1
), prompts AS (
 SELECT p.account_id,p.id,r.response_status FROM origen_feedback_prompts p
 LEFT JOIN origen_progress_reports r ON r.account_id=p.account_id AND r.prompt_id=p.id AND r.kind='feedback'
 AND r.recorded_at>=p.recorded_at AND r.recorded_at<$2
 WHERE p.recorded_at>=$1 AND p.recorded_at<$2
)
SELECT jsonb_build_object(
 'submissions',(SELECT count(*) FROM feedback),
 'accounts',(SELECT count(DISTINCT account_id) FROM feedback),
 'answered',(SELECT count(*) FROM feedback WHERE response_status='answered'),
 'helpful',(SELECT count(*) FROM feedback WHERE response_status='answered' AND value='helpful'),
 'partly',(SELECT count(*) FROM feedback WHERE response_status='answered' AND value='partly'),
 'notYet',(SELECT count(*) FROM feedback WHERE response_status='answered' AND value='not-yet'),
 'declined',(SELECT count(*) FROM feedback WHERE response_status='declined'),
 'unknown',(SELECT count(*) FROM feedback WHERE response_status='unknown'),
 'unlinked',(SELECT count(*) FROM feedback WHERE prompt_id IS NULL),
 'otherDefinitions',(SELECT count(*) FROM reports WHERE kind='feedback' AND NOT(definition_id='guidance-helpfulness' AND definition_version=1)),
 'opened',(SELECT count(*) FROM prompts),
 'answeredPrompts',(SELECT count(*) FROM prompts WHERE response_status='answered'),
 'declinedPrompts',(SELECT count(*) FROM prompts WHERE response_status='declined'),
 'withoutAnswer',(SELECT count(*) FROM prompts WHERE response_status IS NULL OR response_status='unknown')
) AS feedback,
 COALESCE((SELECT jsonb_agg(m) FROM (
  SELECT value,count(*) AS submissions,count(DISTINCT account_id) AS accounts FROM reports WHERE kind='milestone' GROUP BY value ORDER BY value
 ) m),'[]'::jsonb) AS milestones,
 (SELECT count(DISTINCT account_id) FROM reports WHERE kind='milestone') AS milestone_accounts`;

export async function adminProgress(database,input={},now=new Date(),env={}){
 const filters=progressFilters(input),window=adminWindow(filters.days,now);
 const c=await database.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tracking=(await c.query("SELECT name,applied_at FROM origen_schema_migrations WHERE name IN ('016_progress_history.sql','030_progress_reporting.sql')")).rows;
  const dates=Object.fromEntries(tracking.map(r=>[r.name,new Date(r.applied_at).toISOString()]));
  const row=(await c.query(progressSQL,[window.start,window.end])).rows[0];
  await c.query('COMMIT');
  const f=row.feedback;
  return {schemaVersion:1,classification:'internal-service-improvement',generatedAt:window.end,window,filters,
   collectionEnabled:progressEnabled(env),coverage:{reportsSince:dates['016_progress_history.sql']??null,promptsSince:dates['030_progress_reporting.sql']??null,retentionDays:90,frontendAvailability:'not-verified'},
   feedback:{...f,helpfulness:engagementRate(f.helpful,f.answered),participation:engagementRate(f.answeredPrompts,f.opened)},
   milestones:row.milestones,milestoneAccounts:Number(row.milestone_accounts),
   definitions:{population:'Retained submissions from all reporting accounts. Repeated reports are possible; these are not a representative sample of registered users.',
    helpfulness:'Helpful answers divided by Helpful, Partly and Not yet answers to guidance-helpfulness version 1. Declined and unknown responses are excluded.',
    participation:'Answered opportunities divided by recorded openings of the optional feedback panel in this window, with responses received before the report cutoff. One opportunity per student panel mount; closing and reopening it does not add another. Openings do not prove the question was read.',
    missingness:'Historical feedback has no opening record. Unlinked feedback is included in helpfulness, never in the participation numerator. Missing opening receipts, native clients and disabled collection can undercount opportunities. No answer is not negative feedback.',
    milestones:'Optional self-reported steps, grouped by server receipt date, not the date the step occurred. Accounts may report several steps or repeat one. No school verification or causal attribution to Origen.',
    access:'Internal aggregate service improvement only. No institutional affiliation, research dataset, transcript or conversation summary is included. Deleted accounts disappear; records are retained up to 90 days.'}};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

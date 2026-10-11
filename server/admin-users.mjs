import {adminWindow} from './admin-overview.mjs';

const sorts={registered:'created_at',name:'first_name',last_login:'last_login',last_activity:'last_activity_at',logins:'logins',voice_minutes:'voice_minutes'};
const stages=['all','registered','onboarding_started','save_unconfirmed','profile_saved','guidance_used'];
function invalid(){throw Object.assign(new Error('invalid_user_filter'),{status:400});}
export function userFilters(input){
 const {days=30,page=1,search='',role='all',status='all',journey='all',sort='registered',direction='desc'}=input;
 if(![7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>100000||typeof search!=='string'||search.length>100||!['all','parent','student','unknown'].includes(role)||!['all','complete','incomplete','unknown'].includes(status)||!stages.includes(journey)||!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))invalid();
 return {days,page,search:search.trim(),role,status,journey,sort,direction};
}

// Aggregate each source before joining so multiple profiles/visits cannot
// multiply usage. Read operational facts only, never conversation content.
export const adminUserFactsSQL=`WITH accounts AS (
 SELECT id,first_name,role,created_at,
 CASE WHEN onboarding_started_at<$2 THEN onboarding_started_at END AS onboarding_started_at,
 CASE WHEN onboarding_completed_at<$2 THEN onboarding_completed_at END AS onboarding_completed_at
 FROM origen_accounts WHERE created_at<$2
 AND (first_name ILIKE $3 ESCAPE '\\' OR id::text ILIKE $3 ESCAPE '\\')
 AND ($4='all' OR role=$4 OR ($4='unknown' AND role IS NULL))
 AND ($5::uuid IS NULL OR id=$5)
), logins AS (
 SELECT l.account_id,count(*) FILTER(WHERE l.created_at>=$1) AS logins,max(l.created_at) AS last_login
 FROM origen_login_activity l JOIN accounts a ON a.id=l.account_id WHERE l.created_at<$2 GROUP BY l.account_id
), voices AS (
 SELECT v.account_id,count(*) FILTER(WHERE v.started_at>=$1) AS calls,
 COALESCE(sum(v.seconds) FILTER(WHERE v.started_at>=$1),0)::double precision/60 AS voice_minutes,
 max(CASE WHEN v.last_seen_at<$2 THEN v.last_seen_at ELSE v.started_at END) AS last_voice_activity,
 min(CASE WHEN v.seconds>0 AND v.topic<>'profile' AND v.started_at>=a.onboarding_completed_at THEN v.started_at END) AS first_guidance_at
 FROM origen_voice_activity v JOIN accounts a ON a.id=v.account_id WHERE v.started_at<$2 GROUP BY v.account_id
), visits AS (
 SELECT o.account_id,min(o.started_at) AS first_onboarding_at,max(o.last_received_at) AS last_onboarding_activity
 FROM origen_onboarding_attempts o JOIN accounts a ON a.id=o.account_id WHERE o.last_received_at<$2 GROUP BY o.account_id
), students AS (
 SELECT s.account_id,count(*) AS student_profiles FROM origen_students s JOIN accounts a ON a.id=s.account_id WHERE s.created_at<$2 GROUP BY s.account_id
), facts AS (
 SELECT a.id,a.first_name,a.role,a.created_at,COALESCE(a.onboarding_started_at,o.first_onboarding_at) AS onboarding_started_at,a.onboarding_completed_at,
 a.onboarding_completed_at IS NOT NULL AS profile_complete,
 (COALESCE(btrim(a.first_name)<>'' AND a.role IN ('parent','student'),false) OR COALESCE(s.student_profiles,0)>0) AS profile_details_present,
 COALESCE(s.student_profiles,0) AS student_profiles,COALESCE(l.logins,0) AS logins,l.last_login,
 COALESCE(v.calls,0) AS calls,COALESCE(v.voice_minutes,0) AS voice_minutes,v.first_guidance_at,
 v.last_voice_activity,o.last_onboarding_activity,
 GREATEST(a.created_at,l.last_login,v.last_voice_activity,o.last_onboarding_activity,a.onboarding_started_at,a.onboarding_completed_at) AS last_activity_at
 FROM accounts a LEFT JOIN logins l ON l.account_id=a.id LEFT JOIN voices v ON v.account_id=a.id
 LEFT JOIN visits o ON o.account_id=a.id LEFT JOIN students s ON s.account_id=a.id
), directory AS (
 SELECT facts.*,
 CASE WHEN first_guidance_at IS NOT NULL THEN 'guidance_used' WHEN profile_complete THEN 'profile_saved'
 WHEN profile_details_present THEN 'save_unconfirmed' WHEN onboarding_started_at IS NOT NULL THEN 'onboarding_started' ELSE 'registered' END AS journey_stage,
 CASE WHEN last_activity_at=onboarding_completed_at THEN 'profile_saved' WHEN last_activity_at=last_onboarding_activity THEN 'onboarding_receipt'
 WHEN last_activity_at=last_voice_activity THEN 'voice_activity' WHEN last_activity_at=last_login THEN 'sign_in'
 WHEN last_activity_at=onboarding_started_at THEN 'onboarding_started' ELSE 'registered' END AS last_activity_kind
 FROM facts
)`;
const directoryFields='id,first_name,role,created_at,onboarding_started_at,onboarding_completed_at,profile_complete,profile_details_present,student_profiles,logins,last_login,calls,voice_minutes,first_guidance_at,last_activity_at,last_activity_kind,journey_stage';
const directoryFilter=`($6='all' OR ($6='complete' AND profile_complete) OR ($6='unknown' AND NOT profile_complete AND profile_details_present) OR ($6='incomplete' AND NOT profile_complete AND NOT profile_details_present)) AND ($7='all' OR journey_stage=$7)`;
function paramsFor(f,window,id=null){return [window.start,window.end,`%${f.search.replace(/[\\%_]/g,'\\$&')}%`,f.role,id];}
async function accessEvidence(database,rows,adminSubjects){
 const subjects=[...new Set(adminSubjects.filter(value=>typeof value==='string'&&value))];
 const known=rows.length&&subjects.length?(await database.query('SELECT id FROM origen_accounts WHERE id=ANY($1::uuid[]) AND auth0_subject=ANY($2::text[])',[rows.map(row=>row.id),subjects])).rows:[];
 const ids=new Set(known.map(row=>row.id));
 return rows.map(row=>({...row,admin_access:ids.has(row.id)?'confirmed':'not_verified'}));
}
export async function adminUsers(database,input,now=new Date(),adminSubjects=[]){
 const f=userFilters(input),window=adminWindow(f.days,now),params=[...paramsFor(f,window),f.status,f.journey];
 const [count,rows,funnel]=await Promise.all([
  database.query(`${adminUserFactsSQL} SELECT count(*) AS total FROM directory WHERE ${directoryFilter}`,params),
  database.query(`${adminUserFactsSQL} SELECT ${directoryFields} FROM directory WHERE ${directoryFilter} ORDER BY ${sorts[f.sort]} ${f.direction.toUpperCase()} NULLS LAST,id ASC LIMIT 25 OFFSET $8`,[...params,(f.page-1)*25]),
  database.query(`WITH tracking AS (SELECT applied_at FROM origen_schema_migrations WHERE name='018_onboarding_milestones.sql'), cohort AS
   (SELECT a.* FROM origen_accounts a,tracking t WHERE a.created_at >= greatest($1::timestamptz,t.applied_at) AND a.created_at < $2)
   SELECT (SELECT applied_at FROM tracking) AS measured_since,count(*) AS registered,
   count(*) FILTER (WHERE onboarding_started_at<$2) AS started,
   count(*) FILTER (WHERE onboarding_completed_at<$2) AS completed,
   count(*) FILTER (WHERE onboarding_completed_at<$2 AND EXISTS
    (SELECT 1 FROM origen_voice_activity v WHERE v.account_id=cohort.id AND v.seconds>0 AND v.topic<>'profile' AND v.started_at>=cohort.onboarding_completed_at AND v.started_at<$2)) AS first_conversation,
   (SELECT count(*) FROM origen_accounts a,tracking t WHERE a.created_at >= $1 AND a.created_at < least($2::timestamptz,t.applied_at)) AS untracked
   FROM cohort`,[window.start,window.end])
 ]);
 return {users:await accessEvidence(database,rows.rows,adminSubjects),total:Number(count.rows[0].total),page:f.page,pageSize:25,filters:f,window,funnel:funnel.rows[0]};
}
export async function adminUserDetail(database,input,now=new Date(),adminSubjects=[]){
 if(input.days!==undefined&&![7,30,90].includes(input.days))invalid();
 if(typeof input.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))invalid();
 const f=userFilters({days:input.days}),window=adminWindow(f.days,now);
 const user=(await database.query(`${adminUserFactsSQL} SELECT ${directoryFields} FROM directory`,paramsFor(f,window,input.id))).rows[0];
 if(!user)throw Object.assign(new Error('user_not_found'),{status:404});
 const activity=await database.query(`SELECT * FROM (SELECT id,'sign_in' AS event,created_at AS occurred_at,0::double precision AS minutes,'' AS topic FROM origen_login_activity WHERE account_id=$1
  UNION ALL SELECT id,'voice_call',started_at,seconds/60,topic FROM origen_voice_activity WHERE account_id=$1) events WHERE occurred_at>=$2 AND occurred_at<$3 ORDER BY occurred_at DESC,id LIMIT 30`,[input.id,window.start,window.end]);
 return {user:(await accessEvidence(database,[user],adminSubjects))[0],activity:activity.rows,window};
}

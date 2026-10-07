import {adminWindow} from './admin-overview.mjs';
const complete="(a.first_name <> '' AND a.role IN ('parent','student'))";
const sorts={registered:'a.created_at',name:'a.first_name',last_login:'last_login',logins:'logins',voice_minutes:'voice_minutes'};
function invalid(){throw Object.assign(new Error('invalid_user_filter'),{status:400});}
export function userFilters(input){
 const {days=30,page=1,search='',role='all',status='all',sort='registered',direction='desc'}=input;
 if(![7,30,90].includes(days)||!Number.isInteger(page)||page<1||page>100000||typeof search!=='string'||search.length>100||!['all','parent','student','unknown'].includes(role)||!['all','complete','incomplete'].includes(status)||!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction))invalid();
 return {days,page,search:search.trim(),role,status,sort,direction};
}
export async function adminUsers(database,input,now=new Date()){
 const f=userFilters(input),window=adminWindow(f.days,now);
 // Escape LIKE metacharacters: search is literal, never executable SQL.
 const params=[`%${f.search.replace(/[\\%_]/g,'\\$&')}%`,f.role,f.status,window.start,window.end];
 const where=`(a.first_name ILIKE $1 ESCAPE '\\' OR a.id::text ILIKE $1 ESCAPE '\\') AND ($2='all' OR a.role=$2 OR ($2='unknown' AND a.role IS NULL)) AND ($3='all' OR ($3='complete' AND ${complete}) OR ($3='incomplete' AND NOT COALESCE(${complete},false)))`;
 const [count,rows,funnel]=await Promise.all([
  database.query(`SELECT count(*) AS total FROM origen_accounts a WHERE ${where}`,params.slice(0,3)),
  database.query(`SELECT a.id,a.first_name,a.role,a.created_at,${complete} AS profile_complete,a.onboarding_started_at,a.onboarding_completed_at,
   (SELECT count(*) FROM origen_login_activity l WHERE l.account_id=a.id AND l.created_at >= $4 AND l.created_at < $5) AS logins,
   (SELECT max(created_at) FROM origen_login_activity l WHERE l.account_id=a.id) AS last_login,
   (SELECT COALESCE(sum(seconds),0)::double precision/60 FROM origen_voice_activity v WHERE v.account_id=a.id AND v.started_at >= $4 AND v.started_at < $5) AS voice_minutes
   FROM origen_accounts a WHERE ${where} ORDER BY ${sorts[f.sort]} ${f.direction.toUpperCase()} NULLS LAST,a.id ASC LIMIT 25 OFFSET $6`,[...params,(f.page-1)*25]),
  database.query(`WITH tracking AS (SELECT applied_at FROM origen_schema_migrations WHERE name='018_onboarding_milestones.sql'), cohort AS
   (SELECT a.* FROM origen_accounts a,tracking t WHERE a.created_at >= greatest($1::timestamptz,t.applied_at) AND a.created_at < $2)
   SELECT (SELECT applied_at FROM tracking) AS measured_since,count(*) AS registered,
   count(*) FILTER (WHERE onboarding_started_at IS NOT NULL) AS started,
   count(*) FILTER (WHERE onboarding_started_at IS NOT NULL AND onboarding_completed_at IS NOT NULL) AS completed,
   count(*) FILTER (WHERE onboarding_started_at IS NOT NULL AND onboarding_completed_at IS NOT NULL AND EXISTS
    (SELECT 1 FROM origen_voice_activity v WHERE v.account_id=cohort.id AND v.seconds>0 AND v.started_at>=cohort.onboarding_completed_at AND v.started_at<$2)) AS first_conversation,
   (SELECT count(*) FROM origen_accounts a,tracking t WHERE a.created_at >= $1 AND a.created_at < least($2::timestamptz,t.applied_at)) AS untracked
   FROM cohort`,[window.start,window.end])
 ]);
 return {users:rows.rows,total:Number(count.rows[0].total),page:f.page,pageSize:25,filters:f,window,funnel:funnel.rows[0]};
}
export async function adminUserDetail(database,input,now=new Date()){
 if(input.days!==undefined&&![7,30,90].includes(input.days))invalid();
 if(typeof input.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))invalid();
 const window=adminWindow(input.days??30,now);
 const user=(await database.query(`SELECT id,first_name,role,created_at,onboarding_started_at,onboarding_completed_at,first_name<>'' AND role IN ('parent','student') AS profile_complete FROM origen_accounts WHERE id=$1`,[input.id])).rows[0];
 if(!user)throw Object.assign(new Error('user_not_found'),{status:404});
 const [usage,activity]=await Promise.all([
  database.query(`SELECT (SELECT count(*) FROM origen_login_activity WHERE account_id=$1 AND created_at>=$2 AND created_at<$3) AS logins,
   (SELECT max(created_at) FROM origen_login_activity WHERE account_id=$1) AS last_login,
   (SELECT count(*) FROM origen_voice_activity WHERE account_id=$1 AND started_at>=$2 AND started_at<$3) AS calls,
   (SELECT COALESCE(sum(seconds),0)::double precision/60 FROM origen_voice_activity WHERE account_id=$1 AND started_at>=$2 AND started_at<$3) AS voice_minutes`,[input.id,window.start,window.end]),
  database.query(`SELECT * FROM (SELECT id,'sign_in' AS event,created_at AS occurred_at,0::double precision AS minutes,'' AS topic FROM origen_login_activity WHERE account_id=$1
   UNION ALL SELECT id,'voice_call',started_at,seconds/60,topic FROM origen_voice_activity WHERE account_id=$1) events WHERE occurred_at>=$2 AND occurred_at<$3 ORDER BY occurred_at DESC,id LIMIT 30`,[input.id,window.start,window.end])
 ]);
 return {user:{...user,...usage.rows[0]},activity:activity.rows,window};
}

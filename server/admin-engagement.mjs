import {adminWindow} from './admin-overview.mjs';
import {onboardingSettings} from './onboarding-settings.mjs';

const day=86400000;
export function engagementFilters(input={}){
 const {days=30,role='all'}=input;
 if(![7,30,90].includes(days)||!['all','parent','student','unknown'].includes(role))throw Object.assign(new Error('invalid_engagement_filter'),{status:400});
 return {days,role};
}
export function engagementRate(numerator,denominator){return {numerator,denominator,percent:denominator?Math.round(numerator/denominator*1000)/10:null};}
const roleSQL="($5='all' OR role=$5 OR ($5='unknown' AND role IS NULL))";
// Accounts, not visits or student records. Pre-aggregate calls before computing
// cohorts; multiple attempts, logins and home events cannot multiply a user.
export const engagementFactsSQL=`WITH population AS (
 SELECT id,created_at,onboarding_completed_at FROM origen_accounts
 WHERE created_at<$2 AND ${roleSQL} AND NOT(auth0_subject=ANY($6::text[]))
), qualifying_calls AS (
 SELECT v.id,v.account_id,v.started_at FROM origen_voice_activity v JOIN population a ON a.id=v.account_id
 WHERE v.started_at>=$3 AND v.started_at<$2 AND v.last_seen_at<$2 AND v.seconds>0
 AND v.topic IN ('planning','finance','admissions','loans')
 AND v.started_at>=a.created_at AND v.started_at>=a.onboarding_completed_at
), first_guidance AS (
 SELECT account_id,min(started_at) AS activated_at FROM qualifying_calls GROUP BY account_id
), cohort AS (
 SELECT a.id,a.created_at,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS cohort_date,
 CASE WHEN a.onboarding_completed_at>=a.created_at AND a.onboarding_completed_at<$2 THEN a.onboarding_completed_at END AS saved_at,
 g.activated_at,
 $4::timestamptz IS NOT NULL AND a.created_at>=$4 AS home_eligible,
 EXISTS(SELECT 1 FROM origen_onboarding_events e WHERE e.account_id=a.id AND e.producer='client' AND e.name='home_reached' AND e.received_at>=a.created_at AND e.received_at>=a.onboarding_completed_at AND e.received_at<$2) AS home_observed,
 EXISTS(SELECT 1 FROM qualifying_calls c WHERE c.account_id=a.id AND c.started_at>g.activated_at AND c.started_at<=g.activated_at+interval '168 hours' AND (c.started_at AT TIME ZONE 'UTC')::date>(g.activated_at AT TIME ZONE 'UTC')::date) AS returned
 FROM population a LEFT JOIN first_guidance g ON g.account_id=a.id
 WHERE a.created_at>=$1 AND a.created_at>=$3
)`;
export const engagementCohortSQL=`${engagementFactsSQL}
 SELECT cohort_date,count(*) AS registered,
 count(*) FILTER(WHERE saved_at IS NOT NULL) AS saved,
 count(*) FILTER(WHERE home_eligible) AS home_eligible,
 count(*) FILTER(WHERE home_eligible AND home_observed) AS home,
 count(*) FILTER(WHERE activated_at IS NOT NULL) AS activated,
 count(*) FILTER(WHERE created_at<=$2::timestamptz-interval '168 hours') AS mature_registrations,
 count(*) FILTER(WHERE created_at<=$2::timestamptz-interval '168 hours' AND saved_at<=created_at+interval '168 hours') AS saved_within_7d,
 count(*) FILTER(WHERE created_at<=$2::timestamptz-interval '168 hours' AND activated_at<=created_at+interval '168 hours') AS activated_within_7d,
 count(*) FILTER(WHERE activated_at<=$2::timestamptz-interval '168 hours') AS mature_activations,
 count(*) FILTER(WHERE activated_at<=$2::timestamptz-interval '168 hours' AND returned) AS returned_within_7d
 FROM cohort GROUP BY GROUPING SETS((),(cohort_date)) ORDER BY cohort_date DESC NULLS FIRST`;

const numericRow=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='cohort_date'?value:Number(value)]));
export async function adminEngagement(database,input={},now=new Date(),env={},adminSubjects=[]){
 const f=engagementFilters(input),window=adminWindow(f.days,now);
 const tracking=(await database.query("SELECT name,applied_at FROM origen_schema_migrations WHERE name IN ('017_admin_activity.sql','018_onboarding_milestones.sql','027_onboarding_events.sql')")).rows;
 const dates=Object.fromEntries(tracking.map(row=>[row.name,new Date(row.applied_at).toISOString()]));
 const baseline=['017_admin_activity.sql','018_onboarding_milestones.sql'].map(name=>dates[name]);
 const measuredSince=baseline.every(Boolean)?new Date(Math.max(...baseline.map(Date.parse))).toISOString():null;
 const retentionDays=onboardingSettings(env).retentionDays;
 const homeSince=dates['027_onboarding_events.sql']?new Date(Math.max(Date.parse(dates['027_onboarding_events.sql']),+now-retentionDays*day)).toISOString():null;
 const coverage={available:!!measuredSince&&Date.parse(measuredSince)<+now,measuredSince,homeSince,onboardingRetentionDays:retentionDays,dates};
 if(!coverage.available)return {coverage,window,generatedAt:window.end,filters:f};
 const subjects=[...new Set(adminSubjects.filter(value=>typeof value==='string'&&value))];
 const params=[window.start,window.end,measuredSince,homeSince,f.role,subjects];
 const [cohorts,usage,scope]=await Promise.all([
  database.query(engagementCohortSQL,params),
  database.query(`${engagementFactsSQL}, period_calls AS (SELECT * FROM qualifying_calls WHERE started_at>=$1)
   SELECT count(DISTINCT account_id) AS active_accounts,count(*) AS calls,
   count(DISTINCT (account_id,(started_at AT TIME ZONE 'UTC')::date)) AS active_account_days,
   count(DISTINCT account_id) FILTER(WHERE NOT EXISTS(SELECT 1 FROM origen_login_activity l WHERE l.account_id=period_calls.account_id AND l.created_at>=$1 AND l.created_at<$2)) AS active_without_signin
   FROM period_calls`,params),
  database.query(`SELECT count(*) AS registered,
   count(*) FILTER(WHERE auth0_subject=ANY($5::text[])) AS known_admins,
   count(*) FILTER(WHERE NOT(auth0_subject=ANY($5::text[])) AND created_at<$3) AS before_tracking
   FROM origen_accounts WHERE created_at>=$1 AND created_at<$2 AND ($4='all' OR role=$4 OR ($4='unknown' AND role IS NULL))`,[window.start,window.end,measuredSince,f.role,subjects])
 ]);
 const rows=cohorts.rows.map(numericRow),totals=rows.find(row=>row.cohort_date===null);
 return {coverage,window,generatedAt:window.end,filters:f,scope:numericRow(scope.rows[0]),usage:numericRow(usage.rows[0]),cohort:{totals,days:rows.filter(row=>row.cohort_date!==null)},metrics:{
  setupWithin7d:engagementRate(totals.saved_within_7d,totals.mature_registrations),
  activationWithin7d:engagementRate(totals.activated_within_7d,totals.mature_registrations),
  returnWithin7d:engagementRate(totals.returned_within_7d,totals.mature_activations)
 }};
}

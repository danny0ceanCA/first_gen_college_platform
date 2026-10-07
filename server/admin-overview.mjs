const day=86400000;
export function adminWindow(days=30,now=new Date()){
 if(![7,30,90].includes(days))throw new Error('invalid_period');
 const end=new Date(now),start=new Date(+end-days*day),previousStart=new Date(+start-days*day);
 return {days,start:start.toISOString(),end:end.toISOString(),previousStart:previousStart.toISOString()};
}
const periodSQL=`SELECT
 (SELECT count(*) FROM origen_accounts WHERE created_at >= $1 AND created_at < $2) AS new_users,
 (SELECT count(*) FROM origen_login_activity WHERE created_at >= $1 AND created_at < $2) AS logins,
 (SELECT count(DISTINCT account_id) FROM origen_login_activity WHERE created_at >= $1 AND created_at < $2) AS active_users,
 (SELECT coalesce(sum(seconds),0)::double precision/60 FROM origen_voice_activity WHERE started_at >= $1 AND started_at < $2) AS voice_minutes,
 (SELECT count(*) FROM origen_voice_activity WHERE started_at >= $1 AND started_at < $2) AS calls`;
export function adminSeries(rows,window,measuredSince){
 const indexed=new Map(rows.map(row=>[new Date(row.date).toISOString().slice(0,10),row]));
 const series=[];
 for(let at=Date.parse(window.start.slice(0,10));at<Date.parse(window.end);at+=day){
  const date=new Date(at).toISOString().slice(0,10),row=indexed.get(date)||{};
  const tracked=!!measuredSince&&at+day>Date.parse(measuredSince);
  series.push({date,new_users:Number(row.new_users||0),logins:tracked?Number(row.logins||0):null,voice_minutes:tracked?Number(row.voice_minutes||0):null,calls:tracked?Number(row.calls||0):null});
 }
 return series;
}
export async function adminOverview(database,days=30,now=new Date()){
 const window=adminWindow(days,now);
 const [current,previous,count,users,activity,daily,tracking]=await Promise.all([
 database.query(periodSQL,[window.start,window.end]),
 database.query(periodSQL,[window.previousStart,window.start]),
 database.query('SELECT count(*) AS users FROM origen_accounts'),
 database.query(`SELECT a.id,a.first_name,a.created_at,
 (SELECT count(*) FROM origen_login_activity l WHERE l.account_id=a.id AND l.created_at >= $1 AND l.created_at < $2) AS logins,
 (SELECT max(created_at) FROM origen_login_activity l WHERE l.account_id=a.id) AS last_login,
 (SELECT coalesce(sum(seconds),0)::double precision/60 FROM origen_voice_activity v WHERE v.account_id=a.id AND v.started_at >= $1 AND v.started_at < $2) AS voice_minutes
 FROM origen_accounts a ORDER BY a.created_at DESC LIMIT 200`,[window.start,window.end]),
 database.query(`SELECT * FROM (
 SELECT l.id,l.account_id,a.first_name,'sign_in' AS event,l.created_at AS occurred_at,0::double precision AS minutes,'' AS topic FROM origen_login_activity l JOIN origen_accounts a ON a.id=l.account_id
 UNION ALL SELECT v.id,v.account_id,a.first_name,'voice_call',v.started_at,v.seconds::double precision/60,v.topic FROM origen_voice_activity v JOIN origen_accounts a ON a.id=v.account_id
 ) events WHERE occurred_at >= $1 AND occurred_at < $2 ORDER BY occurred_at DESC LIMIT 50`,[window.start,window.end]),
 database.query(`SELECT to_char(date,'YYYY-MM-DD') AS date,sum(new_users) AS new_users,sum(logins) AS logins,sum(voice_minutes) AS voice_minutes,sum(calls) AS calls FROM (
 SELECT date_trunc('day',created_at AT TIME ZONE 'UTC') AS date,count(*) AS new_users,0 AS logins,0::double precision AS voice_minutes,0 AS calls FROM origen_accounts WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
 UNION ALL SELECT date_trunc('day',created_at AT TIME ZONE 'UTC'),0,count(*),0::double precision,0 FROM origen_login_activity WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
 UNION ALL SELECT date_trunc('day',started_at AT TIME ZONE 'UTC'),0,0,sum(seconds)::double precision/60,count(*) FROM origen_voice_activity WHERE started_at >= $1 AND started_at < $2 GROUP BY 1
 ) daily GROUP BY date ORDER BY date`,[window.start,window.end]),
 database.query('SELECT applied_at FROM origen_schema_migrations WHERE name=$1',['017_admin_activity.sql'])
 ]);
 const measuredSince=tracking.rows[0]?.applied_at||null;
 return {totals:{...current.rows[0],users:count.rows[0].users},previous:previous.rows[0],users:users.rows,activity:activity.rows,series:adminSeries(daily.rows,window,measuredSince),window,measuredSince,comparisonReady:!!measuredSince&&Date.parse(measuredSince)<=Date.parse(window.previousStart),generatedAt:window.end};
}

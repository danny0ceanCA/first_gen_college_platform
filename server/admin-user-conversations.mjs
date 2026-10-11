import {historyFilters} from './admin-user-history.mjs';
import {onboardingUUID} from './onboarding-events.mjs';
import {guidanceEnabled} from './guidance-history.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const topics=['profile','planning','finance','admissions','loans'];
const problems=['connection_failure','response_failed','guide_update_failed','lookup_failure','transcription_timeout','spoken_language_update_failed'];
const sqlList=items=>items.map(item=>`'${item}'`).join(','); // Internal allowlists only.
export function conversationFilters(input,now){
 const f=historyFilters({...input,category:'all'},now),{topic='all',language='all',status='all',sessionId,eventPage=1}=input;
 if(!['all',...topics].includes(topic)||!['all','en','es'].includes(language)||!['all','signals','saved','unconfirmed'].includes(status)||sessionId!==undefined&&!onboardingUUID(sessionId)||!Number.isInteger(eventPage)||eventPage<1||eventPage>10000)throw fail(400,'invalid_conversation_filter');
 return {...f,topic,language,status,sessionId,eventPage};
}
// Every relationship binds both account and session. Never attribute records by
// timestamp proximity or equate a logical conversation with a physical call.
export const conversationFactsSQL=`WITH sessions AS (
 SELECT id,account_id,started_at,initial_language,
 CASE WHEN ended_at<$3 THEN ended_at END AS ended_at,
 CASE WHEN ended_at<$3 THEN end_reason END AS end_reason
 FROM origen_guidance_sessions WHERE account_id=$1 AND started_at>=$2 AND started_at<$3
), events AS (
 SELECT e.session_id,e.segment_id,e.producer,e.name,e.received_at,e.payload->>'summaryId' AS summary_id,e.payload->>'language' AS language,e.payload->>'status' AS response_status
 FROM origen_guidance_events e JOIN sessions s ON s.account_id=e.account_id AND s.id=e.session_id WHERE e.received_at<$3
), segments AS (
 SELECT g.id,g.session_id,g.ordinal,g.topic,g.started_at,
 (SELECT min(e.received_at) FROM events e WHERE e.segment_id=g.id AND e.name IN ('voice.connected','guidance.configuration_applied')) AS applied_at
 FROM origen_guidance_segments g JOIN sessions s ON s.account_id=g.account_id AND s.id=g.session_id WHERE g.started_at<$3
), executions AS (
 SELECT x.id,x.session_id,x.segment_id,x.operation,x.started_at,
 CASE WHEN x.finished_at<$3 THEN x.status ELSE 'started' END AS status,
 CASE WHEN x.finished_at<$3 THEN x.finished_at END AS finished_at,
 CASE WHEN x.finished_at<$3 THEN x.duration_ms END AS duration_ms
 FROM origen_ai_executions x JOIN sessions s ON s.account_id=x.account_id AND s.id=x.session_id WHERE x.started_at<$3
), quality AS (
 SELECT q.attempt_id,q.session_id,q.sequence,q.event,q.received_at,q.language,q.mode,q.connection_state
 FROM origen_voice_quality_events q JOIN sessions s ON s.account_id=q.account_id AND s.id=q.session_id WHERE q.received_at<$3
), saved_links AS (
 SELECT DISTINCT ss.summary_id,g.session_id,g.id AS segment_id,ss.language,e.received_at
 FROM origen_summary_segments ss JOIN segments g ON g.id=ss.segment_id
 JOIN origen_conversation_summaries c ON c.account_id=ss.account_id AND c.id=ss.summary_id
 JOIN events e ON e.session_id=g.session_id AND e.producer='server' AND e.name='summary.saved' AND e.summary_id=ss.summary_id
 WHERE ss.account_id=$1 AND c.created_at<$3
), facts AS (
 SELECT s.*,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('topic',g.topic,'applied',g.applied_at IS NOT NULL) ORDER BY g.ordinal) FROM segments g WHERE g.session_id=s.id),'[]'::jsonb) AS guides,
 ARRAY(SELECT DISTINCT language FROM (SELECT s.initial_language AS language UNION ALL SELECT e.language FROM events e WHERE e.session_id=s.id AND e.name='guidance.language_changed' UNION ALL SELECT q.language FROM quality q WHERE q.session_id=s.id AND q.event='spoken_language_changed') l WHERE language IN ('en','es') ORDER BY language) AS languages,
 EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.name='voice.connected') OR EXISTS(SELECT 1 FROM quality q WHERE q.session_id=s.id AND q.event='connection_state' AND q.connection_state='connected') AS connected,
 (SELECT count(DISTINCT summary_id) FROM saved_links l WHERE l.session_id=s.id) AS summaries,
 (SELECT count(*) FROM executions x WHERE x.session_id=s.id AND x.operation='summary' AND x.status='failed') AS generation_failures,
 (SELECT count(*) FROM executions x WHERE x.session_id=s.id AND x.operation='summary' AND x.status='completed') AS generated,
 (SELECT count(*) FROM executions x WHERE x.session_id=s.id AND x.operation NOT IN ('voice','summary')) AS lookups,
 (SELECT count(*) FROM executions x WHERE x.session_id=s.id AND x.status='failed')+
 (SELECT count(*) FROM quality q WHERE q.session_id=s.id AND q.event IN (${sqlList(problems)}))+
 (SELECT count(*) FROM events e WHERE e.session_id=s.id AND (e.name='voice.start_failed' OR (e.name='response.finished' AND e.response_status='failed'))) AS signals,
 (SELECT count(DISTINCT attempt_id) FROM quality q WHERE q.session_id=s.id AND q.event='session_start') AS browser_attempts
 FROM sessions s
), selected AS (SELECT * FROM facts f WHERE
 ($4='all' OR EXISTS(SELECT 1 FROM segments g WHERE g.session_id=f.id AND g.topic=$4))
 AND ($5='all' OR $5=ANY(f.languages))
 AND ($6='all' OR ($6='signals' AND signals>0) OR ($6='saved' AND summaries>0) OR ($6='unconfirmed' AND summaries=0)))`;

const numeric=['summaries','generation_failures','generated','lookups','signals','browser_attempts'];
function presentSession(row){const item={...row};delete item.account_id;for(const key of numeric)item[key]=Number(item[key]);return item;}
const operationLabels={voice:'Voice connection negotiation',summary:'Summary processing',lookup_financial_aid:'Financial aid source lookup',lookup_college_applications:'College source lookup'};
const eventLabels={
 'voice.connected':'Connection reported','guidance.configuration_applied':'Guide update acknowledged','guidance.language_changed':'Spoken language changed','voice.ended':'Conversation end reported','voice.start_failed':'Voice start failed','response.finished':'Response failure reported',
 connection_failure:'Connection problem',response_failed:'Response failed',guide_update_failed:'Guide update failed',lookup_failure:'Source lookup failed',transcription_timeout:'Speech transcription timed out',spoken_language_update_failed:'Language update failed',
 guide_update_complete:'Guide update reported',spoken_language_changed:'Language change reported',session_start:'Browser attempt started',session_cleanup:'Browser resources released',response_cancelled:'Reply interrupted',lookup_cache_hit:'Cached lookup used'
};
const guidanceNames=['voice.connected','guidance.configuration_applied','guidance.language_changed','voice.ended','voice.start_failed','response.finished'];
const qualityNames=[...problems,'guide_update_complete','spoken_language_changed','session_start','session_cleanup','response_cancelled','lookup_cache_hit'];

export async function adminUserConversations(database,input,now=new Date(),env={}){
 const f=conversationFilters(input,now);
 if(!(await database.query('SELECT id FROM origen_accounts WHERE id=$1',[f.id])).rows.length)throw fail(404,'account_not_found');
 const tracking=(await database.query("SELECT name,applied_at FROM origen_schema_migrations WHERE name IN ('015_guidance_history.sql','019_voice_quality.sql')")).rows;
 const dates=Object.fromEntries(tracking.map(row=>[row.name,new Date(row.applied_at).toISOString()]));
 const since=dates['015_guidance_history.sql'],retainedSince=new Date(+now-90*86400000).toISOString();
 const coverage={available:!!since&&Date.parse(since)<Date.parse(f.window.end),enabled:guidanceEnabled(env),measuredSince:since||null,retainedSince,qualitySince:dates['019_voice_quality.sql']||null};
 const base={window:f.window,coverage,page:f.page,pageSize:5,filters:{topic:f.topic,language:f.language,status:f.status}};
 if(!coverage.available)return {...base,sessions:[],total:0};
 const start=new Date(Math.max(Date.parse(f.window.start),Date.parse(since),Date.parse(retainedSince))).toISOString();
 const params=[f.id,start,f.window.end,f.topic,f.language,f.status];
 if(!f.sessionId){
  const [rows,totals]=await Promise.all([
   database.query(`${conversationFactsSQL} SELECT * FROM selected ORDER BY started_at DESC,id DESC LIMIT 5 OFFSET $7`,[...params,(f.page-1)*5]),
   database.query(`${conversationFactsSQL} SELECT count(*) AS sessions,count(*) FILTER(WHERE connected) AS connected,count(*) FILTER(WHERE summaries>0) AS saved,count(*) FILTER(WHERE signals>0) AS signals FROM selected`,params)
  ]);
  const counts=Object.fromEntries(Object.entries(totals.rows[0]).map(([key,value])=>[key,Number(value)]));
  return {...base,total:counts.sessions,counts,sessions:rows.rows.map(presentSession)};
 }
 // A detail must belong to the selected account, window and filters, even when
 // its UUID is otherwise valid. The same cutoff stays fixed across event pages.
 const found=(await database.query(`${conversationFactsSQL} SELECT * FROM selected WHERE id=$7`,[...params,f.sessionId])).rows[0];
 if(!found)throw fail(404,'conversation_not_found');
 const detailParams=[f.id,f.sessionId,f.window.end];
 const eventSQL=`WITH timeline AS (
 SELECT 'g:'||id AS id,name AS kind,received_at,'Browser report'::text AS evidence,payload->>'language' AS language,NULL::text AS topic FROM origen_guidance_events WHERE account_id=$1 AND session_id=$2 AND received_at<$3 AND name IN (${sqlList(guidanceNames)}) AND (name<>'response.finished' OR payload->>'status'='failed')
 UNION ALL SELECT 'q:'||attempt_id||':'||sequence,event,received_at,'Browser report',language,mode FROM origen_voice_quality_events WHERE account_id=$1 AND session_id=$2 AND received_at<$3 AND event IN (${sqlList(qualityNames)})
 )`;
 const [segments,links,operations,operationCount,events,eventCount]=await Promise.all([
  database.query(`${conversationFactsSQL} SELECT ordinal,topic,started_at,applied_at FROM segments WHERE session_id=$7 ORDER BY ordinal LIMIT 100`,[...params,f.sessionId]),
  database.query(`${conversationFactsSQL} SELECT md5(summary_id) AS reference,min(received_at) AS saved_at,array_agg(DISTINCT language ORDER BY language) AS languages,array_agg(DISTINCT g.ordinal ORDER BY g.ordinal) AS segments FROM saved_links l JOIN segments g ON g.id=l.segment_id WHERE l.session_id=$7 GROUP BY summary_id ORDER BY saved_at,reference LIMIT 101`,[...params,f.sessionId]),
  database.query(`SELECT x.id,x.operation,x.started_at,CASE WHEN x.finished_at<$3 THEN x.status ELSE 'started' END AS status,CASE WHEN x.finished_at<$3 THEN x.duration_ms END AS duration_ms,CASE WHEN x.finished_at<$3 THEN x.finished_at END AS finished_at,CASE WHEN x.finished_at<$3 THEN t.source_count END AS source_count,g.ordinal
   FROM origen_ai_executions x JOIN origen_guidance_segments g ON g.account_id=x.account_id AND g.session_id=x.session_id AND g.id=x.segment_id LEFT JOIN origen_tool_calls t ON t.account_id=x.account_id AND t.execution_id=x.id WHERE x.account_id=$1 AND x.session_id=$2 AND x.started_at<$3 ORDER BY x.started_at DESC,x.id DESC LIMIT 50`,detailParams),
  database.query('SELECT count(*) AS count FROM origen_ai_executions WHERE account_id=$1 AND session_id=$2 AND started_at<$3',detailParams),
  database.query(`${eventSQL} SELECT * FROM timeline ORDER BY received_at DESC,id DESC LIMIT 30 OFFSET $4`,[...detailParams,(f.eventPage-1)*30]),
  database.query(`${eventSQL} SELECT count(*) AS count FROM timeline`,detailParams)
 ]);
 return {...base,session:presentSession(found),segments:segments.rows,summaries:links.rows.slice(0,100),summariesTruncated:links.rows.length>100,
  operations:operations.rows.map(row=>({...row,operation:operationLabels[row.operation]||'Source lookup',duration_ms:row.duration_ms===null?null:Number(row.duration_ms),source_count:row.source_count===null?null:Number(row.source_count)})),operationsTotal:Number(operationCount.rows[0].count),
  events:events.rows.map(row=>({id:row.id,title:eventLabels[row.kind],recordedAt:row.received_at,evidence:row.evidence,language:['en','es'].includes(row.language)?row.language:null,topic:topics.includes(row.topic)?row.topic:null,problem:problems.includes(row.kind)||['voice.start_failed','response.finished'].includes(row.kind)})),eventTotal:Number(eventCount.rows[0].count),eventPage:f.eventPage,eventPageSize:30};
}

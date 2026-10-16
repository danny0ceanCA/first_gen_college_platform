import {assertFreshStore} from '../observability/store.mjs';
export function createAuthority({application,control,telemetry,ledger}){
 return {
  async fresh(){const health=await assertFreshStore(telemetry,ledger);const scope=(await control.query('SELECT support_environment() AS environment')).rows[0]?.environment;if(!scope||scope!==health.environment)throw new Error('support_unavailable');return health;},
  async scope(caseId,actor,iat,register=false){const scope=(await application.query('SELECT origen_support_scope($1,$2,$3,$4) AS scope',[caseId,actor,iat,register])).rows[0]?.scope;return scope?{...scope,start:new Date(scope.start).toISOString(),end:new Date(scope.end).toISOString(),expiresAt:new Date(scope.expiresAt).toISOString()}:null;},
  async register(cap,scope){await control.query('SELECT support_register($1,$2,$3,$4,$5,$6,$7)',[cap.id,cap.caseId,cap.scope,cap.actor,cap.recipient,scope.operations,new Date(cap.exp*1000)]);},
  async authorized(cap){return (await control.query('SELECT support_authorized($1,$2,$3) AS ok',[cap.id,cap.scope,cap.recipient])).rows[0]?.ok===true;},
  async revoke(cap){await control.query('SELECT support_revoke($1,$2)',[cap.id,cap.recipient]);},
  async audit(caseId,actor,action,outcome){await control.query('SELECT support_audit($1,$2,$3,$4)',[caseId,actor,action,outcome]);},
 };
}
export function createEvidenceReader(pool){
 return async(scope,{query}={})=>{
  const c=await pool.connect();try{
   await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='2s'");
   // No arbitrary SQL, raw table, global recent feed, email or student lookup.
   const args=[scope.environment,query?.kind==='timeline'?[query.operationId]:scope.operations,scope.start,scope.end];let extra='';
   if(query?.kind==='request'){args.push(query.requestId);extra+=' AND request_id=$5';}
   if(query?.after){args.push(query.after.receivedAt,query.after.eventId);extra+=' AND (received_at,event_id)>($5,$6)';}
   const events=query?.kind==='metrics'?[]:(await c.query(`SELECT event_id,received_at,event_time,release,event,level,producer,evidence,operation_id,request_id,attributes FROM telemetry_events_live WHERE environment=$1 AND operation_id=ANY($2::uuid[]) AND event_time>=$3 AND event_time<=$4 ${extra} ORDER BY received_at,event_id LIMIT ${query?.kind==='incident'?'2':'201'}`,args)).rows;
   const metricArgs=[scope.environment,scope.start,scope.end];if(query?.kind==='metrics')metricArgs.push(query.metricSet);
   const metrics=query&&query.kind!=='metrics'?[]:(await c.query(`SELECT * FROM telemetry_metrics_live WHERE environment=$1 AND hour>=date_trunc('hour',$2::timestamptz) AND hour<=date_trunc('hour',$3::timestamptz) ${query?.kind==='metrics'?'AND family=$4':''} ORDER BY hour,family,operation,outcome LIMIT 201`,metricArgs)).rows;
   let next=null;if(query?.kind==='timeline'&&events.length>200){const last=events[199];const row=(await c.query(`SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time FROM telemetry_events_live WHERE environment=$1 AND event_id=$2 AND operation_id=$3 LIMIT 1`,[scope.environment,last.event_id,query.operationId])).rows[0];next={eventId:last.event_id,receivedAt:row.time};}
   const limit=query?.kind==='incident'?1:200;await c.query('COMMIT');return {events:events.slice(0,limit),metrics:metrics.slice(0,200),truncated:events.length>limit||metrics.length>200,next};
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
 };
}

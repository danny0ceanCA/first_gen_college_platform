import {uuid} from '../../server/observability/wire.mjs';
export async function assertFreshStore(pool,ledger){
 const [local,remote]=await Promise.all([pool.query('SELECT * FROM telemetry_health'),ledger.query('SELECT ledger_generation() AS generation')]);
 const health=local.rows[0];if(!health?.ready||String(health.ledger_generation)!==String(remote.rows[0]?.generation))throw new Error('telemetry_unavailable');return health;
}
export async function readEvents(pool,ledger,{kind,reference,environment,before}={}){
 if(!['recent','operation','request'].includes(kind)||kind!=='recent'&&!uuid(reference)||!['production','staging','test','development'].includes(environment)||before&&(!uuid(before.eventId)||!Number.isFinite(Date.parse(before.receivedAt))))throw new Error('invalid_telemetry_query');
 await assertFreshStore(pool,ledger);const client=await pool.connect();let rows;
 try{await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='2s'");const columns={operation:'operation_id',request:'request_id'};
  const params=[environment];let where='environment=$1';if(kind!=='recent'){params.push(reference);where+=` AND ${columns[kind]}=$${params.length}`;}
  if(before){params.push(before.receivedAt,before.eventId);where+=` AND (received_at,event_id)<($${params.length-1},$${params.length})`;}
  rows=(await client.query(`SELECT *,to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM telemetry_events_live WHERE ${where} ORDER BY received_at DESC,event_id DESC LIMIT 200`,params)).rows;await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 await assertFreshStore(pool,ledger);return {events:rows,coverage:'best_effort',missingOutcomes:'unknown',next:rows.length===200?{receivedAt:rows.at(-1).cursor_time,eventId:rows.at(-1).event_id}:null};
}
export async function readMetrics(pool,ledger,{environment,hour}={}){
 if(!['production','staging','test','development'].includes(environment)||!Number.isFinite(Date.parse(hour)))throw new Error('invalid_telemetry_query');await assertFreshStore(pool,ledger);
 const rows=(await pool.query('SELECT * FROM telemetry_metrics_live WHERE environment=$1 AND hour=$2 ORDER BY family,operation,outcome LIMIT 200',[environment,hour])).rows;await assertFreshStore(pool,ledger);return {metrics:rows,missingIntervals:'unknown'};
}

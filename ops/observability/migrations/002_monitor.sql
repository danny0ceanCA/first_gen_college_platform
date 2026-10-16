-- Independent monitor receives aggregates only, never event bodies or account/operation references.
CREATE FUNCTION telemetry_monitor_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 WITH recent AS MATERIALIZED (
  SELECT service,release,instance_id,event,attributes,received_at FROM telemetry_events_live
  WHERE received_at>now()-interval '10 minutes' AND evidence='server_observed'
 ), releases AS (SELECT service,release,max(received_at) last_seen FROM recent GROUP BY service,release ORDER BY max(received_at) DESC LIMIT 32),
 supervisors AS (SELECT DISTINCT ON(service,release,instance_id) * FROM recent WHERE event='permission.supervisor.finished' ORDER BY service,release,instance_id,received_at DESC),
 attempts AS (SELECT *,row_number() OVER(PARTITION BY service,release,instance_id ORDER BY received_at DESC) n FROM recent WHERE event='permission.supervisor.finished')
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'service',r.service,'release',r.release,'coverage','best_effort',
 'apiRequests',(SELECT count(*) FROM recent e WHERE e.service=r.service AND e.release=r.release AND e.event='api_request' AND e.received_at>now()-interval '5 minutes'),
 'apiErrors',(SELECT count(*) FROM recent e WHERE e.service=r.service AND e.release=r.release AND e.event='api_request' AND e.received_at>now()-interval '5 minutes' AND (e.attributes->>'httpStatus')::int>=500),
 'summaryFailures',(SELECT count(*) FROM recent e WHERE e.service=r.service AND e.release=r.release AND e.event='summary.save.finished' AND e.attributes->>'outcome'='failed'),
 'hangupOldestMs',(SELECT COALESCE(max((attributes->>'oldestMs')::bigint+greatest(0,extract(epoch FROM now()-received_at)*1000)),0) FROM supervisors e WHERE e.service=r.service AND e.release=r.release AND (attributes->>'backlog')::bigint>0),
 'supervisorFailures',CASE WHEN EXISTS(SELECT 1 FROM attempts e WHERE e.service=r.service AND e.release=r.release AND n<=3 GROUP BY instance_id HAVING count(*)=3 AND bool_and(attributes->>'outcome'='failed')) THEN 3 ELSE 0 END
 )), '[]'::jsonb) FROM releases r
$$;
REVOKE ALL ON FUNCTION telemetry_monitor_snapshot() FROM PUBLIC;

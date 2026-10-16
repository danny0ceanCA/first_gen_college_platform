REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE telemetry_contract(event text NOT NULL,producer text NOT NULL,rules jsonb NOT NULL,required text[] NOT NULL,PRIMARY KEY(event,producer));
CREATE TABLE telemetry_scopes(role_name name PRIMARY KEY,environment text NOT NULL CHECK(environment IN ('production','staging','test','development')));
CREATE TABLE telemetry_control(id boolean PRIMARY KEY DEFAULT true CHECK(id),verified_start timestamptz,ledger_generation bigint NOT NULL DEFAULT -1,last_expiry_at timestamptz,last_ingest_at timestamptz);
INSERT INTO telemetry_control(id) VALUES(true);
CREATE TABLE telemetry_erased(environment text NOT NULL,kind text NOT NULL CHECK(kind IN ('operation','request','trace')),reference text NOT NULL,expires_at timestamptz NOT NULL,purged boolean NOT NULL DEFAULT false,PRIMARY KEY(environment,kind,reference));
CREATE TABLE telemetry_event_dedupe(event_id uuid PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE INDEX telemetry_dedupe_expiry ON telemetry_event_dedupe(expires_at);
CREATE TABLE telemetry_events(
 event_id uuid NOT NULL,received_at timestamptz NOT NULL,event_time timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 service text NOT NULL,environment text NOT NULL,release text NOT NULL,instance_id uuid NOT NULL,event text NOT NULL,level text NOT NULL,producer text NOT NULL,evidence text NOT NULL,
 operation_id uuid,request_id uuid,trace_id text,attributes jsonb NOT NULL CHECK(jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=4096),
 PRIMARY KEY(received_at,event_id)
) PARTITION BY RANGE(received_at);
CREATE INDEX telemetry_events_service ON telemetry_events(environment,service,received_at DESC);
CREATE INDEX telemetry_events_event ON telemetry_events(environment,event,received_at DESC);
CREATE INDEX telemetry_events_operation ON telemetry_events(environment,operation_id,received_at DESC);
CREATE INDEX telemetry_events_request ON telemetry_events(environment,request_id,received_at DESC);
CREATE INDEX telemetry_events_trace ON telemetry_events(environment,trace_id,received_at DESC);
CREATE INDEX telemetry_events_expiry ON telemetry_events(expires_at);
CREATE TABLE telemetry_partitions(name text PRIMARY KEY,ends_at timestamptz NOT NULL);
CREATE TABLE telemetry_rate(role_name name NOT NULL,minute timestamptz NOT NULL,count integer NOT NULL,PRIMARY KEY(role_name,minute));
CREATE TABLE telemetry_metric_intervals(
 instance_id uuid NOT NULL,sequence bigint NOT NULL,metric_key text NOT NULL,interval_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 environment text NOT NULL,service text NOT NULL,family text NOT NULL,operation text NOT NULL,outcome text NOT NULL,count bigint NOT NULL,sum_ms double precision NOT NULL,buckets bigint[] NOT NULL,coverage text NOT NULL,rolled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(instance_id,sequence,metric_key,interval_at)
);
CREATE TABLE telemetry_boot_progress(instance_id uuid PRIMARY KEY,environment text NOT NULL,last_sequence bigint NOT NULL,has_gap boolean NOT NULL DEFAULT false,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE telemetry_hourly_metrics(environment text NOT NULL,service text NOT NULL,family text NOT NULL,operation text NOT NULL,outcome text NOT NULL,hour timestamptz NOT NULL,count bigint NOT NULL,sum_ms double precision NOT NULL,buckets bigint[] NOT NULL,coverage text NOT NULL,PRIMARY KEY(environment,service,family,operation,outcome,hour));

CREATE FUNCTION telemetry_valid(value jsonb,contract_event text,contract_producer text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE policy telemetry_contract%ROWTYPE; k text; v jsonb; rule jsonb;
BEGIN
 SELECT * INTO policy FROM telemetry_contract WHERE event=contract_event AND producer=contract_producer;
 IF NOT FOUND OR jsonb_typeof(value)<>'object' OR octet_length(value::text)>8192 THEN RETURN false;END IF;
 FOREACH k IN ARRAY policy.required LOOP IF NOT value?k THEN RETURN false;END IF;END LOOP;
 FOR k,v IN SELECT * FROM jsonb_each(value) LOOP
  rule=policy.rules->k;IF rule IS NULL THEN RETURN false;END IF;
  CASE rule->>'kind'
   WHEN 'enum' THEN IF jsonb_typeof(v)<>'string' OR NOT((rule->'values')?(v#>>'{}')) THEN RETURN false;END IF;
   WHEN 'uuid' THEN IF jsonb_typeof(v)<>'string' OR (v#>>'{}')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN false;END IF;
   WHEN 'hex' THEN IF jsonb_typeof(v)<>'string' OR (v#>>'{}')!~(rule->>'pattern') THEN RETURN false;END IF;
   WHEN 'time' THEN IF jsonb_typeof(v)<>'string' OR (v#>>'{}')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN RETURN false;END IF;PERFORM (v#>>'{}')::timestamptz;
   WHEN 'number' THEN IF jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<0 OR (v#>>'{}')::numeric>(rule->>'max')::numeric OR COALESCE((rule->>'integer')::boolean,false) AND trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric THEN RETURN false;END IF;
   WHEN 'histogram' THEN IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v) NOT IN(7,11) OR EXISTS(SELECT 1 FROM jsonb_array_elements(v) n WHERE jsonb_typeof(n)<>'number' OR (n#>>'{}')::numeric<0 OR (n#>>'{}')::numeric>10000000 OR trunc((n#>>'{}')::numeric)<>(n#>>'{}')::numeric) THEN RETURN false;END IF;
   ELSE RETURN false;
  END CASE;
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION telemetry_ingest(batch jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; scope text; at timestamptz=clock_timestamp(); inserted integer=0; n integer; refs record; attrs jsonb; metric_key text;
BEGIN
 SELECT environment INTO scope FROM telemetry_scopes WHERE role_name=session_user;
 IF scope IS NULL OR NOT EXISTS(SELECT 1 FROM telemetry_control WHERE verified_start=pg_postmaster_start_time()) THEN RAISE EXCEPTION 'telemetry_unavailable';END IF;
 IF batch->>'schemaVersion'<>'1' OR jsonb_typeof(batch->'events')<>'array' OR jsonb_typeof(batch->'metrics')<>'array' OR (SELECT count(*) FROM jsonb_object_keys(batch))<>3 OR octet_length(batch::text)>262144 THEN RAISE EXCEPTION 'invalid_batch';END IF;
 n=jsonb_array_length(batch->'events')+jsonb_array_length(batch->'metrics');IF n<1 OR n>100 THEN RAISE EXCEPTION 'invalid_batch';END IF;
 INSERT INTO telemetry_rate(role_name,minute,count) VALUES(session_user,date_trunc('minute',at),n) ON CONFLICT(role_name,minute) DO UPDATE SET count=telemetry_rate.count+EXCLUDED.count;
 IF (SELECT count FROM telemetry_rate WHERE role_name=session_user AND minute=date_trunc('minute',at))>3000 THEN RAISE EXCEPTION 'telemetry_rate_limited';END IF;
 FOR refs IN SELECT DISTINCT v.kind,v.reference FROM jsonb_array_elements(batch->'events') e CROSS JOIN LATERAL (VALUES('operation',e->>'operationId'),('request',e->>'requestId'),('trace',e->>'traceId')) v(kind,reference) WHERE reference IS NOT NULL ORDER BY kind,reference LOOP PERFORM pg_advisory_xact_lock(hashtextextended(scope||refs.kind||refs.reference,728421));END LOOP;
 FOR r IN SELECT * FROM jsonb_array_elements(batch->'events') LOOP
  IF r->>'schemaVersion'<>'1' OR NOT telemetry_valid(r,r->>'event',r->>'producer') OR r->>'environment'<>scope OR (r->>'time')::timestamptz<at-interval '10 minutes' OR (r->>'time')::timestamptz>at+interval '1 minute' THEN RAISE EXCEPTION 'invalid_event';END IF;
  IF EXISTS(SELECT 1 FROM telemetry_erased e WHERE e.environment=scope AND e.expires_at>at AND (e.kind='operation' AND e.reference=r->>'operationId' OR e.kind='request' AND e.reference=r->>'requestId' OR e.kind='trace' AND e.reference=r->>'traceId')) THEN CONTINUE;END IF;
  INSERT INTO telemetry_event_dedupe(event_id,expires_at) VALUES((r->>'eventId')::uuid,at+interval '360 hours') ON CONFLICT DO NOTHING;IF NOT FOUND THEN CONTINUE;END IF;
  attrs=r-ARRAY['schemaVersion','eventId','time','service','environment','release','instanceId','event','level','producer','evidence','operationId','requestId','traceId'];
  INSERT INTO telemetry_events VALUES((r->>'eventId')::uuid,at,(r->>'time')::timestamptz,LEAST(at,(r->>'time')::timestamptz)+CASE WHEN r->>'event' IN('dependency.started','dependency.span.finished') THEN interval '168 hours' ELSE interval '336 hours' END,r->>'service',scope,r->>'release',(r->>'instanceId')::uuid,r->>'event',r->>'level',r->>'producer',r->>'evidence',(r->>'operationId')::uuid,(r->>'requestId')::uuid,r->>'traceId',attrs);inserted=inserted+1;
 END LOOP;
 FOR r IN SELECT * FROM jsonb_array_elements(batch->'metrics') LOOP
  IF r->>'schemaVersion'<>'1' OR NOT telemetry_valid(r,'__metric__','server') OR r->>'environment'<>scope OR (r->>'interval')::timestamptz<at-interval '10 minutes' OR (r->>'interval')::timestamptz>at OR date_trunc('minute',(r->>'interval')::timestamptz)<>(r->>'interval')::timestamptz OR jsonb_array_length(r->'buckets')<>(CASE WHEN r->>'family'='provider' THEN 7 ELSE 11 END) OR (SELECT sum((v#>>'{}')::bigint) FROM jsonb_array_elements(r->'buckets') v)<>(r->>'count')::bigint THEN RAISE EXCEPTION 'invalid_metric';END IF;
  metric_key=concat_ws(':',r->>'family',r->>'operation',r->>'outcome');
  INSERT INTO telemetry_metric_intervals(instance_id,sequence,metric_key,interval_at,environment,service,family,operation,outcome,count,sum_ms,buckets,coverage) VALUES((r->>'instanceId')::uuid,(r->>'sequence')::bigint,metric_key,(r->>'interval')::timestamptz,scope,r->>'service',r->>'family',r->>'operation',r->>'outcome',(r->>'count')::bigint,(r->>'sumMs')::double precision,ARRAY(SELECT (v#>>'{}')::bigint FROM jsonb_array_elements(r->'buckets') v),r->>'coverage') ON CONFLICT DO NOTHING;
  IF FOUND THEN INSERT INTO telemetry_boot_progress(instance_id,environment,last_sequence,has_gap) VALUES((r->>'instanceId')::uuid,scope,(r->>'sequence')::bigint,(r->>'sequence')::bigint<>1) ON CONFLICT(instance_id) DO UPDATE SET has_gap=telemetry_boot_progress.has_gap OR EXCLUDED.last_sequence>telemetry_boot_progress.last_sequence+1,last_sequence=GREATEST(telemetry_boot_progress.last_sequence,EXCLUDED.last_sequence),received_at=at;END IF;
 END LOOP;
 UPDATE telemetry_control SET last_ingest_at=at;RETURN inserted;
END $$;

CREATE FUNCTION telemetry_purge_erased() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r telemetry_erased%ROWTYPE;n integer=0;affected integer;
BEGIN
 FOR r IN SELECT * FROM telemetry_erased WHERE NOT purged AND expires_at>now() LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
  DELETE FROM telemetry_events WHERE (tableoid,ctid) IN(SELECT tableoid,ctid FROM telemetry_events WHERE environment=r.environment AND (operation_id=CASE WHEN r.kind='operation' THEN r.reference::uuid END OR request_id=CASE WHEN r.kind='request' THEN r.reference::uuid END OR trace_id=CASE WHEN r.kind='trace' THEN r.reference END) LIMIT LEAST(1000,10000-n));GET DIAGNOSTICS affected=ROW_COUNT;n=n+affected;
  UPDATE telemetry_erased SET purged=NOT EXISTS(SELECT 1 FROM telemetry_events WHERE environment=r.environment AND (operation_id=CASE WHEN r.kind='operation' THEN r.reference::uuid END OR request_id=CASE WHEN r.kind='request' THEN r.reference::uuid END OR trace_id=CASE WHEN r.kind='trace' THEN r.reference END)) WHERE environment=r.environment AND kind=r.kind AND reference=r.reference;
  EXIT WHEN n>=10000;
 END LOOP;RETURN n;
END $$;
CREATE FUNCTION telemetry_erase(refs jsonb,generation bigint) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; n integer=0; affected integer;
BEGIN
 IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)>200 THEN RAISE EXCEPTION 'invalid_erasure';END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(refs) ORDER BY value->>'kind',value->>'reference' LOOP
  IF r->>'environment' NOT IN('production','staging','test','development') OR r->>'kind' NOT IN('operation','request','trace') OR (r->>'reference')!~(CASE WHEN r->>'kind'='trace' THEN '^[a-f0-9]{32}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END) OR (r->>'expiresAt')::timestamptz>now()+interval '721 hours' THEN RAISE EXCEPTION 'invalid_erasure';END IF;
  IF (r->>'expiresAt')::timestamptz<=now() THEN CONTINUE;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended((r->>'environment')||(r->>'kind')||(r->>'reference'),728421));
  INSERT INTO telemetry_erased(environment,kind,reference,expires_at) VALUES(r->>'environment',r->>'kind',r->>'reference',(r->>'expiresAt')::timestamptz) ON CONFLICT(environment,kind,reference) DO UPDATE SET expires_at=GREATEST(telemetry_erased.expires_at,EXCLUDED.expires_at),purged=false;
 END LOOP;RETURN telemetry_purge_erased();
END $$;
CREATE FUNCTION telemetry_ready(generation bigint) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ UPDATE telemetry_control SET verified_start=pg_postmaster_start_time(),ledger_generation=GREATEST(ledger_generation,generation) $$;
CREATE FUNCTION telemetry_block() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ UPDATE telemetry_control SET verified_start=NULL $$;
CREATE FUNCTION telemetry_add_hist(a bigint[],b bigint[]) RETURNS bigint[] LANGUAGE sql IMMUTABLE AS $$ SELECT array_agg(COALESCE(a[i],0)+COALESCE(b[i],0) ORDER BY i) FROM generate_series(1,GREATEST(cardinality(a),cardinality(b))) i $$;
CREATE FUNCTION telemetry_maintain() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d date; part text; old record; r telemetry_metric_intervals%ROWTYPE; n integer=0; unknown boolean;
BEGIN
 IF NOT pg_try_advisory_xact_lock(728422,1) THEN RETURN -1;END IF;
 FOR d IN SELECT (now() AT TIME ZONE 'UTC')::date+i FROM generate_series(0,1) i LOOP
  part='telemetry_events_'||to_char(d,'YYYYMMDD');
  IF NOT EXISTS(SELECT 1 FROM telemetry_partitions WHERE name=part) THEN EXECUTE format('CREATE TABLE public.%I PARTITION OF public.telemetry_events FOR VALUES FROM (%L) TO (%L)',part,d::text||'T00:00:00Z',(d+1)::text||'T00:00:00Z');INSERT INTO telemetry_partitions VALUES(part,((d+1)::text||'T00:00:00Z')::timestamptz);END IF;
 END LOOP;
 FOR old IN SELECT * FROM telemetry_partitions WHERE ends_at+interval '336 hours'<=now() LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I',old.name);DELETE FROM telemetry_partitions WHERE name=old.name;END LOOP;
 DELETE FROM telemetry_events WHERE (tableoid,ctid) IN(SELECT tableoid,ctid FROM telemetry_events WHERE expires_at<=now() LIMIT 10000);
 PERFORM telemetry_purge_erased();
 DELETE FROM telemetry_event_dedupe WHERE event_id IN(SELECT event_id FROM telemetry_event_dedupe WHERE expires_at<=now() LIMIT 10000);
 DELETE FROM telemetry_erased WHERE (environment,kind,reference) IN(SELECT environment,kind,reference FROM telemetry_erased WHERE expires_at<=now() LIMIT 10000);DELETE FROM telemetry_rate WHERE (role_name,minute) IN(SELECT role_name,minute FROM telemetry_rate WHERE minute<now()-interval '1 hour' LIMIT 10000);
 FOR r IN SELECT * FROM telemetry_metric_intervals WHERE NOT rolled ORDER BY received_at LIMIT 10000 FOR UPDATE LOOP
  SELECT has_gap INTO unknown FROM telemetry_boot_progress WHERE instance_id=r.instance_id;
  INSERT INTO telemetry_hourly_metrics VALUES(r.environment,r.service,r.family,r.operation,r.outcome,date_trunc('hour',r.interval_at),r.count,r.sum_ms,r.buckets,CASE WHEN r.coverage='partial' OR COALESCE(unknown,true) THEN 'unknown' ELSE 'observed' END)
  ON CONFLICT(environment,service,family,operation,outcome,hour) DO UPDATE SET count=telemetry_hourly_metrics.count+EXCLUDED.count,sum_ms=telemetry_hourly_metrics.sum_ms+EXCLUDED.sum_ms,buckets=telemetry_add_hist(telemetry_hourly_metrics.buckets,EXCLUDED.buckets),coverage=CASE WHEN telemetry_hourly_metrics.coverage='unknown' OR EXCLUDED.coverage='unknown' THEN 'unknown' ELSE 'observed' END;
  UPDATE telemetry_metric_intervals SET rolled=true WHERE instance_id=r.instance_id AND sequence=r.sequence AND metric_key=r.metric_key AND interval_at=r.interval_at;n=n+1;
 END LOOP;
 DELETE FROM telemetry_metric_intervals WHERE (instance_id,sequence,metric_key,interval_at) IN(SELECT instance_id,sequence,metric_key,interval_at FROM telemetry_metric_intervals WHERE received_at<=now()-interval '24 hours' LIMIT 10000);DELETE FROM telemetry_boot_progress WHERE instance_id IN(SELECT instance_id FROM telemetry_boot_progress WHERE received_at<=now()-interval '24 hours' LIMIT 10000);DELETE FROM telemetry_hourly_metrics WHERE (environment,service,family,operation,outcome,hour) IN(SELECT environment,service,family,operation,outcome,hour FROM telemetry_hourly_metrics WHERE hour<=now()-interval '90 days' LIMIT 10000);UPDATE telemetry_control SET last_expiry_at=clock_timestamp();RETURN n;
END $$;

CREATE VIEW telemetry_events_live WITH(security_barrier=true) AS SELECT e.* FROM telemetry_events e WHERE e.environment=(SELECT environment FROM telemetry_scopes WHERE role_name=session_user) AND e.expires_at>now() AND EXISTS(SELECT 1 FROM telemetry_control WHERE verified_start=pg_postmaster_start_time()) AND NOT EXISTS(SELECT 1 FROM telemetry_erased x WHERE x.environment=e.environment AND x.expires_at>now() AND (x.kind='operation' AND x.reference=e.operation_id::text OR x.kind='request' AND x.reference=e.request_id::text OR x.kind='trace' AND x.reference=e.trace_id));
CREATE VIEW telemetry_metrics_live WITH(security_barrier=true) AS SELECT m.* FROM telemetry_hourly_metrics m WHERE m.environment=(SELECT environment FROM telemetry_scopes WHERE role_name=session_user) AND m.hour>now()-interval '90 days' AND EXISTS(SELECT 1 FROM telemetry_control WHERE verified_start=pg_postmaster_start_time());
CREATE VIEW telemetry_health WITH(security_barrier=true) AS SELECT (SELECT environment FROM telemetry_scopes WHERE role_name=session_user) AS environment,c.ledger_generation,c.verified_start=pg_postmaster_start_time() AS ready,c.last_expiry_at,c.last_ingest_at,(SELECT count(*) FROM telemetry_erased WHERE NOT purged) AS erasure_pending,(SELECT min(expires_at)-interval '720 hours' FROM telemetry_erased WHERE NOT purged) AS oldest_erasure_at,(SELECT max(received_at) FROM telemetry_events_live WHERE event='telemetry.canary') AS last_canary_at FROM telemetry_control c;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION telemetry_valid(jsonb,text,text),telemetry_ingest(jsonb),telemetry_purge_erased(),telemetry_erase(jsonb,bigint),telemetry_ready(bigint),telemetry_block(),telemetry_add_hist(bigint[],bigint[]),telemetry_maintain() FROM PUBLIC;

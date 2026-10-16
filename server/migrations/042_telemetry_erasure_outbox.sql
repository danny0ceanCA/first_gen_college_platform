ALTER TABLE origen_diagnostic_operations ADD CONSTRAINT diagnostic_operation_owner UNIQUE(operation_id,account_id);
CREATE TABLE origen_diagnostic_request_refs(
 request_id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(operation_id,account_id) REFERENCES origen_diagnostic_operations(operation_id,account_id) ON DELETE CASCADE
);
CREATE INDEX diagnostic_request_owner ON origen_diagnostic_request_refs(account_id);
ALTER TABLE origen_diagnostic_request_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY diagnostic_request_owner ON origen_diagnostic_request_refs FOR SELECT USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY diagnostic_request_insert ON origen_diagnostic_request_refs FOR INSERT WITH CHECK(account_id=(SELECT origen_current_account_id()));
CREATE TABLE origen_telemetry_erasure_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('operation','request','trace')),reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '720 hours',delivered_at timestamptz,
 UNIQUE(kind,reference),CHECK(reference~CASE WHEN kind='trace' THEN '^[a-f0-9]{32}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END)
);
CREATE INDEX telemetry_erasure_pending ON origen_telemetry_erasure_outbox(created_at) WHERE delivered_at IS NULL;
ALTER TABLE origen_telemetry_erasure_outbox ENABLE ROW LEVEL SECURITY;
-- No HTTP or maintenance table policy. Only the trigger/worker routines below.
CREATE FUNCTION origen_capture_telemetry_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 INSERT INTO origen_telemetry_erasure_outbox(kind,reference) VALUES('operation',OLD.operation_id::text),('trace',OLD.trace_id) ON CONFLICT DO NOTHING;
 INSERT INTO origen_telemetry_erasure_outbox(kind,reference) SELECT 'request',request_id::text FROM origen_diagnostic_request_refs WHERE operation_id=OLD.operation_id ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
CREATE TRIGGER diagnostic_erasure_before_delete BEFORE DELETE ON origen_diagnostic_operations FOR EACH ROW EXECUTE FUNCTION origen_capture_telemetry_erasure();
CREATE FUNCTION origen_capture_request_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO origen_telemetry_erasure_outbox(kind,reference) VALUES('request',OLD.request_id::text) ON CONFLICT DO NOTHING;RETURN OLD;END $$;
CREATE TRIGGER diagnostic_request_erasure_before_delete BEFORE DELETE ON origen_diagnostic_request_refs FOR EACH ROW EXECUTE FUNCTION origen_capture_request_erasure();
CREATE FUNCTION origen_telemetry_outbox_batch() RETURNS TABLE(id uuid,kind text,reference text) LANGUAGE sql SECURITY DEFINER AS $$ SELECT id,kind,reference FROM origen_telemetry_erasure_outbox WHERE delivered_at IS NULL ORDER BY created_at,id LIMIT 200 $$;
CREATE FUNCTION origen_telemetry_outbox_ack(ids uuid[]) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE origen_telemetry_erasure_outbox SET delivered_at=now() WHERE id=ANY(ids) AND delivered_at IS NULL AND cardinality(ids)<=200 $$;
CREATE FUNCTION origen_telemetry_outbox_expire() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM origen_telemetry_erasure_outbox WHERE expires_at<=now() $$;
CREATE FUNCTION origen_telemetry_outbox_health() RETURNS TABLE(pending bigint,oldest timestamptz) LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*),min(created_at) FROM origen_telemetry_erasure_outbox WHERE delivered_at IS NULL $$;
DO $$ DECLARE s text=current_schema(); f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_capture_telemetry_erasure()','origen_capture_request_erasure()','origen_telemetry_outbox_batch()','origen_telemetry_outbox_ack(uuid[])','origen_telemetry_outbox_expire()','origen_telemetry_outbox_health()'] LOOP
  EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog,%I',s,f,s);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',s,f);
 END LOOP;
END $$;
REVOKE ALL ON origen_telemetry_erasure_outbox,origen_diagnostic_request_refs FROM PUBLIC;

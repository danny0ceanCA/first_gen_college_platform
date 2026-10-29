-- Administrative experiments only. No student data, audio or raw transcript storage.
CREATE TABLE origen_admin_voice_runs (
 id uuid PRIMARY KEY,
 owner_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=250000)
);
ALTER TABLE origen_admin_voice_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_admin_voice_runs FROM PUBLIC;
CREATE INDEX ON origen_admin_voice_runs(owner_hash,created_at DESC);
CREATE FUNCTION origen_admin_voice_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject_hash',true),''); result jsonb; run_id uuid;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'analytics' THEN RAISE EXCEPTION 'admin_context_required' USING ERRCODE='42501'; END IF;
 IF input->>'action'='list' THEN
  SELECT coalesce(jsonb_agg(data || jsonb_build_object('id',id,'createdAt',created_at) ORDER BY created_at DESC),'[]') INTO result FROM (SELECT * FROM origen_admin_voice_runs WHERE owner_hash=actor ORDER BY created_at DESC LIMIT 40) r;
  RETURN result;
 END IF;
 run_id:=(input->>'id')::uuid;
 IF input->>'action'='get' THEN
  SELECT data || jsonb_build_object('id',id,'createdAt',created_at) INTO result FROM origen_admin_voice_runs WHERE id=run_id AND owner_hash=actor; RETURN result;
 END IF;
 IF input->>'action'='create' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_voice:'||actor,0));
  IF EXISTS(SELECT 1 FROM origen_admin_voice_runs WHERE owner_hash=actor AND data->>'status' IN ('starting','active','stopping') AND created_at>now()-interval '7 minutes') THEN RAISE EXCEPTION 'voice_already_active' USING ERRCODE='40001'; END IF;
  INSERT INTO origen_admin_voice_runs(id,owner_hash,data) VALUES(run_id,actor,input->'data');
 ELSIF input->>'action'='update' THEN
  UPDATE origen_admin_voice_runs SET data=input->'data',updated_at=now() WHERE id=run_id AND owner_hash=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'invalid_voice_action' USING ERRCODE='22023'; END IF;
 RETURN input->'data';
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_admin_voice_command(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_admin_voice_command(jsonb) FROM PUBLIC;

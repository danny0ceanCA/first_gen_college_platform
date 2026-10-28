-- Teaching access metadata only: no student, family, session, query or prompt text.
CREATE TABLE origen_teaching_access (
 id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 operation text NOT NULL CHECK(operation IN ('voice_start','voice_update','finance_lookup','admissions_lookup')),
 topic text NOT NULL CHECK(topic IN ('general','profile','planning','finance','loans','admissions')),
 language text NOT NULL CHECK(language IN ('en','es')),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 resolved_model text CHECK(length(resolved_model) BETWEEN 1 AND 100),
 availability text NOT NULL CHECK(availability IN ('available','unavailable')),
 outcome text NOT NULL CHECK(outcome IN ('provider_accepted','prepared','failed')),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries)<=6)
);
CREATE INDEX origen_teaching_access_time ON origen_teaching_access(created_at DESC,id);
CREATE INDEX origen_teaching_access_entries ON origen_teaching_access USING gin(entries jsonb_path_ops);
ALTER TABLE origen_teaching_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_teaching_access FROM PUBLIC;

-- Durable aggregate counts survive the 90-day expiry of request details.
-- One library row and one row per teaching; no user or request identifiers.
CREATE TABLE origen_teaching_access_totals (
 scope text PRIMARY KEY,
 tracked_since timestamptz NOT NULL DEFAULT now(),
 lookups bigint NOT NULL DEFAULT 0 CHECK(lookups>=0),
 matched bigint NOT NULL DEFAULT 0 CHECK(matched>=0),
 accepted bigint NOT NULL DEFAULT 0 CHECK(accepted>=0),
 prepared bigint NOT NULL DEFAULT 0 CHECK(prepared>=0),
 failed bigint NOT NULL DEFAULT 0 CHECK(failed>=0),
 unavailable bigint NOT NULL DEFAULT 0 CHECK(unavailable>=0)
);
ALTER TABLE origen_teaching_access_totals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_teaching_access_totals FROM PUBLIC;

CREATE FUNCTION origen_record_teaching_access(input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE refs jsonb; supplied integer;
BEGIN
 IF nullif(current_setting('origen.subject',true),'') IS NULL
 OR coalesce(current_setting('origen.purpose',true),'') NOT IN ('account','analytics')
 THEN RAISE EXCEPTION 'teaching_access_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(input->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'entries')>6
 THEN RAISE EXCEPTION 'invalid_teaching_request' USING ERRCODE='22023'; END IF;
 supplied:=jsonb_array_length(input->'entries');
 -- Resolve the title from the exact published revision, including after unpublishing.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'title',r.content->>'title') ORDER BY e.ordinality),'[]') INTO refs
 FROM jsonb_array_elements(input->'entries') WITH ORDINALITY e(value,ordinality)
 JOIN origen_teaching_revisions r ON r.id=(e.value->>'id')::uuid AND r.revision=(e.value->>'revision')::integer AND r.action='publish';
 IF jsonb_array_length(refs)<>supplied THEN RAISE EXCEPTION 'invalid_teaching_revision' USING ERRCODE='22023'; END IF;
 INSERT INTO origen_teaching_access(id,operation,topic,language,model,resolved_model,availability,outcome,entries)
 VALUES((input->>'id')::uuid,input->>'operation',input->>'topic',input->>'language',input->>'model',nullif(input->>'resolvedModel',''),input->>'availability',input->>'outcome',refs)
 ON CONFLICT(id) DO NOTHING;
 IF FOUND THEN
  INSERT INTO origen_teaching_access_totals(scope,lookups,matched,accepted,prepared,failed,unavailable)
  SELECT key,1,CASE WHEN supplied>0 THEN 1 ELSE 0 END,
   CASE WHEN supplied>0 AND input->>'outcome'='provider_accepted' THEN 1 ELSE 0 END,
   CASE WHEN supplied>0 AND input->>'outcome'='prepared' THEN 1 ELSE 0 END,
   CASE WHEN input->>'outcome'='failed' THEN 1 ELSE 0 END,
   CASE WHEN input->>'availability'='unavailable' THEN 1 ELSE 0 END
  FROM (SELECT 'library' AS key UNION SELECT value->>'id' FROM jsonb_array_elements(refs)) scopes ORDER BY key
  ON CONFLICT(scope) DO UPDATE SET
   lookups=origen_teaching_access_totals.lookups+excluded.lookups,
   matched=origen_teaching_access_totals.matched+excluded.matched,
   accepted=origen_teaching_access_totals.accepted+excluded.accepted,
   prepared=origen_teaching_access_totals.prepared+excluded.prepared,
   failed=origen_teaching_access_totals.failed+excluded.failed,
   unavailable=origen_teaching_access_totals.unavailable+excluded.unavailable;
 END IF;
 -- Bounded metadata retention, independent of student/account records.
 DELETE FROM origen_teaching_access WHERE created_at<now()-interval '90 days';
END $$;

CREATE FUNCTION origen_teaching_activity(input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); result jsonb;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'analytics'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND blocked)
 THEN RAISE EXCEPTION 'teaching_access_denied' USING ERRCODE='42501'; END IF;
 WITH filtered AS (
  SELECT * FROM origen_teaching_access WHERE created_at>=now()-interval '30 days'
  AND (input->>'id' IS NULL OR entries @> jsonb_build_array(jsonb_build_object('id',input->>'id')))
 ), recent AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 100)
 SELECT jsonb_build_object('days',30,'summary',jsonb_build_object(
  'lookups',(SELECT count(*) FROM filtered),
  'matched',(SELECT count(*) FROM filtered WHERE jsonb_array_length(entries)>0),
  'accepted',(SELECT count(*) FROM filtered WHERE outcome='provider_accepted' AND jsonb_array_length(entries)>0),
  'prepared',(SELECT count(*) FROM filtered WHERE outcome='prepared' AND jsonb_array_length(entries)>0),
  'failed',(SELECT count(*) FROM filtered WHERE outcome='failed'),
  'unavailable',(SELECT count(*) FROM filtered WHERE availability='unavailable')),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC,id DESC),'[]') FROM recent)) INTO result;
 RETURN result||jsonb_build_object('allTime',(
  SELECT jsonb_build_object('lookups',coalesce(t.lookups,0),'matched',coalesce(t.matched,0),
   'accepted',coalesce(t.accepted,0),'prepared',coalesce(t.prepared,0),
   'failed',coalesce(t.failed,0),'unavailable',coalesce(t.unavailable,0),'since',t.tracked_since)
  FROM (SELECT 1) singleton LEFT JOIN origen_teaching_access_totals t ON t.scope=coalesce(input->>'id','library')
 ));
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_record_teaching_access(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION origen_teaching_activity(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_record_teaching_access(jsonb),origen_teaching_activity(jsonb) FROM PUBLIC;

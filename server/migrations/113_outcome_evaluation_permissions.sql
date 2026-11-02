-- Evaluation is a separate, exact, revocable purpose. No earlier save/share
-- approval is upgraded and no cross-student dataset or conclusion is retained.
CREATE TABLE origen_outcome_evaluation_permissions (
 account_id uuid NOT NULL,episode_id uuid NOT NULL,student_id text NOT NULL,institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),status text NOT NULL CHECK(status IN ('granted','declined','withdrawn','needs_review')),
 purpose text NOT NULL DEFAULT 'service_quality' CHECK(purpose='service_quality'),contract_version integer NOT NULL DEFAULT 1 CHECK(contract_version=1),
 rule_version text NOT NULL CHECK(rule_version='outcome-assessment-v1'),source_fingerprint text,expires_at timestamptz,
 corrections integer NOT NULL DEFAULT 0 CHECK(corrections>=0),tracking_since timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,episode_id),FOREIGN KEY(account_id,episode_id) REFERENCES origen_outcome_episodes(account_id,id) ON DELETE CASCADE,
 CHECK(status<>'granted' OR source_fingerprint IS NOT NULL AND tracking_since IS NOT NULL AND source_fingerprint ~ '^[a-f0-9]{64}$' AND expires_at IS NOT NULL)
);
CREATE TABLE origen_outcome_evaluation_previews (
 id uuid PRIMARY KEY,account_id uuid NOT NULL,episode_id uuid NOT NULL,expected_version integer NOT NULL,source_fingerprint text NOT NULL,
 digest text NOT NULL,expires_at timestamptz NOT NULL,snapshot jsonb,result_version integer,
 FOREIGN KEY(account_id,episode_id) REFERENCES origen_outcome_episodes(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_outcome_evaluation_capabilities (
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 purpose text NOT NULL DEFAULT 'service_quality' CHECK(purpose='service_quality'),contract_version integer NOT NULL DEFAULT 1 CHECK(contract_version=1),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 PRIMARY KEY(institution_id,coordinator_id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['origen_outcome_evaluation_permissions','origen_outcome_evaluation_previews','origen_outcome_evaluation_capabilities'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);END LOOP;END $$;
CREATE FUNCTION origen_outcome_evaluation_fingerprint(owner uuid,eid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE e origen_outcome_episodes%ROWTYPE; target jsonb; refs jsonb;
BEGIN
 SELECT * INTO e FROM origen_outcome_episodes WHERE account_id=owner AND id=eid;
 IF e.id IS NULL OR e.state<>'current' OR e.valid_until<=clock_timestamp() OR NOT EXISTS(
  SELECT 1 FROM origen_accounts a JOIN origen_eligibility p ON p.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
  WHERE a.id=owner AND a.role='student' AND p.age_band='18plus' AND p.status='adult' AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts c WHERE c.subject_hash=p.subject_hash)) THEN RETURN NULL; END IF;
 target:=origen_student_follow_up_target(owner,e.plan_id,e.step_id);
 IF target->>'permitted' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true' OR target->>'actionHash' IS DISTINCT FROM e.action_hash THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'report',v.report_id,'reportVersion',v.report_version) ORDER BY v.id) INTO refs
  FROM origen_outcome_evidence v JOIN origen_student_follow_up_reports r ON r.account_id=v.account_id AND r.id=v.report_id AND r.version=v.report_version WHERE v.account_id=owner AND v.episode_id=eid;
 IF refs IS NULL THEN RETURN NULL; END IF;
 RETURN encode(sha256(convert_to(jsonb_build_object('episode',to_jsonb(e),'evidence',refs,'definition',(SELECT contract FROM origen_outcome_definitions WHERE id=e.definition_id AND version=e.definition_version))::text,'UTF8')),'hex');
END $$;
CREATE FUNCTION origen_outcome_evaluation_view(owner uuid,eid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('version',p.version,'status',p.status,'purpose',p.purpose,'contractVersion',p.contract_version,'expiresAt',p.expires_at,'corrections',p.corrections,'trackingSince',p.tracking_since)
 FROM origen_outcome_evaluation_permissions p WHERE p.account_id=owner AND p.episode_id=eid
$$;
CREATE FUNCTION origen_student_outcome_evaluation_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=current_setting('origen.subject',true);owner uuid;action text:=input->>'action';e origen_outcome_episodes%ROWTYPE;g origen_outcome_evaluation_permissions%ROWTYPE;p origen_outcome_evaluation_previews%ROWTYPE;
 fingerprint text;org uuid;orgname text;expiry timestamptz;snapshot jsonb;
BEGIN
 IF coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"evaluation_denied"}';END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"evaluation_denied"}';END IF;
 IF action='export' AND input-'action'='{}'::jsonb THEN RETURN jsonb_build_object('permissions',coalesce((SELECT jsonb_agg(jsonb_build_object('episodeId',episode_id,'permission',origen_outcome_evaluation_view(owner,episode_id))) FROM origen_outcome_evaluation_permissions WHERE account_id=owner),'[]'::jsonb));END IF;
 IF input->>'purpose' IS DISTINCT FROM 'service_quality' OR input->'contractVersion' IS DISTINCT FROM '1'::jsonb OR action NOT IN ('load','prepare','confirm','withdraw','decline')
  OR input-ARRAY['action','purpose','contractVersion','studentId','episodeId','version','operationId','previewId','digest','confirmed','enabled']<>'{}'::jsonb THEN RETURN '{"error":"invalid_outcome_evaluation"}';END IF;
 SELECT * INTO e FROM origen_outcome_episodes WHERE account_id=owner AND id=(input->>'episodeId')::uuid AND student_id=input->>'studentId' FOR UPDATE;
 IF e.id IS NULL THEN RETURN '{"error":"evaluation_unavailable"}';END IF;
 SELECT institution_id,organization_name INTO org,orgname FROM origen_review_requests WHERE id=e.request_id AND account_id=owner;
 fingerprint:=origen_outcome_evaluation_fingerprint(owner,e.id);
 SELECT * INTO g FROM origen_outcome_evaluation_permissions WHERE account_id=owner AND episode_id=e.id FOR UPDATE;
 IF g.status='granted' AND (fingerprint IS NULL OR fingerprint<>g.source_fingerprint OR g.expires_at<=clock_timestamp()) THEN
  UPDATE origen_outcome_evaluation_permissions SET status='needs_review',version=version+1,source_fingerprint=NULL,updated_at=clock_timestamp() WHERE account_id=owner AND episode_id=e.id RETURNING * INTO g;
  DELETE FROM origen_outcome_evaluation_previews WHERE account_id=owner AND episode_id=e.id;
 END IF;
 IF action='load' THEN RETURN jsonb_build_object('enabled',input->'enabled','eligible',fingerprint IS NOT NULL,'organizationName',orgname,'permission',origen_outcome_evaluation_view(owner,e.id));END IF;
 IF action IN ('withdraw','decline') THEN
  IF coalesce(g.version,0) IS DISTINCT FROM (input->>'version')::integer OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_changed"}';END IF;
  INSERT INTO origen_outcome_evaluation_permissions(account_id,episode_id,student_id,institution_id,version,status,rule_version) VALUES(owner,e.id,e.student_id,org,coalesce(g.version,0)+1,CASE WHEN action='withdraw' THEN 'withdrawn' ELSE 'declined' END,'outcome-assessment-v1')
   ON CONFLICT(account_id,episode_id) DO UPDATE SET version=excluded.version,status=excluded.status,source_fingerprint=NULL,expires_at=NULL,corrections=0,tracking_since=NULL,updated_at=clock_timestamp();
  DELETE FROM origen_outcome_evaluation_previews WHERE account_id=owner AND episode_id=e.id;RETURN jsonb_build_object('status','excluded','permission',origen_outcome_evaluation_view(owner,e.id));
 END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_paused"}';END IF;
 IF fingerprint IS NULL THEN RETURN '{"error":"evaluation_unavailable"}';END IF;
 IF action='prepare' THEN
  IF coalesce(g.version,0) IS DISTINCT FROM (input->>'version')::integer THEN RETURN '{"error":"evaluation_changed"}';END IF;
  DELETE FROM origen_outcome_evaluation_previews WHERE expires_at<=clock_timestamp();
  SELECT * INTO p FROM origen_outcome_evaluation_previews WHERE id=(input->>'operationId')::uuid FOR UPDATE;
  IF p.id IS NOT NULL THEN
   IF p.account_id<>owner OR p.episode_id<>e.id OR p.expected_version<>coalesce(g.version,0) OR p.source_fingerprint<>fingerprint OR p.result_version IS NOT NULL THEN RETURN '{"error":"evaluation_changed"}';END IF;
  ELSE
   IF (SELECT count(*) FROM origen_outcome_evaluation_previews WHERE account_id=owner)>=30 THEN RETURN '{"error":"evaluation_limit_changed"}';END IF;
   expiry:=least(clock_timestamp()+interval '90 days',e.valid_until);
   snapshot:=jsonb_build_object('purpose','service_quality','contractVersion',1,'ruleVersion','outcome-assessment-v1','episodeId',e.id,'episodeVersion',e.version,'definitionId',e.definition_id,'definitionVersion',e.definition_version,'organizationName',orgname,'window',jsonb_build_object('start',e.window_start,'end',e.window_end,'timeZone',e.time_zone),'permissionExpiresAt',expiry);
   INSERT INTO origen_outcome_evaluation_previews(id,account_id,episode_id,expected_version,source_fingerprint,digest,expires_at,snapshot)
    VALUES((input->>'operationId')::uuid,owner,e.id,coalesce(g.version,0),fingerprint,encode(sha256(convert_to(snapshot::text||gen_random_uuid()::text,'UTF8')),'hex'),least(clock_timestamp()+interval '10 minutes',expiry),snapshot) RETURNING * INTO p;
  END IF;
  RETURN jsonb_build_object('preview',p.snapshot||jsonb_build_object('id',p.id,'digest',p.digest,'expiresAt',p.expires_at));
 END IF;
 SELECT * INTO p FROM origen_outcome_evaluation_previews WHERE id=(input->>'previewId')::uuid AND account_id=owner AND episode_id=e.id FOR UPDATE;
 IF p.id IS NULL OR input->>'digest' IS DISTINCT FROM p.digest OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_changed"}';END IF;
 IF p.result_version IS NOT NULL THEN RETURN CASE WHEN g.version=p.result_version AND g.status='granted' THEN jsonb_build_object('status','included','permission',origen_outcome_evaluation_view(owner,e.id)) ELSE '{"status":"superseded"}'::jsonb END;END IF;
 IF p.expires_at<=clock_timestamp() OR p.source_fingerprint<>fingerprint OR p.expected_version<>coalesce(g.version,0) THEN RETURN '{"error":"evaluation_changed"}';END IF;
 INSERT INTO origen_outcome_evaluation_permissions(account_id,episode_id,student_id,institution_id,version,status,rule_version,source_fingerprint,expires_at,tracking_since)
  VALUES(owner,e.id,e.student_id,org,coalesce(g.version,0)+1,'granted','outcome-assessment-v1',fingerprint,(p.snapshot->>'permissionExpiresAt')::timestamptz,clock_timestamp())
  ON CONFLICT(account_id,episode_id) DO UPDATE SET version=excluded.version,status='granted',rule_version=excluded.rule_version,source_fingerprint=excluded.source_fingerprint,expires_at=excluded.expires_at,tracking_since=coalesce(origen_outcome_evaluation_permissions.tracking_since,excluded.tracking_since),updated_at=clock_timestamp() RETURNING * INTO g;
 UPDATE origen_outcome_evaluation_previews SET snapshot=NULL,result_version=g.version WHERE id=p.id;RETURN jsonb_build_object('status','included','permission',origen_outcome_evaluation_view(owner,e.id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_outcome_evaluation"}';END $$;
-- Source edits remove permission before an old analytical contribution can be
-- used. Only corrections observed during active permission are counted.
CREATE FUNCTION origen_outcome_evaluation_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;owner uuid:=(row->>'account_id')::uuid;ids uuid[];
BEGIN
 IF TG_TABLE_NAME='origen_student_follow_up_reports' THEN
  SELECT array_agg(episode_id) INTO ids FROM origen_outcome_evidence WHERE account_id=owner AND report_id=OLD.id;
  IF TG_OP='UPDATE' AND (NEW.detail,NEW.occurred_on,NEW.time_zone,NEW.response_state,NEW.reported_action,NEW.reported_outcome) IS DISTINCT FROM (OLD.detail,OLD.occurred_on,OLD.time_zone,OLD.response_state,OLD.reported_action,OLD.reported_outcome) THEN
   UPDATE origen_outcome_evaluation_permissions SET corrections=corrections+1 WHERE account_id=owner AND episode_id=ANY(ids) AND status='granted';
  END IF;
 ELSIF TG_TABLE_NAME='origen_outcome_episodes' THEN ids:=ARRAY[(row->>'id')::uuid];
 ELSE ids:=ARRAY[(row->>'episode_id')::uuid];END IF;
 UPDATE origen_outcome_evaluation_permissions SET status='needs_review',version=version+1,source_fingerprint=NULL,updated_at=clock_timestamp() WHERE account_id=owner AND episode_id=ANY(ids) AND status='granted';
 DELETE FROM origen_outcome_evaluation_previews WHERE account_id=owner AND episode_id=ANY(ids);RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER outcome_evaluation_report_changed BEFORE UPDATE OR DELETE ON origen_student_follow_up_reports FOR EACH ROW EXECUTE FUNCTION origen_outcome_evaluation_source_changed();
CREATE TRIGGER outcome_evaluation_episode_changed AFTER UPDATE ON origen_outcome_episodes FOR EACH ROW WHEN(NEW IS DISTINCT FROM OLD) EXECUTE FUNCTION origen_outcome_evaluation_source_changed();
CREATE TRIGGER outcome_evaluation_evidence_changed AFTER INSERT OR DELETE ON origen_outcome_evidence FOR EACH ROW EXECUTE FUNCTION origen_outcome_evaluation_source_changed();
CREATE FUNCTION origen_outcome_evaluation_after_restore() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 DELETE FROM origen_outcome_evaluation_previews;
 UPDATE origen_outcome_evaluation_permissions SET status='withdrawn',version=version+1,source_fingerprint=NULL,expires_at=NULL,corrections=0,tracking_since=NULL;
 UPDATE origen_outcome_evaluation_capabilities SET revoked_at=clock_timestamp(),version=version+1;
END $$;
CREATE FUNCTION origen_outcome_evaluation_grant(org uuid,coordinator uuid,valid_until timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 IF valid_until IS NULL THEN UPDATE origen_outcome_evaluation_capabilities SET revoked_at=clock_timestamp(),version=version+1 WHERE institution_id=org AND coordinator_id=coordinator;RETURN;END IF;
 IF valid_until<=clock_timestamp() OR valid_until>clock_timestamp()+interval '90 days' OR NOT EXISTS(SELECT 1 FROM origen_coordinator_profiles WHERE id=coordinator AND institution_id=org AND status='active') THEN RAISE EXCEPTION 'invalid_evaluation_scope' USING ERRCODE='23514';END IF;
 INSERT INTO origen_outcome_evaluation_capabilities(institution_id,coordinator_id,expires_at) VALUES(org,coordinator,valid_until)
 ON CONFLICT(institution_id,coordinator_id) DO UPDATE SET version=origen_outcome_evaluation_capabilities.version+1,expires_at=excluded.expires_at,revoked_at=NULL;
END $$;

-- Runtime receives only permission-filtered structured inputs, never report prose.
-- The HTTP boundary aggregates these inputs and verifies the revision again.
CREATE FUNCTION origen_service_quality_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); org origen_institutions%ROWTYPE; staff origen_coordinator_profiles%ROWTYPE;
 cap origen_outcome_evaluation_capabilities%ROWTYPE; items jsonb; bundle jsonb; revision text; limited boolean;
 period_end timestamptz:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; period_start timestamptz;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR current_setting('origen.coordinator_verified',true) IS DISTINCT FROM 'true'
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN RETURN '{"error":"evaluation_denied"}'; END IF;
 IF input->>'action' IS NULL OR input->>'action' NOT IN ('load','verify') OR input->>'purpose' IS DISTINCT FROM 'service_quality' OR input->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR input-ARRAY['action','organizationId','definitionId','purpose','contractVersion','enabled','revision']<>'{}'::jsonb
  OR NOT EXISTS(SELECT 1 FROM origen_outcome_definitions WHERE id=input->>'definitionId' AND version=1) THEN RETURN '{"error":"invalid_outcome_evaluation"}'; END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_paused"}'; END IF;
 SELECT * INTO org FROM origen_institutions WHERE id=(input->>'organizationId')::uuid FOR SHARE;
 SELECT * INTO staff FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor FOR SHARE;
 IF staff.id IS NULL OR staff.status<>'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations WHERE institution_id=org.id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=actor) THEN RETURN '{"error":"evaluation_denied"}'; END IF;
 SELECT * INTO cap FROM origen_outcome_evaluation_capabilities WHERE institution_id=org.id AND coordinator_id=staff.id AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF cap.coordinator_id IS NULL THEN RETURN '{"error":"evaluation_denied"}'; END IF;
 period_start:=(period_end AT TIME ZONE 'UTC'-interval '1 month') AT TIME ZONE 'UTC';
 WITH permitted AS MATERIALIZED (
  SELECT e.*,p.version AS permission_version,p.corrections,p.tracking_since,p.source_fingerprint,p.expires_at AS permission_expires_at
  FROM origen_outcome_evaluation_permissions p JOIN origen_outcome_episodes e ON e.account_id=p.account_id AND e.id=p.episode_id
  WHERE p.institution_id=org.id AND p.student_id=e.student_id AND p.status='granted' AND p.expires_at>clock_timestamp()
   AND p.purpose='service_quality' AND p.contract_version=1 AND p.rule_version='outcome-assessment-v1'
   AND e.definition_id=input->>'definitionId' AND e.definition_version=1 AND e.recorded_at>=period_start AND e.recorded_at<period_end
   AND p.source_fingerprint=origen_outcome_evaluation_fingerprint(e.account_id,e.id)
  ORDER BY e.recorded_at,e.id LIMIT 1001
 ), normalized AS (
  SELECT encode(sha256(convert_to(e.id::text,'UTF8')),'hex') AS key,e.* FROM permitted e
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
  'episodeKey',e.key,'participantKey',encode(sha256(convert_to(e.account_id::text,'UTF8')),'hex'),
  'permissionVersion',e.permission_version,'corrections',e.corrections,'trackingSince',e.tracking_since,
  'permissionExpiresAt',e.permission_expires_at,'sourceFingerprint',e.source_fingerprint,
  'episode',jsonb_build_object('id',e.key,'version',e.version,'definition_id',e.definition_id,'definition_version',e.definition_version,
   'institution','present','term','present','cycle','present','window_start',e.window_start,'window_end',e.window_end,'time_zone',e.time_zone,
   'state',e.state,'valid_until',e.valid_until,'recorded_at',e.recorded_at),
  'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',encode(sha256(convert_to(v.id::text,'UTF8')),'hex'),'version',v.version,
    'episode_id',e.key,'report_id',encode(sha256(convert_to(v.report_id::text,'UTF8')),'hex'),'report_version',v.report_version,
    'response_state',v.response_state,'claim_status',v.claim_status,'decision',v.decision,'event_on',v.event_on,'time_zone',v.time_zone,'recorded_at',v.recorded_at) ORDER BY v.id)
   FROM (SELECT v.* FROM origen_outcome_evidence v JOIN origen_student_follow_up_reports r ON r.account_id=v.account_id AND r.id=v.report_id AND r.version=v.report_version WHERE v.account_id=e.account_id AND v.episode_id=e.id ORDER BY v.id LIMIT 101) v),'[]'::jsonb)
 ) ORDER BY e.recorded_at,e.id),'[]'::jsonb) INTO items FROM normalized e;
 limited:=jsonb_array_length(items)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) i WHERE jsonb_array_length(i->'evidence')>100);
 bundle:=jsonb_build_object('items',CASE WHEN limited THEN '[]'::jsonb ELSE items END,'limited',limited,'period',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM'),
  'definitions',(SELECT jsonb_agg(contract ORDER BY id) FROM origen_outcome_definitions WHERE id=input->>'definitionId' AND version=1));
 revision:=encode(sha256(convert_to(jsonb_build_object('bundle',bundle,'capability',to_jsonb(cap),'organization',org.id)::text,'UTF8')),'hex');
 IF input->>'action'='verify' THEN RETURN jsonb_build_object('current',input->>'revision'=revision);END IF;
 RETURN bundle||jsonb_build_object('revision',revision,'cutoff',clock_timestamp());
EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_outcome_evaluation"}';END $$;

-- Keep consent visible to its owner even when new opt-ins are paused.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('origen_outcome_evidence_command(jsonb)'::regprocedure) INTO d;
 IF position('to_jsonb(e)-''account_id''-''action_hash''' IN d)=0 THEN RAISE EXCEPTION 'outcome_projection_missing'; END IF;
 d:=replace(d,'to_jsonb(e)-''account_id''-''action_hash''','(to_jsonb(e)-''account_id''-''action_hash'')||jsonb_build_object(''evaluation'',origen_outcome_evaluation_view(owner,e.id))');
 EXECUTE d;
END $$;
CREATE INDEX outcome_evaluation_episode_period ON origen_outcome_episodes(definition_id,recorded_at,id);
CREATE INDEX outcome_evaluation_report_scope ON origen_outcome_evaluation_permissions(institution_id,episode_id) WHERE status='granted';
DO $$ DECLARE p record;BEGIN
 FOR p IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND (proname LIKE 'origen_outcome_evaluation_%' OR proname IN ('origen_student_outcome_evaluation_command','origen_service_quality_command')) LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',p.oid::regprocedure,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',p.oid::regprocedure);
 END LOOP;
END $$;

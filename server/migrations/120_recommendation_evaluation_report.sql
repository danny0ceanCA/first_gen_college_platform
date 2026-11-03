-- Fixed previous-calendar-month report, one report per organization per UTC
-- day across all reviewers. No retained report, arbitrary filters or row export.
CREATE FUNCTION origen_recommendation_evaluation_report(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),'');org origen_institutions%ROWTYPE;staff origen_coordinator_profiles%ROWTYPE;cap origen_recommendation_evaluation_capabilities%ROWTYPE;
 finish timestamptz:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';start_at timestamptz;items jsonb;bundle jsonb;revision text;limited boolean;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'account' OR current_setting('origen.coordinator_verified',true) IS DISTINCT FROM 'true'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN RETURN '{"error":"evaluation_denied"}';END IF;
 IF input->>'purpose' IS DISTINCT FROM 'recommendation_evaluation' OR input->'contractVersion' IS DISTINCT FROM '1'::jsonb OR input->>'action' IS NULL OR input->>'action' NOT IN ('load','verify') OR input-ARRAY['action','purpose','contractVersion','organizationId','enabled','revision']<>'{}'::jsonb THEN RETURN '{"error":"invalid_recommendation_evaluation"}';END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_paused"}';END IF;
 SELECT * INTO org FROM origen_institutions WHERE id=(input->>'organizationId')::uuid FOR UPDATE;
 SELECT * INTO staff FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor FOR SHARE;
 IF staff.id IS NULL OR staff.status<>'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations WHERE institution_id=org.id AND status='active') OR NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=actor) THEN RETURN '{"error":"evaluation_denied"}';END IF;
 SELECT * INTO cap FROM origen_recommendation_evaluation_capabilities WHERE institution_id=org.id AND coordinator_id=staff.id AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF cap.coordinator_id IS NULL THEN RETURN '{"error":"evaluation_denied"}';END IF;
 IF EXISTS(SELECT 1 FROM origen_recommendation_evaluation_report_budget WHERE institution_id=org.id AND reported_on=(clock_timestamp() AT TIME ZONE 'UTC')::date) THEN RETURN '{"error":"evaluation_report_limited"}';END IF;
 start_at:=(finish AT TIME ZONE 'UTC'-interval '1 month') AT TIME ZONE 'UTC';
 WITH receipts AS MATERIALIZED (
  SELECT r.* FROM origen_recommendation_evaluation_receipts r WHERE r.institution_id=org.id AND r.created_at>=start_at AND r.created_at<finish AND origen_recommendation_evaluation_receipt_current(r.account_id,r.id)
  ORDER BY r.created_at,r.id LIMIT 1001
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
  'key',encode(sha256(convert_to(r.id::text,'UTF8')),'hex'),'participant',encode(sha256(convert_to(r.account_id::text,'UTF8')),'hex'),
  'sourceKey',CASE WHEN r.source IS NULL THEN NULL ELSE encode(sha256(convert_to(r.source::text,'UTF8')),'hex') END,
  'status',r.status,'considered',r.considered,'eligible',r.eligible,'channel',r.channel,'language',r.language,'latencyMs',r.latency_ms,
  'displayed',r.displayed_at IS NOT NULL,'played',r.played_at IS NOT NULL,'accepted',r.accepted_at IS NOT NULL,'createdAt',r.created_at,
  'permissionVersion',r.permission_version,'outcomes',coalesce((
   SELECT jsonb_agg(jsonb_build_object('fingerprint',origen_outcome_evaluation_fingerprint(e.account_id,e.id),
    'episode',jsonb_build_object('id',encode(sha256(convert_to(e.id::text,'UTF8')),'hex'),'version',e.version,'definition_id',e.definition_id,'definition_version',e.definition_version,'institution','present','term','present','cycle','present','state',e.state,'window_start',e.window_start,'window_end',e.window_end,'time_zone',e.time_zone,'valid_until',e.valid_until,'recorded_at',e.recorded_at),
    'evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',encode(sha256(convert_to(v.id::text,'UTF8')),'hex'),'episode_id',encode(sha256(convert_to(e.id::text,'UTF8')),'hex'),'version',v.version,'report_id',encode(sha256(convert_to(v.report_id::text,'UTF8')),'hex'),'report_version',v.report_version,'response_state',v.response_state,'claim_status',v.claim_status,'decision',v.decision,'event_on',v.event_on,'time_zone',v.time_zone,'recorded_at',v.recorded_at,'reported_action',p.reported_action) ORDER BY v.id),'[]'::jsonb)
      FROM (SELECT * FROM origen_outcome_evidence WHERE account_id=e.account_id AND episode_id=e.id ORDER BY id LIMIT 101) v JOIN origen_student_follow_up_reports p ON p.account_id=v.account_id AND p.id=v.report_id AND p.version=v.report_version)))
   FROM (SELECT x.* FROM origen_outcome_recommendation_links l JOIN origen_outcome_episodes x ON x.account_id=l.account_id AND x.id=l.episode_id AND x.version=l.episode_version
    WHERE l.account_id=r.account_id AND l.recommendation_id=r.recommendation_id AND l.approved_at>=r.accepted_at AND x.recorded_at>=r.accepted_at
    AND origen_outcome_evaluation_fingerprint(x.account_id,x.id) IS NOT NULL ORDER BY x.id LIMIT 2) e),'[]'::jsonb)
 ) ORDER BY r.created_at,r.id),'[]'::jsonb) INTO items FROM receipts r;
 limited:=jsonb_array_length(items)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) i CROSS JOIN LATERAL jsonb_array_elements(i->'outcomes') e WHERE jsonb_array_length(e->'evidence')>100);
 -- Hash even an over-limit snapshot; never aggregate its biased first page.
 revision:=encode(sha256(convert_to(jsonb_build_object('cap',cap.version,'expiry',cap.expires_at,'items',items,'period',finish)::text,'UTF8')),'hex');
 IF input->>'action'='verify' THEN
  IF input->>'revision' IS DISTINCT FROM revision THEN RETURN '{"error":"evaluation_changed"}';END IF;
  INSERT INTO origen_recommendation_evaluation_report_budget(institution_id,reported_on) VALUES(org.id,(clock_timestamp() AT TIME ZONE 'UTC')::date) ON CONFLICT(institution_id) DO UPDATE SET reported_on=excluded.reported_on;
  RETURN '{"current":true}';
 END IF;
 bundle:=jsonb_build_object('period',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM'),'cutoff',clock_timestamp(),'revision',revision,'limited',limited,'items',CASE WHEN limited THEN '[]'::jsonb ELSE items END,
 'definitions',(SELECT jsonb_agg(contract ORDER BY id,version) FROM origen_outcome_definitions));RETURN bundle;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_recommendation_evaluation"}';END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_recommendation_evaluation_report(jsonb) SET search_path=%I,pg_temp',current_schema());END $$;
REVOKE ALL ON FUNCTION origen_recommendation_evaluation_report(jsonb) FROM PUBLIC;

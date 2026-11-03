-- Read-only foundation. No recommendation, acceptance, exposure or evaluation
-- records are created, copied or backfilled. Template publication is step 2.
CREATE FUNCTION origen_recommendation_source_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid;
 student text:=input->>'studentId'; ref jsonb:=input->'source'; keys text[];
 p origen_plans%ROWTYPE; s origen_plan_steps%ROWTYPE; r origen_review_requests%ROWTYPE;
 context jsonb; revision text; organization uuid; permission integer;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['action','contractVersion','purpose','studentId','source']<>'{}'::jsonb
  OR NOT(input ?& ARRAY['action','contractVersion','purpose','studentId','source'])
  OR input->>'action' IS DISTINCT FROM 'resolve-source' OR input->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR input->>'purpose' IS DISTINCT FROM 'personal_guidance'
  OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(student) NOT BETWEEN 1 AND 128 OR student<>btrim(student) OR student ~ '[[:cntrl:]]'
  OR jsonb_typeof(ref) IS DISTINCT FROM 'object' THEN RETURN '{"error":"invalid_recommendation_contract"}'; END IF;
 keys:=CASE ref->>'kind' WHEN 'accepted-action' THEN ARRAY['kind','planId','stepId','planVersion']
  WHEN 'review-response' THEN ARRAY['kind','requestId','responseVersion','organizationId']
  WHEN 'reviewed-template' THEN ARRAY['kind','teachingId','revision'] END;
 IF keys IS NULL OR ref-keys<>'{}'::jsonb OR NOT(ref ?& keys) THEN RETURN '{"error":"invalid_recommendation_contract"}'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(ref) e WHERE e.key IN ('planId','requestId','organizationId','teachingId')
   AND (jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'))
  OR EXISTS(SELECT 1 FROM jsonb_each(ref) e WHERE e.key IN ('planVersion','responseVersion','revision')
   AND (jsonb_typeof(e.value) IS DISTINCT FROM 'number' OR e.value#>>'{}' !~ '^[1-9][0-9]*$' OR (e.value#>>'{}')::numeric>2147483647))
  THEN RETURN '{"error":"invalid_recommendation_contract"}'; END IF;
 IF ref->>'kind'='accepted-action' AND (jsonb_typeof(ref->'stepId') IS DISTINCT FROM 'string' OR length(ref->>'stepId') NOT BETWEEN 1 AND 128
  OR ref->>'stepId'<>btrim(ref->>'stepId') OR ref->>'stepId' ~ '[[:cntrl:]]') THEN RETURN '{"error":"invalid_recommendation_contract"}'; END IF;
 IF coalesce(current_setting('origen.recommendations',true),'false')<>'true' THEN RETURN '{"error":"recommendation_paused"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor;
 IF owner IS NULL OR NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"status":"unavailable"}'; END IF;
 SELECT e.revision INTO permission FROM origen_eligibility e WHERE e.subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
 IF ref->>'kind'='accepted-action' THEN
  SELECT * INTO p FROM origen_plans WHERE account_id=owner AND id=(ref->>'planId')::uuid AND student_id=student;
  IF p.id IS NULL OR p.version<>(ref->>'planVersion')::integer THEN RETURN '{"status":"unavailable"}'; END IF;
  SELECT * INTO s FROM origen_plan_steps WHERE account_id=owner AND plan_id=p.id AND id=ref->>'stepId';
  IF s.id IS NULL THEN RETURN '{"status":"unavailable"}'; END IF;
  -- This is the student's independent action. It does not recertify any old
  -- coordinator advice, infer an institution, or make it eligible for ranking.
  revision:=encode(sha256(convert_to(jsonb_build_object('source',ref,'plan',to_jsonb(p),'step',to_jsonb(s),'permission',permission)::text,'UTF8')),'hex');
 ELSIF ref->>'kind'='review-response' THEN
  SELECT * INTO r FROM origen_review_requests WHERE account_id=owner AND student_id=student AND id=(ref->>'requestId')::uuid AND institution_id=(ref->>'organizationId')::uuid;
  IF r.id IS NULL THEN RETURN '{"status":"unavailable"}'; END IF;
  PERFORM set_config('origen.review_response_context','true',true);
  context:=origen_review_response_context_command(jsonb_build_object('action','read','studentId',student,'source',ref-'organizationId','mode','question'));
  IF context->>'status' IS DISTINCT FROM 'retrieved' OR context->'response'->>'availability' IS DISTINCT FROM 'current' THEN RETURN '{"status":"unavailable"}'; END IF;
  organization:=r.institution_id; revision:=context->'guard'->>'revision';
 ELSE
  -- An ordinary teaching publication has no reviewed action metadata yet.
  -- A caller-supplied teaching ID/version cannot confer publication authority.
  RETURN '{"status":"unavailable"}';
 END IF;
 RETURN jsonb_build_object('contractVersion',1,'policyVersion','evidence-informed-v1','status','current','source',ref,'sourceRevision',revision,
  'scope',jsonb_build_object('studentId',student,'organizationId',organization,'campus',jsonb_build_object('state','unknown','id',NULL),'term',jsonb_build_object('state','unknown','value',NULL)),
  'authority',jsonb_build_object('canRecommend',false,'canAccept',false,'canPublish',false,'canEvaluate',false));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_recommendation_contract"}';
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_recommendation_source_command(jsonb) SET search_path=%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_recommendation_source_command(jsonb) FROM PUBLIC;

-- Bounded, transient inputs for the recommendation policy. No decision,
-- exposure, preference, student fact or evaluation table is introduced.
CREATE FUNCTION origen_recommendation_selection_inputs(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; student text:=input->>'studentId';
 focus jsonb:=input->'focus'; resolved jsonb; selected jsonb; duplicates jsonb:='[]'; catalog jsonb; outcomes jsonb; episodes jsonb; evidence jsonb;
 p origen_plans%ROWTYPE; s origen_plan_steps%ROWTYPE; response jsonb; choice jsonb; target jsonb; episode_ids uuid[]; snapshot jsonb; scope_needed boolean:=false;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 IF coalesce(current_setting('origen.recommendations',true),'false')<>'true' THEN RETURN '{"error":"recommendation_paused"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT(input ?& ARRAY['studentId','intent','goal','process','focus','episodes'])
  OR input-ARRAY['studentId','intent','goal','process','focus','episodes']<>'{}'
  OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(student) NOT BETWEEN 1 AND 128 OR student<>btrim(student) OR student ~ '[[:cntrl:]]'
  OR coalesce(input->>'intent','') NOT IN ('next_action','revisit_action')
  OR input->'goal'<>'null'::jsonb AND coalesce(input->>'goal','') NOT IN ('understand_requirement','prepare_document','submit_document','check_decision')
  OR input->'process'<>'null'::jsonb AND coalesce(input->>'process','') NOT IN ('office_contact','aid_documents','insurance_waiver')
  OR jsonb_typeof(input->'episodes') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'episodes')>8 THEN RETURN '{"error":"invalid_recommendation_selection"}'; END IF;
 IF input->>'intent'='revisit_action' AND focus='null'::jsonb THEN RETURN '{"error":"invalid_recommendation_selection"}'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'episodes') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR NOT(e ?& ARRAY['id','version']) OR e-ARRAY['id','version']<>'{}'
  OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR e->>'id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR jsonb_typeof(e->'version') IS DISTINCT FROM 'number' OR e->>'version' !~ '^[1-9][0-9]*$' OR (e->>'version')::numeric>2147483647)
  OR (SELECT count(DISTINCT lower(e->>'id')) FROM jsonb_array_elements(input->'episodes') e)<>jsonb_array_length(input->'episodes')
  OR jsonb_array_length(input->'episodes')>0 AND focus->>'kind' IS DISTINCT FROM 'accepted-action' THEN RETURN '{"error":"invalid_recommendation_selection"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor;
 IF owner IS NULL OR NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"status":"unavailable"}'; END IF;
 -- Do not inherit a broader context setting from a nested caller. These reads
 -- need the exact advice, not its family/student discussion or shared evidence.
 PERFORM set_config('origen.outcome_context','false',true);
 IF focus<>'null'::jsonb THEN
  IF coalesce(focus->>'kind','') NOT IN ('accepted-action','review-response') THEN RETURN '{"error":"invalid_recommendation_selection"}'; END IF;
  resolved:=origen_recommendation_source_command(jsonb_build_object('action','resolve-source','contractVersion',1,'purpose','personal_guidance','studentId',student,'source',focus));
  IF resolved ? 'error' THEN RETURN resolved; END IF;
  IF resolved->>'status' IS DISTINCT FROM 'current' THEN RETURN '{"status":"unavailable"}'; END IF;
  IF focus->>'kind'='accepted-action' THEN
   SELECT * INTO p FROM origen_plans WHERE account_id=owner AND student_id=student AND id=(focus->>'planId')::uuid;
   SELECT * INTO s FROM origen_plan_steps WHERE account_id=owner AND plan_id=p.id AND id=focus->>'stepId';
   IF p.id IS NULL OR s.id IS NULL OR p.version<>(focus->>'planVersion')::integer THEN RETURN '{"status":"unavailable"}'; END IF;
   selected:=jsonb_build_object('source',focus,'sourceRevision',resolved->>'sourceRevision','action',s.action,'updatedAt',p.updated_at,
    'state',CASE WHEN p.status<>'active' THEN 'archived' WHEN s.status='complete' THEN 'complete' WHEN s.status='deferred' THEN 'deferred' WHEN s.status IN ('not-started','in-progress') THEN 'available' ELSE 'unavailable' END,
    'personalTargetDate',to_char(s.due_date,'YYYY-MM-DD'),'attribution','student_accepted');
  ELSE
   response:=origen_review_response_context_command(jsonb_build_object('action','read','studentId',student,'source',focus-'organizationId','mode','focus'));
   IF response->>'status' IS DISTINCT FROM 'retrieved' OR response->'response'->>'availability' IS DISTINCT FROM 'current' THEN RETURN '{"status":"unavailable"}'; END IF;
   choice:=origen_review_response_choice_command(jsonb_build_object('action','load','studentId',student,'source',focus-'organizationId'));
   IF choice ? 'error' OR choice->>'availability'<>'current' THEN RETURN '{"status":"unavailable"}'; END IF;
   selected:=jsonb_build_object('source',focus,'sourceRevision',resolved->>'sourceRevision','action',response->'response'->>'suggestedAction',
    'authorName',response->'response'->'author'->>'name','updatedAt',response->'response'->'updatedAt',
    'state',CASE WHEN choice->'choice'->>'state'='deferred' THEN 'deferred' WHEN (choice->>'acceptedActionCount')::integer>0 THEN 'accepted_elsewhere' ELSE 'available' END,
    'personalTargetDate',NULL,'attribution','coordinator_suggestion','choice',choice-'source'-'authorName');
  END IF;
 END IF;
 IF jsonb_array_length(input->'episodes')>0 THEN
  IF coalesce(current_setting('origen.recommendation_outcomes',true),'false')<>'true' THEN RETURN '{"status":"unavailable"}'; END IF;
  target:=origen_student_follow_up_target(owner,p.id,s.id);
  IF target IS NULL OR target->>'studentId' IS DISTINCT FROM student OR target->>'permitted' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true' OR (target->>'validUntil')::timestamptz<=clock_timestamp() THEN RETURN '{"status":"unavailable"}'; END IF;
  SELECT array_agg((e->>'id')::uuid) INTO episode_ids FROM jsonb_array_elements(input->'episodes') e;
  SELECT coalesce(jsonb_agg(to_jsonb(e)-ARRAY['account_id','action_hash'] ORDER BY e.id),'[]') INTO episodes FROM origen_outcome_episodes e
   WHERE e.account_id=owner AND e.student_id=student AND e.plan_id=p.id AND e.step_id=s.id AND e.id=ANY(episode_ids)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(input->'episodes') ref WHERE (ref->>'id')::uuid=e.id AND (ref->>'version')::integer=e.version);
  IF jsonb_array_length(episodes)<>jsonb_array_length(input->'episodes') THEN RETURN '{"status":"unavailable"}'; END IF;
  IF EXISTS(SELECT 1 FROM origen_outcome_episodes e WHERE e.account_id=owner AND e.id=ANY(episode_ids) AND (e.state<>'current' OR e.action_hash<>target->>'actionHash' OR e.valid_until<=clock_timestamp()
   OR e.request_id<>(target->'source'->>'requestId')::uuid OR e.response_version<>(target->'source'->>'responseVersion')::integer)) THEN RETURN '{"status":"unavailable"}'; END IF;
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.id),'[]') INTO evidence FROM (
   SELECT e.id,to_jsonb(e)-'account_id' AS item FROM origen_outcome_evidence e JOIN origen_student_follow_up_reports r ON r.account_id=e.account_id AND r.id=e.report_id AND r.version=e.report_version
    WHERE e.account_id=owner AND e.episode_id=ANY(episode_ids) AND r.student_id=student AND r.plan_id=p.id AND r.step_id=s.id ORDER BY e.id LIMIT 101) x;
  IF jsonb_array_length(evidence)>100 THEN RETURN '{"status":"unavailable","reason":"limit_exceeded"}'; END IF;
  outcomes:=jsonb_build_object('episodes',episodes,'evidence',evidence,'definitions',(SELECT jsonb_agg(contract ORDER BY id,version) FROM origen_outcome_definitions));
 END IF;
 IF input->>'intent'='next_action' THEN
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.plan,x.step),'[]') INTO duplicates FROM (
   SELECT p2.id AS plan,s2.id AS step,jsonb_build_object('action',s2.action,
    'state',CASE WHEN p2.status<>'active' THEN 'archived' WHEN s2.status='complete' THEN 'complete' WHEN s2.status='deferred' THEN 'deferred' ELSE 'active' END) AS item
   FROM origen_plans p2 JOIN origen_plan_steps s2 ON s2.account_id=p2.account_id AND s2.plan_id=p2.id WHERE p2.account_id=owner AND p2.student_id=student ORDER BY p2.id,s2.position,s2.id LIMIT 51) x;
  IF jsonb_array_length(duplicates)>50 THEN RETURN '{"status":"unavailable","reason":"limit_exceeded"}'; END IF;
  IF input->'process'<>'null'::jsonb THEN
   -- Until a server-owned campus/term + official applicability receipt exists,
   -- institution-specific policies stay out of selection. Profile school text,
   -- outcome labels and coordinator organizations cannot supply such a receipt.
   catalog:=origen_recommendation_catalog_command(jsonb_build_object('studentId',student,'process',input->>'process','campus',NULL,'term',NULL));
   IF catalog->>'status' IS DISTINCT FROM 'reviewed' THEN RETURN jsonb_build_object('status','unavailable','reason',CASE WHEN catalog->>'reason'='catalog_limit' THEN 'limit_exceeded' ELSE 'source_unavailable' END); END IF;
   SELECT EXISTS(SELECT 1 FROM origen_recommendation_templates t WHERE t.published->>'process'=input->>'process' AND t.published->>'goal'=input->>'goal' AND t.published->>'mode'='institution_requirement' AND origen_recommendation_template_current(t.teaching_id) IS NOT NULL) INTO scope_needed;
  END IF;
 END IF;
 snapshot:=jsonb_build_object('accountScope',jsonb_build_array(owner,student),'selected',selected,'outcomes',outcomes,'duplicates',duplicates,'templates',coalesce(catalog->'entries','[]'::jsonb),'requiresScope',scope_needed,
  'permission',(SELECT jsonb_build_array(revision,permission_expires_at) FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')));
 IF octet_length(snapshot::text)>120000 THEN RETURN '{"status":"unavailable","reason":"limit_exceeded"}'; END IF;
 RETURN jsonb_build_object('status','current','revision',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),'inputs',snapshot-ARRAY['permission','accountScope']);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN '{"error":"invalid_recommendation_selection"}';
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_recommendation_selection_inputs(jsonb) SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_recommendation_selection_inputs(jsonb) FROM PUBLIC;

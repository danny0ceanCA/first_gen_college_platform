-- Temporary approval metadata contains references and hashes, never a copy of
-- suggested prose or transcripts. Accepted provenance follows canonical plans.
CREATE TABLE origen_recommendation_previews (
 account_id uuid NOT NULL, id uuid NOT NULL, student_id text NOT NULL,
 request jsonb NOT NULL, reported_facts jsonb NOT NULL, guard jsonb NOT NULL,
 source jsonb NOT NULL, source_revision text NOT NULL, action_hash text NOT NULL,
 session_id uuid, selection_sequence integer, approval_sequence integer,
 readback_hash text, presented boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,session_id) REFERENCES origen_live_memory_sessions(account_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX recommendation_one_preview ON origen_recommendation_previews(account_id,student_id);
CREATE INDEX recommendation_preview_expiry ON origen_recommendation_previews(expires_at);
CREATE TABLE origen_plan_recommendations (
 account_id uuid NOT NULL, id uuid NOT NULL, student_id text NOT NULL,
 plan_id uuid NOT NULL, step_id text NOT NULL, plan_version integer NOT NULL,
 source jsonb NOT NULL, source_revision text NOT NULL, policy_version text NOT NULL,
 goal text NOT NULL, process text NOT NULL, language text NOT NULL,
 action_hash text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id), UNIQUE(account_id,plan_id,step_id),
 FOREIGN KEY(account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_recommendation_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_plan_recommendations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_recommendation_previews,origen_plan_recommendations FROM PUBLIC;

CREATE FUNCTION origen_recommendation_delivery_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; student text:=input->>'studentId';
 action text:=input->>'action'; p origen_recommendation_previews%ROWTYPE; l origen_plan_recommendations%ROWTYPE;
 s origen_live_memory_sessions%ROWTYPE; resolved jsonb; plan origen_plans%ROWTYPE; step origen_plan_steps%ROWTYPE;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 IF action='prune' THEN
  DELETE FROM origen_plan_recommendations r WHERE r.account_id=owner AND r.plan_id=(input->>'planId')::uuid AND NOT EXISTS(SELECT 1 FROM origen_plan_steps x WHERE x.account_id=owner AND x.plan_id=r.plan_id AND x.id=r.step_id);
  RETURN '{"status":"pruned"}';
 END IF;
 IF action IN ('sources','export') THEN
  RETURN jsonb_build_object('links',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'studentId',r.student_id,'planId',r.plan_id,'stepId',r.step_id,'acceptedPlanVersion',r.plan_version,'source',r.source,'sourceRevision',r.source_revision,'policyVersion',r.policy_version,'goal',r.goal,'process',r.process,'language',r.language,'acceptedAt',r.accepted_at,
   'wordingChanged',r.action_hash<>encode(sha256(convert_to(x.action,'UTF8')),'hex'),
   'availability',CASE WHEN coalesce(current_setting('origen.recommendations',true),'false')='true' AND origen_recommendation_source_command(jsonb_build_object('action','resolve-source','contractVersion',1,'purpose','personal_guidance','studentId',r.student_id,'source',r.source))->>'sourceRevision'=r.source_revision THEN 'current' ELSE 'historical' END) ORDER BY r.accepted_at)
   FROM origen_plan_recommendations r JOIN origen_plan_steps x ON x.account_id=r.account_id AND x.plan_id=r.plan_id AND x.id=r.step_id WHERE r.account_id=owner),'[]'::jsonb));
 END IF;
 IF input ? 'sessionId' THEN
  SELECT * INTO s FROM origen_live_memory_sessions WHERE account_id=owner AND id=(input->>'sessionId')::uuid FOR UPDATE;
  IF s.id IS NULL OR s.closed OR s.expires_at<=clock_timestamp() OR s.student_id IS NULL THEN RETURN '{"error":"recommendation_session_changed"}'; END IF;
  student:=s.student_id;
  IF s.turn_sequence IS DISTINCT FROM (input->>'sequence')::integer OR s.turn_id IS DISTINCT FROM input->>'turnId' OR s.transcript_hash IS DISTINCT FROM encode(sha256(convert_to(input->>'transcript','UTF8')),'hex') OR coalesce(length(input->>'transcript'),0)=0 THEN RETURN '{"error":"recommendation_turn_changed"}'; END IF;
  IF action<>'attach' AND s.revision<>coalesce((SELECT revision FROM origen_memory_scopes WHERE account_id=owner AND scope_key=student),0) THEN RETURN '{"error":"recommendation_context_changed"}'; END IF;
 END IF;
 IF action='legacy-check' THEN RETURN jsonb_build_object('blocked',EXISTS(SELECT 1 FROM origen_recommendation_previews WHERE account_id=owner AND student_id=student AND session_id=s.id AND expires_at>clock_timestamp())); END IF;
 IF NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 IF action='voice-context' THEN RETURN jsonb_build_object('studentId',student,'language',s.turn_language,'sequence',s.turn_sequence,'focus',CASE WHEN s.review_response_focus IS NOT NULL THEN jsonb_build_object('kind','review-response','requestId',s.review_response_focus,'responseVersion',s.review_response_focus_version,'organizationId',(SELECT institution_id FROM origen_review_requests WHERE account_id=owner AND id=s.review_response_focus)) END); END IF;
 IF action='resolve-focus' THEN
  SELECT jsonb_build_object('kind','review-response','requestId',r.id,'responseVersion',input->'source'->'responseVersion','organizationId',r.institution_id) INTO resolved FROM origen_review_requests r WHERE r.account_id=owner AND r.student_id=student AND r.id=(input->'source'->>'requestId')::uuid;
  RETURN jsonb_build_object('source',resolved);
 END IF;
 -- Recovery is a read of an already accepted canonical record, not renewed
 -- authorization. It remains available after a feature pause/source withdrawal.
 IF action='receipt' THEN
  SELECT * INTO l FROM origen_plan_recommendations WHERE account_id=owner AND student_id=student AND id=(input->>'id')::uuid;
  IF l.id IS NULL THEN RETURN '{"status":"not_saved"}'; END IF;
  IF NOT EXISTS(SELECT 1 FROM origen_plan_steps WHERE account_id=owner AND plan_id=l.plan_id AND id=l.step_id) THEN RETURN '{"status":"removed"}'; END IF;
  RETURN jsonb_build_object('status','saved','target',jsonb_build_object('planId',l.plan_id,'stepId',l.step_id),'recommendationId',l.id);
 END IF;
 DELETE FROM origen_recommendation_previews WHERE (account_id,id) IN (SELECT account_id,id FROM origen_recommendation_previews WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 1000);
 IF action='cancel' THEN
  DELETE FROM origen_recommendation_previews WHERE account_id=owner AND student_id=student AND (input->'all'='true'::jsonb OR s.id IS NULL AND session_id IS NULL AND id=(input->>'id')::uuid OR s.id IS NOT NULL AND session_id=s.id);
  RETURN '{"status":"dismissed"}';
 END IF;
 IF coalesce(current_setting('origen.recommendations',true),'false')<>'true' THEN RETURN '{"error":"recommendation_paused"}'; END IF;
 IF action='prepare' THEN
  IF input->'request'->>'studentId' IS DISTINCT FROM student OR input->'guard'->>'policyVersion' IS DISTINCT FROM 'evidence-informed-v1' OR input->>'actionHash' !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"invalid_recommendation_preview"}'; END IF;
  resolved:=origen_recommendation_source_command(jsonb_build_object('action','resolve-source','contractVersion',1,'purpose','personal_guidance','studentId',student,'source',input->'source'));
  IF resolved->>'status' IS DISTINCT FROM 'current' OR resolved->>'sourceRevision' IS DISTINCT FROM input->>'sourceRevision' THEN RETURN '{"error":"recommendation_source_changed"}'; END IF;
  DELETE FROM origen_recommendation_previews WHERE account_id=owner AND student_id=student;
  INSERT INTO origen_recommendation_previews(account_id,id,student_id,request,reported_facts,guard,source,source_revision,action_hash,session_id,selection_sequence)
   VALUES(owner,(input->>'id')::uuid,student,input->'request',input->'reportedFacts',input->'guard',input->'source',input->>'sourceRevision',input->>'actionHash',s.id,s.turn_sequence) RETURNING * INTO p;
 ELSE
  IF s.id IS NOT NULL THEN SELECT * INTO p FROM origen_recommendation_previews WHERE account_id=owner AND student_id=student AND session_id=s.id FOR UPDATE;
  ELSE SELECT * INTO p FROM origen_recommendation_previews WHERE account_id=owner AND student_id=student AND id=(input->>'id')::uuid AND session_id IS NULL FOR UPDATE; END IF;
  -- Expiration is an authorization boundary, independent of bounded cleanup.
  IF p.id IS NULL OR p.expires_at<=clock_timestamp() THEN RETURN '{"error":"recommendation_preview_changed"}'; END IF;
 END IF;
 IF action='bind' THEN
  IF s.id IS NULL OR s.turn_sequence NOT IN (p.selection_sequence,p.selection_sequence+1) OR input->>'readbackHash' !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"recommendation_turn_changed"}'; END IF;
  UPDATE origen_recommendation_previews SET approval_sequence=s.turn_sequence,readback_hash=input->>'readbackHash',presented=false WHERE account_id=owner AND id=p.id;
  RETURN '{"status":"readback_required"}';
 ELSIF action='present' THEN
  IF s.id IS NULL OR s.turn_sequence IS DISTINCT FROM p.approval_sequence THEN RETURN '{"error":"recommendation_turn_changed"}'; END IF;
  UPDATE origen_recommendation_previews SET presented=(readback_hash IS NOT NULL AND readback_hash=input->>'presentationHash') WHERE account_id=owner AND id=p.id;
  RETURN '{"status":"observed"}';
 ELSIF action='approval' THEN
  IF s.id IS NULL OR s.turn_sequence IS DISTINCT FROM p.approval_sequence+1 OR NOT p.presented OR input->'accepted' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"recommendation_approval_required"}'; END IF;
 ELSIF action='attach' THEN
  IF s.id IS NOT NULL AND (s.turn_sequence IS DISTINCT FROM p.approval_sequence+1 OR NOT p.presented) THEN RETURN '{"error":"recommendation_approval_required"}'; END IF;
  IF p.source->>'kind'='accepted-action' THEN RETURN '{"error":"recommendation_already_saved"}'; END IF;
  resolved:=origen_recommendation_source_command(jsonb_build_object('action','resolve-source','contractVersion',1,'purpose','personal_guidance','studentId',student,'source',p.source));
  IF resolved->>'sourceRevision' IS DISTINCT FROM p.source_revision THEN RETURN '{"error":"recommendation_source_changed"}'; END IF;
  SELECT * INTO plan FROM origen_plans WHERE account_id=owner AND id=(input->>'planId')::uuid AND student_id=student;
  SELECT * INTO step FROM origen_plan_steps WHERE account_id=owner AND plan_id=plan.id AND id=input->>'stepId';
  IF plan.id IS NULL OR step.id IS NULL OR step.status<>'not-started' OR p.action_hash<>encode(sha256(convert_to(step.action,'UTF8')),'hex') THEN RETURN '{"error":"recommendation_action_changed"}'; END IF;
  INSERT INTO origen_plan_recommendations(account_id,id,student_id,plan_id,step_id,plan_version,source,source_revision,policy_version,goal,process,language,action_hash)
   VALUES(owner,p.id,student,plan.id,step.id,plan.version,p.source,p.source_revision,'evidence-informed-v1',p.request->>'goal',p.request->>'process',p.request->>'language',p.action_hash);
  DELETE FROM origen_recommendation_previews WHERE account_id=owner AND id=p.id;
  RETURN jsonb_build_object('status','saved','target',jsonb_build_object('planId',plan.id,'stepId',step.id),'recommendationId',p.id);
 ELSIF action NOT IN ('prepare','get') THEN RETURN '{"error":"invalid_recommendation_command"}';
 END IF;
 RETURN jsonb_build_object('id',p.id,'request',p.request,'reportedFacts',p.reported_facts,'guard',p.guard,'source',p.source,'sourceRevision',p.source_revision,'actionHash',p.action_hash,'expiresAt',p.expires_at);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_recommendation_command"}';
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_recommendation_delivery_command(jsonb) SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_recommendation_delivery_command(jsonb) FROM PUBLIC;

CREATE FUNCTION origen_recommendation_acceptance_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM origen_recommendation_previews $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_recommendation_acceptance_after_restore() SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_recommendation_acceptance_after_restore() FROM PUBLIC;
CREATE FUNCTION origen_recommendation_purge() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
 DELETE FROM origen_recommendation_previews WHERE (account_id,id) IN (SELECT account_id,id FROM origen_recommendation_previews WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 1000);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_recommendation_purge() SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_recommendation_purge() FROM PUBLIC;

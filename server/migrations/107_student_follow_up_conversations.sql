-- Exact private proposals are temporary. Durable receipts keep identifiers and
-- hashes only; neither model arguments nor a transcript are approval evidence.
CREATE TABLE origen_follow_up_proposals (
 account_id uuid NOT NULL, id uuid NOT NULL, student_id text NOT NULL,
 plan_id uuid NOT NULL, step_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('check-in','report')),
 plan_version integer NOT NULL, action_hash text NOT NULL, valid_until timestamptz NOT NULL,
 payload jsonb, input_hash text NOT NULL, digest text NOT NULL,
 session_id uuid, turn_sequence integer, readback_hash text, presented boolean NOT NULL DEFAULT false,
 result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id,plan_id,step_id) REFERENCES origen_student_follow_ups(account_id,student_id,plan_id,step_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,session_id) REFERENCES origen_live_memory_sessions(account_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX follow_up_one_voice_proposal ON origen_follow_up_proposals(account_id,session_id,turn_sequence) WHERE session_id IS NOT NULL;
ALTER TABLE origen_follow_up_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_follow_up_proposals FROM PUBLIC;

CREATE TABLE origen_follow_up_voice_stops (
 account_id uuid NOT NULL, session_id uuid NOT NULL, turn_sequence integer NOT NULL,
 PRIMARY KEY(account_id,session_id,turn_sequence),
 FOREIGN KEY(account_id,session_id) REFERENCES origen_live_memory_sessions(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_follow_up_voice_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_follow_up_voice_stops FROM PUBLIC;

-- All report mutations invalidate provider snapshots. Reports never enter
-- topic notes, summary extraction, progress/helpfulness analytics or outboxes.
CREATE TRIGGER follow_up_report_changed AFTER UPDATE OR DELETE ON origen_student_follow_up_reports FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();
CREATE FUNCTION origen_follow_up_report_inserted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES(NEW.account_id,NEW.student_id,NEW.student_id)
 ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1;
 RETURN NEW;
END $$;
CREATE TRIGGER follow_up_report_inserted AFTER INSERT ON origen_student_follow_up_reports FOR EACH ROW EXECUTE FUNCTION origen_follow_up_report_inserted();

CREATE FUNCTION origen_follow_up_conversation_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; student text:=input->>'studentId';
 action text:=input->>'action'; plan uuid; step text; target jsonb; p origen_follow_up_proposals%ROWTYPE;
 s origen_live_memory_sessions%ROWTYPE; r origen_student_follow_up_reports%ROWTYPE;
 body jsonb; answer jsonb; fingerprint text; next_id uuid; next_version integer; plan_version integer; report jsonb;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"follow_up_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"follow_up_denied"}'; END IF;
 IF input ? 'sessionId' THEN
  SELECT * INTO s FROM origen_live_memory_sessions WHERE account_id=owner AND id=(input->>'sessionId')::uuid FOR UPDATE;
  IF s.id IS NULL OR s.closed OR s.expires_at<=clock_timestamp() OR s.student_id IS NULL THEN RETURN '{"error":"follow_up_session_changed"}'; END IF;
  student:=s.student_id;
  IF (SELECT role FROM origen_accounts WHERE id=owner)<>'student' THEN RETURN '{"error":"follow_up_denied"}'; END IF;
  IF action<>'context' AND (s.turn_sequence IS DISTINCT FROM (input->>'sequence')::integer OR s.turn_id IS DISTINCT FROM input->>'turnId'
   OR s.transcript_hash IS DISTINCT FROM encode(sha256(convert_to(input->>'transcript','UTF8')),'hex') OR coalesce(length(input->>'transcript'),0)=0) THEN RETURN '{"error":"follow_up_turn_changed"}'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"follow_up_unavailable"}'; END IF;
 IF action='context' THEN
  -- Only the application's negotiated conversation can supply the current item.
  RETURN jsonb_build_object('studentId',student,'language',s.turn_language,'sequence',s.turn_sequence,
   'focus',(SELECT jsonb_build_object('planId',o.plan_id,'stepId',o.step_id) FROM origen_conversation_openings o
    WHERE o.account_id=owner AND o.memory_session_id=s.id AND o.kind='student-follow-up' AND o.plan_id IS NOT NULL AND o.state IN ('presented','deferred') AND s.turn_sequence=o.initial_sequence+1 ORDER BY o.created_at DESC LIMIT 1));
 END IF;
 IF action='stop' THEN
  IF s.id IS NULL THEN RETURN '{"error":"follow_up_denied"}'; END IF;
  IF EXISTS(SELECT 1 FROM origen_follow_up_voice_stops WHERE account_id=owner AND session_id=s.id AND turn_sequence=s.turn_sequence) THEN RETURN '{"status":"stopped"}'; END IF;
  IF input->'target'='null'::jsonb THEN
   answer:=origen_student_follow_up_controls(jsonb_build_object('action','stop-all','studentId',student,'operationId',input->'operationId'));
  ELSE
   answer:=origen_student_follow_up_command(jsonb_build_object('action','load','studentId',student,'target',input->'target'));
   IF answer ? 'error' THEN RETURN answer; END IF;
   answer:=origen_student_follow_up_command(jsonb_build_object('action','stop','studentId',student,'target',input->'target','operationId',input->'operationId','revision',answer->'revision'));
  END IF;
  IF answer ? 'error' THEN RETURN answer; END IF;
  DELETE FROM origen_follow_up_proposals WHERE account_id=owner AND kind='check-in' AND result IS NULL AND
   (input->'target'='null'::jsonb OR (plan_id=(input->'target'->>'planId')::uuid AND step_id=input->'target'->>'stepId'));
  INSERT INTO origen_follow_up_voice_stops VALUES(owner,s.id,s.turn_sequence);
  RETURN '{"status":"stopped"}';
 END IF;
 IF action='choices' THEN
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(x.item) FROM (
   SELECT jsonb_build_object('target',jsonb_build_object('planId',l.plan_id,'stepId',l.step_id),'title',t->'action'->'title',
    'planVersion',t->'planVersion','revision',coalesce(f.revision,0),'canEnroll',t->>'active'='true' AND t->>'sourceCurrent'='true' AND t->>'permitted'='true') AS item
   FROM origen_review_response_plan_links l LEFT JOIN origen_student_follow_ups f ON f.account_id=l.account_id AND f.plan_id=l.plan_id AND f.step_id=l.step_id
   CROSS JOIN LATERAL (SELECT origen_student_follow_up_target(owner,l.plan_id,l.step_id) t) v
   WHERE l.account_id=owner AND l.student_id=student ORDER BY l.plan_id,l.step_id LIMIT 21) x),'[]'::jsonb));
 END IF;
 IF action IN ('bind','present','confirm','verify') THEN
  IF s.id IS NOT NULL THEN
   SELECT * INTO p FROM origen_follow_up_proposals WHERE account_id=owner AND session_id=s.id
    AND turn_sequence=CASE WHEN action='confirm' THEN s.turn_sequence-1 ELSE s.turn_sequence END;
  ELSE SELECT * INTO p FROM origen_follow_up_proposals WHERE account_id=owner AND id=(input->>'previewId')::uuid AND session_id IS NULL;
  END IF;
  IF p.id IS NULL OR p.student_id<>student THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
  plan:=p.plan_id;step:=p.step_id;
 ELSE plan:=(input->'target'->>'planId')::uuid;step:=input->'target'->>'stepId'; END IF;
 IF action='confirm' AND p.result IS NOT NULL THEN
  IF s.id IS NULL AND input->>'digest' IS DISTINCT FROM p.digest THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
  IF p.kind='report' THEN
   IF NOT EXISTS(SELECT 1 FROM origen_student_follow_up_reports WHERE account_id=owner AND id=(p.result->>'reportId')::uuid AND version=(p.result->>'version')::integer) THEN RETURN '{"status":"superseded"}'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=plan AND step_id=step AND state='scheduled' AND revision=(p.result->>'revision')::integer) THEN RETURN '{"status":"superseded"}'; END IF;
  END IF;
  RETURN p.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_review_response_plan_links WHERE account_id=owner AND student_id=student AND plan_id=plan AND step_id=step) THEN RETURN '{"error":"follow_up_unavailable"}'; END IF;
 -- Consistent ordering with source writers; owner lock serializes approvals.
 PERFORM 1 FROM origen_plans WHERE account_id=owner AND id=plan FOR UPDATE;
 PERFORM 1 FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
 PERFORM 1 FROM origen_review_requests WHERE id=(SELECT request_id FROM origen_review_response_plan_links WHERE account_id=owner AND plan_id=plan AND step_id=step) FOR SHARE;
 PERFORM 1 FROM origen_review_request_responses WHERE request_id=(SELECT request_id FROM origen_review_response_plan_links WHERE account_id=owner AND plan_id=plan AND step_id=step) FOR SHARE;
 IF p.id IS NOT NULL THEN
  SELECT * INTO p FROM origen_follow_up_proposals WHERE account_id=owner AND id=p.id FOR UPDATE;
  IF p.id IS NULL THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
 END IF;
 target:=origen_student_follow_up_target(owner,plan,step);
 IF target IS NULL OR target->>'studentId'<>student THEN RETURN '{"error":"follow_up_unavailable"}'; END IF;
 IF action='load' THEN
  RETURN jsonb_build_object('target',input->'target','title',target->'action'->'title','planVersion',target->'planVersion',
   'canSave',target->>'sourceCurrent'='true' AND target->>'permitted'='true',
   'reports',coalesce((SELECT jsonb_agg(to_jsonb(v)-'account_id' ORDER BY v.recorded_at DESC,v.id) FROM origen_student_follow_up_reports v WHERE account_id=owner AND plan_id=plan AND step_id=step),'[]'::jsonb));
 END IF;
 IF coalesce(current_setting('origen.student_follow_up',true),'false')<>'true' THEN RETURN '{"error":"follow_up_paused"}'; END IF;
 IF (SELECT role FROM origen_accounts WHERE id=owner)<>'student' OR target->>'sourceCurrent' IS DISTINCT FROM 'true' OR target->>'permitted' IS DISTINCT FROM 'true' THEN RETURN '{"error":"follow_up_unavailable"}'; END IF;
 IF s.id IS NOT NULL AND s.revision<>coalesce((SELECT revision FROM origen_memory_scopes WHERE account_id=owner AND scope_key=student),0) THEN RETURN '{"error":"follow_up_context_changed"}'; END IF;
 IF action='prepare' THEN
  IF (input->>'planVersion')::integer IS DISTINCT FROM (target->>'planVersion')::integer THEN RETURN '{"error":"follow_up_action_changed"}'; END IF;
  IF input->>'kind'='report' AND input->'payload'->>'reportId' IS NULL AND (SELECT count(*) FROM origen_student_follow_up_reports WHERE account_id=owner AND plan_id=plan AND step_id=step)>=100 THEN RETURN '{"error":"follow_up_limit_changed"}'; END IF;
  IF input->>'kind' NOT IN ('check-in','report') THEN RETURN '{"error":"invalid_follow_up"}'; END IF;
  fingerprint:=encode(sha256(convert_to((input-'operationId')::text,'UTF8')),'hex');
  DELETE FROM origen_follow_up_proposals WHERE account_id=owner AND expires_at<=clock_timestamp() AND result IS NULL;
  SELECT * INTO p FROM origen_follow_up_proposals WHERE account_id=owner AND id=(input->>'operationId')::uuid;
  IF p.id IS NOT NULL THEN
   IF p.input_hash<>fingerprint OR p.result IS NOT NULL THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
  ELSE
   IF (SELECT count(*) FROM origen_follow_up_proposals WHERE account_id=owner AND result IS NULL)>=40 THEN RETURN '{"error":"follow_up_limit_changed"}'; END IF;
   IF s.id IS NOT NULL AND EXISTS(SELECT 1 FROM origen_follow_up_proposals WHERE account_id=owner AND session_id=s.id AND turn_sequence=s.turn_sequence) THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
   INSERT INTO origen_student_follow_ups(account_id,student_id,plan_id,step_id,request_id,response_version)
    VALUES(owner,student,plan,step,(target->'source'->>'requestId')::uuid,(target->'source'->>'responseVersion')::integer) ON CONFLICT DO NOTHING;
   body:=input->'payload';
   IF input->>'kind'='check-in' THEN
    answer:=origen_student_follow_up_command(jsonb_build_object('action','prepare','studentId',student,'target',input->'target','operationId',input->'operationId',
     'revision',(SELECT revision FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=plan AND step_id=step),'planVersion',input->'planVersion','schedule',body->'schedule','language',input->>'language'));
    IF answer ? 'error' THEN RETURN answer; END IF;
    body:=jsonb_build_object('enrollment',answer->'preview');
   ELSE
    report:=body->'report';
    IF report IS NULL OR report->>'provenance'<>'student_reported' OR report->>'definitionVersion'<>'1' OR report->>'responseState' NOT IN ('answered','declined','unknown')
     OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=report->>'timeZone') OR length(report->>'detail')>2000
     OR (report->>'occurredOn')::date>(clock_timestamp() AT TIME ZONE (report->>'timeZone'))::date THEN RETURN '{"error":"invalid_follow_up"}'; END IF;
    IF body->>'reportId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_student_follow_up_reports WHERE account_id=owner AND id=(body->>'reportId')::uuid AND plan_id=plan AND step_id=step AND version=(body->>'reportVersion')::integer) THEN RETURN '{"error":"follow_up_report_changed"}'; END IF;
    IF body->>'planStatus' IS NOT NULL AND body->>'planStatus' NOT IN ('not-started','in-progress','complete','deferred') THEN RETURN '{"error":"invalid_follow_up"}'; END IF;
   END IF;
   INSERT INTO origen_follow_up_proposals(account_id,id,student_id,plan_id,step_id,kind,plan_version,action_hash,valid_until,payload,input_hash,digest,session_id,turn_sequence)
    VALUES(owner,(input->>'operationId')::uuid,student,plan,step,input->>'kind',(target->>'planVersion')::integer,target->>'actionHash',(target->>'validUntil')::timestamptz,
     body,fingerprint,encode(sha256(convert_to(fingerprint||gen_random_uuid()::text,'UTF8')),'hex'),s.id,s.turn_sequence) RETURNING * INTO p;
  END IF;
  RETURN jsonb_build_object('preview',jsonb_build_object('id',p.id,'digest',p.digest,'expiresAt',p.expires_at,'kind',p.kind,'action',target->'action','source',target->'source','payload',p.payload,'language',input->>'language'));
 END IF;
 IF p.expires_at<=clock_timestamp() OR p.valid_until<=clock_timestamp() OR p.plan_version<>(target->>'planVersion')::integer OR p.action_hash<>target->>'actionHash' THEN RETURN '{"error":"follow_up_action_changed"}'; END IF;
 IF action='bind' THEN
  IF p.readback_hash IS NOT NULL AND p.readback_hash IS DISTINCT FROM input->>'readbackHash' THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
  UPDATE origen_follow_up_proposals SET readback_hash=input->>'readbackHash' WHERE account_id=owner AND id=p.id;
  RETURN '{"status":"bound"}';
 ELSIF action='present' THEN
  UPDATE origen_follow_up_proposals SET presented=(readback_hash IS NOT NULL AND readback_hash=input->>'presentationHash') WHERE account_id=owner AND id=p.id;
  RETURN '{"status":"recorded"}';
 ELSIF action='verify' THEN RETURN '{"status":"current"}';
 ELSIF action<>'confirm' THEN RETURN '{"error":"invalid_follow_up"}'; END IF;
 IF s.id IS NOT NULL THEN
  IF NOT p.presented OR input->'accepted' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"status":"approval_required"}'; END IF;
 ELSE
  IF input->>'digest' IS DISTINCT FROM p.digest OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"status":"approval_required"}'; END IF;
 END IF;
 IF p.kind='check-in' THEN
  answer:=origen_student_follow_up_command(jsonb_build_object('action','confirm','studentId',student,'target',jsonb_build_object('planId',plan,'stepId',step),
   'operationId',p.id,'previewId',p.payload->'enrollment'->'id','digest',p.payload->'enrollment'->'digest','confirmed',true));
  IF answer ? 'error' THEN RETURN answer; END IF;
  answer:=jsonb_build_object('status','saved','kind','check-in','revision',answer->'revision');
 ELSE
  body:=p.payload;report:=body->'report';next_id:=coalesce((body->>'reportId')::uuid,gen_random_uuid());
  IF body->>'reportId' IS NOT NULL THEN
   SELECT * INTO r FROM origen_student_follow_up_reports WHERE account_id=owner AND id=next_id AND plan_id=plan AND step_id=step FOR UPDATE;
   IF r.id IS NULL OR r.version<>(body->>'reportVersion')::integer THEN RETURN '{"error":"follow_up_report_changed"}'; END IF;
   UPDATE origen_student_follow_up_reports SET version=version+1,response_state=report->>'responseState',reported_action=report->>'reportedAction',reported_outcome=report->>'reportedOutcome',detail=report->>'detail',helpfulness=report->>'helpfulness',occurred_on=(report->>'occurredOn')::date,time_zone=report->>'timeZone',updated_at=clock_timestamp()
    WHERE account_id=owner AND id=next_id RETURNING version INTO next_version;
  ELSE
   INSERT INTO origen_student_follow_up_reports(account_id,student_id,id,plan_id,step_id,response_state,reported_action,reported_outcome,detail,helpfulness,occurred_on,time_zone)
    VALUES(owner,student,next_id,plan,step,report->>'responseState',report->>'reportedAction',report->>'reportedOutcome',report->>'detail',report->>'helpfulness',(report->>'occurredOn')::date,report->>'timeZone') RETURNING version INTO next_version;
  END IF;
  plan_version:=p.plan_version;
  IF body->>'planStatus' IS NOT NULL THEN
   UPDATE origen_plan_steps SET status=body->>'planStatus' WHERE account_id=owner AND plan_id=plan AND id=step;
   UPDATE origen_plans SET version=version+1,updated_at=clock_timestamp() WHERE account_id=owner AND id=plan RETURNING version INTO plan_version;
  END IF;
  answer:=jsonb_build_object('status','saved','kind','report','reportId',next_id,'version',next_version,'planVersion',plan_version);
 END IF;
 UPDATE origen_follow_up_proposals SET result=answer,payload=NULL,readback_hash=NULL,presented=false WHERE account_id=owner AND id=p.id;
 RETURN answer;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_parameter_value OR check_violation THEN RETURN '{"error":"invalid_follow_up"}';
END $$;

-- Losing a permission or source permanently invalidates prepared approval,
-- even if that permission is later restored within the preview lifetime.
CREATE FUNCTION origen_follow_up_pending_invalidated() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid; rid uuid;
BEGIN
 IF TG_TABLE_NAME='origen_accounts' THEN owner:=OLD.id;
 ELSIF TG_TABLE_NAME='origen_eligibility' THEN SELECT id INTO owner FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=OLD.subject_hash;
 ELSE rid:=(to_jsonb(OLD)->>'request_id')::uuid; END IF;
 DELETE FROM origen_follow_up_proposals p WHERE result IS NULL AND (p.account_id=owner OR EXISTS(
  SELECT 1 FROM origen_student_follow_ups f WHERE f.account_id=p.account_id AND f.plan_id=p.plan_id AND f.step_id=p.step_id AND f.request_id=rid));
 RETURN NULL;
END $$;
CREATE TRIGGER follow_up_pending_role AFTER UPDATE OF role ON origen_accounts FOR EACH ROW WHEN(NEW.role IS DISTINCT FROM OLD.role) EXECUTE FUNCTION origen_follow_up_pending_invalidated();
CREATE TRIGGER follow_up_pending_permission AFTER UPDATE OF status,revision,permission_expires_at OR DELETE ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_follow_up_pending_invalidated();
CREATE TRIGGER follow_up_pending_source AFTER UPDATE OR DELETE ON origen_review_request_responses FOR EACH ROW EXECUTE FUNCTION origen_follow_up_pending_invalidated();
CREATE TRIGGER follow_up_pending_publication AFTER UPDATE OF invalidated_at ON origen_review_request_publications FOR EACH ROW WHEN(NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) EXECUTE FUNCTION origen_follow_up_pending_invalidated();

CREATE FUNCTION origen_follow_up_conversations_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM origen_follow_up_proposals; DELETE FROM origen_follow_up_voice_stops; $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_follow_up_pending_invalidated()','origen_follow_up_report_inserted()','origen_follow_up_conversation_command(jsonb)','origen_follow_up_conversations_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

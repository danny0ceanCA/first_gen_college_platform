-- No backfill: an accepted action, due date or response deferral is not consent.
CREATE TABLE origen_student_follow_ups (
 account_id uuid NOT NULL, student_id text NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL,
 request_id uuid NOT NULL, response_version integer NOT NULL CHECK(response_version>0),
 state text NOT NULL DEFAULT 'off' CHECK(state IN ('off','scheduled','paused','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 accepted_plan_version integer, action_hash text, on_or_after date, time_zone text,
 valid_until timestamptz, consented_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 pause_reason text CHECK(pause_reason IN ('student','action_changed','source_changed','permission_changed','restored')),
 PRIMARY KEY(account_id,plan_id,step_id), UNIQUE(account_id,student_id,plan_id,step_id),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_review_response_plan_links(account_id,plan_id,step_id) ON DELETE CASCADE,
 CHECK(state<>'scheduled' OR (consented_at IS NOT NULL AND valid_until IS NOT NULL AND accepted_plan_version IS NOT NULL AND accepted_plan_version>0 AND action_hash IS NOT NULL AND time_zone IS NOT NULL AND pause_reason IS NULL)),
 CHECK(action_hash IS NULL OR action_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX student_follow_up_source ON origen_student_follow_ups(request_id);
CREATE TABLE origen_student_follow_up_previews (
 account_id uuid NOT NULL, id uuid NOT NULL, student_id text NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL,
 request_id uuid NOT NULL, response_version integer NOT NULL, plan_version integer NOT NULL,
 expected_revision integer NOT NULL, action_hash text NOT NULL, input_hash text NOT NULL, digest text NOT NULL,
 on_or_after date, time_zone text NOT NULL, language text NOT NULL CHECK(language IN ('en','es')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', consumed_at timestamptz,
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_review_response_plan_links(account_id,plan_id,step_id) ON DELETE CASCADE
);
CREATE INDEX student_follow_up_preview_target ON origen_student_follow_up_previews(account_id,plan_id,step_id);
CREATE INDEX student_follow_up_preview_source ON origen_student_follow_up_previews(request_id);
CREATE TABLE origen_student_follow_up_receipts (
 account_id uuid NOT NULL, operation_id uuid NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL,
 input_hash text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,operation_id),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_student_follow_ups(account_id,plan_id,step_id) ON DELETE CASCADE
);
-- Reserved owner-only evidence stores. This migration exposes no presentation
-- or report writer; later steps must verify playback and exact student approval.
CREATE TABLE origen_student_follow_up_presentations (
 account_id uuid NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL, enrollment_revision integer NOT NULL CHECK(enrollment_revision>0),
 conversation_id uuid NOT NULL, presented_at timestamptz NOT NULL DEFAULT now(),
 evidence text NOT NULL DEFAULT 'application_playback' CHECK(evidence='application_playback'),
 PRIMARY KEY(account_id,plan_id,step_id,enrollment_revision),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_student_follow_ups(account_id,plan_id,step_id) ON DELETE CASCADE
);
CREATE TABLE origen_student_follow_up_reports (
 account_id uuid NOT NULL, student_id text NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), plan_id uuid NOT NULL, step_id text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), definition_version integer NOT NULL DEFAULT 1 CHECK(definition_version=1),
 response_state text NOT NULL CHECK(response_state IN ('answered','declined','unknown')),
 reported_action text CHECK(reported_action IN ('not_started','attempted','completed','changed_course','unknown')),
 reported_outcome text CHECK(reported_outcome IN ('pending','resolved','unresolved','unknown')),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=2000),
 helpfulness text CHECK(helpfulness IN ('helpful','partly_helpful','not_helpful','unknown')),
 provenance text NOT NULL DEFAULT 'student_reported' CHECK(provenance='student_reported'),
 occurred_on date, time_zone text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id,plan_id,step_id) REFERENCES origen_student_follow_ups(account_id,student_id,plan_id,step_id) ON DELETE CASCADE,
 CHECK((response_state='answered' AND reported_action IS NOT NULL AND reported_outcome IS NOT NULL) OR
  (response_state IN ('declined','unknown') AND reported_action IS NULL AND reported_outcome IS NULL AND detail='' AND helpfulness IS NULL AND occurred_on IS NULL)),
 CHECK(occurred_on IS NULL OR occurred_on<=(recorded_at AT TIME ZONE time_zone)::date)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_student_follow_ups','origen_student_follow_up_previews','origen_student_follow_up_receipts','origen_student_follow_up_presentations','origen_student_follow_up_reports'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 END LOOP;
END $$;

-- Internal target projection, including a hash of the accepted action's current
-- wording/context. Unrelated sibling edits do not transfer or erase consent.
CREATE FUNCTION origen_student_follow_up_target(owner uuid,plan uuid,step text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('studentId',p.student_id,'planVersion',p.version,
  'source',jsonb_build_object('kind','review-response','requestId',l.request_id,'responseVersion',l.response_version),
  'action',jsonb_build_object('title',s.title,'content',s.action,'notes',s.notes,'dueDate',s.due_date),
  'actionHash',encode(sha256(convert_to(jsonb_build_object('student',p.student_id,'planTitle',p.title,'goal',p.goal,'category',p.category,'planStatus',p.status,
   'step',to_jsonb(s)-'account_id'-'plan_id'-'position','sources',coalesce((SELECT jsonb_agg(to_jsonb(x)-'account_id'-'plan_id'-'step_id' ORDER BY position) FROM origen_plan_sources x WHERE x.account_id=owner AND x.plan_id=plan AND x.step_id=step),'[]'::jsonb),
   'request',l.request_id,'responseVersion',l.response_version)::text,'UTF8')),'hex'),
  'active',p.status='active' AND s.status IN ('not-started','in-progress'),
  'sourceCurrent',NOT l.source_detached AND EXISTS(SELECT 1 FROM origen_review_requests r JOIN origen_review_request_responses a ON a.request_id=r.id
   WHERE r.id=l.request_id AND r.account_id=owner AND r.student_id=p.student_id AND a.version=l.response_version AND a.withdrawn_at IS NULL AND origen_review_request_live(r.id)),
  'permitted',origen_coordinator_student_ready(owner,p.student_id),
  'validUntil',least((SELECT expires_at FROM origen_review_request_publications WHERE request_id=l.request_id AND invalidated_at IS NULL ORDER BY published_at DESC LIMIT 1),
   (SELECT CASE WHEN e.status='approved' THEN e.permission_expires_at ELSE 'infinity'::timestamptz END FROM origen_eligibility e JOIN origen_accounts a ON encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')=e.subject_hash WHERE a.id=owner)))
 FROM origen_plans p JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id
 JOIN origen_review_response_plan_links l ON l.account_id=p.account_id AND l.plan_id=p.id AND l.step_id=s.id AND l.student_id=p.student_id
 WHERE p.account_id=owner AND p.id=plan AND s.id=step
$$;

CREATE FUNCTION origen_student_follow_up_reconcile(owner uuid,plan uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE item record; target jsonb; reason text;
BEGIN
 FOR item IN SELECT * FROM origen_student_follow_ups f WHERE f.account_id=owner AND f.plan_id=plan AND f.state='scheduled' ORDER BY f.step_id LOOP
  target:=origen_student_follow_up_target(owner,plan,item.step_id);
  reason:=CASE WHEN target IS NULL OR target->>'active'<>'true' OR target->>'actionHash' IS DISTINCT FROM item.action_hash THEN 'action_changed'
   WHEN target->>'permitted'<>'true' THEN 'permission_changed' WHEN target->>'sourceCurrent'<>'true' OR item.valid_until<=clock_timestamp() THEN 'source_changed' END;
  IF reason IS NOT NULL THEN
   UPDATE origen_student_follow_ups SET state='paused',pause_reason=reason,revision=revision+1,updated_at=clock_timestamp()
    WHERE account_id=owner AND plan_id=plan AND step_id=item.step_id AND state='scheduled';
  END IF;
 END LOOP;
 -- The editor replaces steps in one transaction. Prune only after that final
 -- state is visible, not on the transient DELETE of every old step.
 DELETE FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.plan_id=plan
  AND NOT EXISTS(SELECT 1 FROM origen_plan_steps s WHERE s.account_id=owner AND s.plan_id=plan AND s.id=l.step_id);
END $$;
CREATE FUNCTION origen_student_follow_up_plan_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END; owner uuid; plan uuid;
BEGIN
 owner:=(row->>'account_id')::uuid;plan:=(CASE WHEN TG_TABLE_NAME='origen_plans' THEN row->>'id' ELSE row->>'plan_id' END)::uuid;
 IF EXISTS(SELECT 1 FROM origen_student_follow_ups f WHERE f.account_id=owner AND f.plan_id=plan)
  OR EXISTS(SELECT 1 FROM origen_student_follow_up_previews p WHERE p.account_id=owner AND p.plan_id=plan) THEN
  PERFORM origen_student_follow_up_reconcile(owner,plan);
  DELETE FROM origen_student_follow_up_previews p WHERE p.account_id=owner AND p.plan_id=plan AND p.consumed_at IS NULL
   AND (p.plan_version IS DISTINCT FROM (SELECT version FROM origen_plans WHERE account_id=owner AND id=plan)
    OR p.action_hash IS DISTINCT FROM origen_student_follow_up_target(owner,plan,p.step_id)->>'actionHash');
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER student_follow_up_steps AFTER INSERT OR UPDATE OR DELETE ON origen_plan_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_plan_changed();
CREATE CONSTRAINT TRIGGER student_follow_up_plan AFTER UPDATE ON origen_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_plan_changed();
CREATE CONSTRAINT TRIGGER student_follow_up_sources AFTER INSERT OR UPDATE OR DELETE ON origen_plan_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_plan_changed();

CREATE FUNCTION origen_student_follow_up_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE oldrow jsonb:=to_jsonb(OLD); rid uuid;
BEGIN
 rid:=(CASE WHEN TG_TABLE_NAME='origen_review_requests' THEN oldrow->>'id' ELSE oldrow->>'request_id' END)::uuid;
 UPDATE origen_student_follow_ups SET state='paused',pause_reason='source_changed',revision=revision+1,updated_at=clock_timestamp() WHERE request_id=rid AND state='scheduled';
 DELETE FROM origen_student_follow_up_previews WHERE request_id=rid;
 RETURN NULL;
END $$;
CREATE TRIGGER student_follow_up_response AFTER UPDATE OR DELETE ON origen_review_request_responses FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_source_changed();
CREATE TRIGGER student_follow_up_request AFTER DELETE ON origen_review_requests FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_source_changed();
CREATE TRIGGER student_follow_up_publication AFTER UPDATE OF invalidated_at ON origen_review_request_publications FOR EACH ROW WHEN(NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) EXECUTE FUNCTION origen_student_follow_up_source_changed();

CREATE FUNCTION origen_student_follow_up_permission_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid;
BEGIN
 IF TG_TABLE_NAME='origen_accounts' THEN owner:=OLD.id;
 ELSE SELECT id INTO owner FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=OLD.subject_hash; END IF;
 UPDATE origen_student_follow_ups SET state='paused',pause_reason='permission_changed',revision=revision+1,updated_at=clock_timestamp() WHERE account_id=owner AND state='scheduled';
 DELETE FROM origen_student_follow_up_previews WHERE account_id=owner;
 RETURN NULL;
END $$;
CREATE TRIGGER student_follow_up_role AFTER UPDATE OF role ON origen_accounts FOR EACH ROW WHEN(NEW.role IS DISTINCT FROM OLD.role) EXECUTE FUNCTION origen_student_follow_up_permission_changed();
CREATE TRIGGER student_follow_up_permission AFTER UPDATE OF status,revision,permission_expires_at OR DELETE ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_student_follow_up_permission_changed();

CREATE FUNCTION origen_student_follow_up_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; student text:=input->>'studentId'; action text:=input->>'action';
 plan uuid; step text; target jsonb; row origen_student_follow_ups%ROWTYPE; preview origen_student_follow_up_previews%ROWTYPE;
 receipt origen_student_follow_up_receipts%ROWTYPE; inputhash text; expected integer; tz text; day date; keys text[]; result jsonb;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"student_follow_up_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"student_follow_up_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('load','prepare','confirm','pause','stop','delete-report','export') THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
 IF action='export' THEN
  IF input-'action'<>'{}'::jsonb THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
  -- Expiry is also checked on reads; clock passage cannot leave an eligible
  -- enrollment merely because no permission mutation occurred.
  PERFORM origen_student_follow_up_reconcile(owner,plan_id) FROM (SELECT DISTINCT plan_id FROM origen_student_follow_ups WHERE account_id=owner) x;
  RETURN jsonb_build_object('enrollments',coalesce((SELECT jsonb_agg(to_jsonb(f)-'account_id'-'action_hash') FROM origen_student_follow_ups f WHERE account_id=owner),'[]'::jsonb),
   'reports',coalesce((SELECT jsonb_agg(to_jsonb(r)-'account_id') FROM origen_student_follow_up_reports r WHERE account_id=owner),'[]'::jsonb),
   'presentations',coalesce((SELECT jsonb_agg(to_jsonb(p)-'account_id') FROM origen_student_follow_up_presentations p WHERE account_id=owner),'[]'::jsonb));
 END IF;
 keys:=ARRAY['action','studentId','target']||CASE action WHEN 'prepare' THEN ARRAY['operationId','revision','planVersion','schedule','language'] WHEN 'confirm' THEN ARRAY['operationId','previewId','digest','confirmed'] WHEN 'delete-report' THEN ARRAY['operationId','reportId','revision'] WHEN 'load' THEN ARRAY[]::text[] ELSE ARRAY['operationId','revision'] END;
 IF input-keys<>'{}'::jsonb OR NOT(input ?& keys) OR student IS NULL OR length(student) NOT BETWEEN 1 AND 128
  OR jsonb_typeof(input->'target') IS DISTINCT FROM 'object' OR (input->'target')-ARRAY['planId','stepId']<>'{}'::jsonb
  OR input->'target'->>'planId' IS NULL OR input->'target'->>'stepId' IS NULL THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
 plan:=(input->'target'->>'planId')::uuid;step:=input->'target'->>'stepId';
 IF length(step) NOT BETWEEN 1 AND 128 OR NOT EXISTS(SELECT 1 FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.student_id=student AND l.plan_id=plan AND l.step_id=step)
  THEN RETURN '{"error":"student_follow_up_unavailable"}'; END IF;
 IF action IN ('prepare','confirm') THEN
  IF coalesce(current_setting('origen.student_follow_up',true),'false')<>'true' THEN RETURN '{"error":"student_follow_up_paused"}'; END IF;
  -- Match source writers' order before taking the enrollment lock.
  PERFORM 1 FROM origen_plans WHERE account_id=owner AND id=plan FOR SHARE;
  PERFORM 1 FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
  PERFORM 1 FROM origen_review_requests WHERE id=(SELECT request_id FROM origen_review_response_plan_links WHERE account_id=owner AND plan_id=plan AND step_id=step) FOR SHARE;
  PERFORM 1 FROM origen_review_request_responses WHERE request_id=(SELECT request_id FROM origen_review_response_plan_links WHERE account_id=owner AND plan_id=plan AND step_id=step) FOR SHARE;
 END IF;
 PERFORM origen_student_follow_up_reconcile(owner,plan);
 target:=origen_student_follow_up_target(owner,plan,step);
 IF target IS NULL OR target->>'studentId' IS DISTINCT FROM student THEN RETURN '{"error":"student_follow_up_unavailable"}'; END IF;
 SELECT * INTO row FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=plan AND step_id=step FOR UPDATE;
 IF action<>'load' THEN
  IF input->>'operationId' IS NULL THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
  inputhash:=encode(sha256(convert_to((input-'operationId')::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM origen_student_follow_up_receipts WHERE account_id=owner AND operation_id=(input->>'operationId')::uuid;
  IF receipt.operation_id IS NOT NULL AND receipt.input_hash<>inputhash THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
 END IF;
 IF action IN ('prepare','confirm') AND receipt.operation_id IS NULL THEN
  IF target->>'active' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true' OR target->>'permitted' IS DISTINCT FROM 'true' THEN RETURN '{"error":"student_follow_up_unavailable"}'; END IF;
 END IF;
 IF action='prepare' THEN
  IF jsonb_typeof(input->'revision') IS DISTINCT FROM 'number' OR (input->>'revision')::integer<0 OR jsonb_typeof(input->'planVersion') IS DISTINCT FROM 'number'
   OR (input->>'planVersion')::integer<>(target->>'planVersion')::integer OR (input->>'revision')::integer<>coalesce(row.revision,0) THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
  IF jsonb_typeof(input->'schedule') IS DISTINCT FROM 'object' OR (input->'schedule')-ARRAY['onOrAfter','timeZone']<>'{}'::jsonb OR NOT(input->'schedule' ?& ARRAY['onOrAfter','timeZone'])
   OR input->>'language' IS NULL OR input->>'language' NOT IN ('en','es') THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
  tz:=input->'schedule'->>'timeZone';
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz) THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
  IF input->'schedule'->'onOrAfter'<>'null'::jsonb THEN
   IF jsonb_typeof(input->'schedule'->'onOrAfter') IS DISTINCT FROM 'string' OR input->'schedule'->>'onOrAfter' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
   day:=(input->'schedule'->>'onOrAfter')::date;
   IF day<(clock_timestamp() AT TIME ZONE tz)::date THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
  END IF;
  DELETE FROM origen_student_follow_up_previews WHERE account_id=owner AND expires_at<=clock_timestamp();
  SELECT * INTO preview FROM origen_student_follow_up_previews WHERE account_id=owner AND id=(input->>'operationId')::uuid;
  IF preview.id IS NOT NULL AND (preview.input_hash<>inputhash OR preview.action_hash<>target->>'actionHash' OR preview.consumed_at IS NOT NULL) THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
  IF preview.id IS NULL THEN
   IF (SELECT count(*) FROM origen_student_follow_up_previews WHERE account_id=owner)>=100 THEN RETURN '{"error":"student_follow_up_limit_changed"}'; END IF;
   INSERT INTO origen_student_follow_up_previews(account_id,id,student_id,plan_id,step_id,request_id,response_version,plan_version,expected_revision,action_hash,input_hash,digest,on_or_after,time_zone,language)
    VALUES(owner,(input->>'operationId')::uuid,student,plan,step,(target->'source'->>'requestId')::uuid,(target->'source'->>'responseVersion')::integer,
     (target->>'planVersion')::integer,coalesce(row.revision,0),target->>'actionHash',inputhash,
     encode(sha256(convert_to(input::text||target::text||gen_random_uuid()::text,'UTF8')),'hex'),day,tz,input->>'language') RETURNING * INTO preview;
  END IF;
  RETURN jsonb_build_object('preview',jsonb_build_object('id',preview.id,'digest',preview.digest,'expiresAt',preview.expires_at,'language',preview.language,
   'selection',jsonb_build_object('target',input->'target','action',target->'action','source',target->'source','planVersion',preview.plan_version,'revision',preview.expected_revision,
    'schedule',jsonb_build_object('onOrAfter',preview.on_or_after,'timeZone',preview.time_zone),'oneCheckIn',true,'sharedWithCoordinator',false)));
 END IF;
 IF action<>'load' AND receipt.operation_id IS NULL THEN
  IF action='confirm' THEN
   IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'digest' IS NULL THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
   SELECT * INTO preview FROM origen_student_follow_up_previews WHERE account_id=owner AND id=(input->>'previewId')::uuid AND plan_id=plan AND step_id=step AND student_id=student FOR UPDATE;
   IF preview.id IS NULL OR preview.digest<>input->>'digest' OR preview.consumed_at IS NOT NULL OR preview.expected_revision<>coalesce(row.revision,0)
    OR preview.plan_version<>(target->>'planVersion')::integer OR preview.action_hash<>target->>'actionHash' THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
   IF preview.expires_at<=clock_timestamp() OR preview.on_or_after<(clock_timestamp() AT TIME ZONE preview.time_zone)::date THEN RETURN '{"error":"student_follow_up_expired"}'; END IF;
   INSERT INTO origen_student_follow_ups(account_id,student_id,plan_id,step_id,request_id,response_version,state,accepted_plan_version,action_hash,on_or_after,time_zone,valid_until,consented_at)
    VALUES(owner,student,plan,step,preview.request_id,preview.response_version,'scheduled',preview.plan_version,preview.action_hash,preview.on_or_after,preview.time_zone,(target->>'validUntil')::timestamptz,clock_timestamp())
    ON CONFLICT(account_id,plan_id,step_id) DO UPDATE SET state='scheduled',accepted_plan_version=excluded.accepted_plan_version,action_hash=excluded.action_hash,
     on_or_after=excluded.on_or_after,time_zone=excluded.time_zone,valid_until=excluded.valid_until,consented_at=excluded.consented_at,pause_reason=NULL,revision=origen_student_follow_ups.revision+1,updated_at=clock_timestamp();
   UPDATE origen_student_follow_up_previews SET consumed_at=clock_timestamp() WHERE account_id=owner AND id=preview.id;
  ELSIF action IN ('pause','stop') THEN
   IF jsonb_typeof(input->'revision') IS DISTINCT FROM 'number' OR (input->>'revision')::integer<>coalesce(row.revision,0) THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
   INSERT INTO origen_student_follow_ups(account_id,student_id,plan_id,step_id,request_id,response_version,state,pause_reason)
    VALUES(owner,student,plan,step,(target->'source'->>'requestId')::uuid,(target->'source'->>'responseVersion')::integer,CASE WHEN action='stop' THEN 'off' ELSE 'paused' END,'student')
    ON CONFLICT(account_id,plan_id,step_id) DO UPDATE SET state=excluded.state,pause_reason='student',revision=origen_student_follow_ups.revision+1,updated_at=clock_timestamp();
   DELETE FROM origen_student_follow_up_previews WHERE account_id=owner AND plan_id=plan AND step_id=step;
  ELSE
   IF jsonb_typeof(input->'revision') IS DISTINCT FROM 'number' THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
   DELETE FROM origen_student_follow_up_reports WHERE account_id=owner AND plan_id=plan AND step_id=step AND id=(input->>'reportId')::uuid AND version=(input->>'revision')::integer;
   IF NOT FOUND THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
  END IF;
  INSERT INTO origen_student_follow_up_receipts(account_id,operation_id,plan_id,step_id,input_hash) VALUES(owner,(input->>'operationId')::uuid,plan,step,inputhash);
 END IF;
 SELECT * INTO row FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=plan AND step_id=step;
 RETURN jsonb_build_object('target',input->'target','state',coalesce(row.state,'off'),'revision',coalesce(row.revision,0),'pauseReason',row.pause_reason,
  'consentedAt',row.consented_at,'acceptedPlanVersion',row.accepted_plan_version,'schedule',CASE WHEN row.consented_at IS NOT NULL THEN jsonb_build_object('onOrAfter',row.on_or_after,'timeZone',row.time_zone) END,
  'source',CASE WHEN target->>'sourceCurrent'='true' THEN target->'source' END,
  'canEnroll',target->>'active'='true' AND target->>'sourceCurrent'='true' AND target->>'permitted'='true',
  'reports',coalesce((SELECT jsonb_agg(to_jsonb(r)-'account_id') FROM origen_student_follow_up_reports r WHERE account_id=owner AND plan_id=plan AND step_id=step),'[]'::jsonb),
  'presentations',coalesce((SELECT jsonb_agg(to_jsonb(p)-'account_id') FROM origen_student_follow_up_presentations p WHERE account_id=owner AND plan_id=plan AND step_id=step),'[]'::jsonb));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_parameter_value THEN RETURN '{"error":"invalid_student_follow_up"}';
END $$;

CREATE FUNCTION origen_student_follow_up_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 DELETE FROM origen_student_follow_up_previews;
 DELETE FROM origen_student_follow_up_receipts;
 DELETE FROM origen_student_follow_up_presentations;
 UPDATE origen_student_follow_ups SET state=CASE WHEN state='off' THEN 'off' ELSE 'paused' END,pause_reason='restored',revision=revision+1,updated_at=clock_timestamp();
$$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_student_follow_up_target(uuid,uuid,text)','origen_student_follow_up_reconcile(uuid,uuid)','origen_student_follow_up_plan_changed()',
  'origen_student_follow_up_source_changed()','origen_student_follow_up_permission_changed()','origen_student_follow_up_command(jsonb)','origen_student_follow_up_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

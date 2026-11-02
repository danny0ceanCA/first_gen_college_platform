-- No inferred claims, verification, sharing or evaluation consent is backfilled.
CREATE TABLE origen_outcome_definitions (
 id text NOT NULL, version integer NOT NULL CHECK(version>0), contract jsonb NOT NULL,
 PRIMARY KEY(id,version), CHECK(contract->>'id'=id AND (contract->>'version')::integer=version)
);
INSERT INTO origen_outcome_definitions(id,version,contract) VALUES
('office_contacted',1,'{"id":"office_contacted","version":1,"label":{"en":"Contacted the office","es":"Me comuniqué con la oficina"},"criterion":"Reached the relevant office and exchanged information; an unanswered call is only an attempt.","scope":"institution-term-cycle","observationWindow":{"kind":"explicit-local-dates","maxDays":366,"afterWindow":"unknown-unless-explicitly-reported"},"freshness":"exact-source-version-and-scope","bases":["student_account","direct_observation","declared_record_review"],"doesNotEstablish":["document_submitted","document_accepted","decision_received","waiver_approved"]}'::jsonb),
('document_submitted',1,'{"id":"document_submitted","version":1,"label":{"en":"Submitted the document","es":"Entregué el documento"},"criterion":"Sent the specified requested document through the intended channel; acceptance is a separate claim.","scope":"institution-term-cycle","observationWindow":{"kind":"explicit-local-dates","maxDays":366,"afterWindow":"unknown-unless-explicitly-reported"},"freshness":"exact-source-version-and-scope","bases":["student_account","direct_observation","declared_record_review"],"doesNotEstablish":["document_accepted","decision_received","waiver_approved"]}'::jsonb),
('document_accepted',1,'{"id":"document_accepted","version":1,"label":{"en":"Document accepted","es":"Documento aceptado"},"criterion":"The relevant office indicated that the specified document meets its submission requirements.","scope":"institution-term-cycle","observationWindow":{"kind":"explicit-local-dates","maxDays":366,"afterWindow":"unknown-unless-explicitly-reported"},"freshness":"exact-source-version-and-scope","bases":["student_account","direct_observation","declared_record_review"],"doesNotEstablish":["decision_received","waiver_approved"]}'::jsonb),
('decision_received',1,'{"id":"decision_received","version":1,"label":{"en":"Received a decision","es":"Recibí una decisión"},"criterion":"Received a decision for this specific process and term; approval, denial and another decision remain distinct.","scope":"institution-term-cycle","observationWindow":{"kind":"explicit-local-dates","maxDays":366,"afterWindow":"unknown-unless-explicitly-reported"},"freshness":"exact-source-version-and-scope","bases":["student_account","direct_observation","declared_record_review"],"doesNotEstablish":["waiver_approved"]}'::jsonb),
('waiver_approved',1,'{"id":"waiver_approved","version":1,"label":{"en":"Insurance waiver approved","es":"Exención del seguro aprobada"},"criterion":"The institution issued an approval for this student’s insurance waiver for the specified term. A policy page or submission receipt does not establish approval.","scope":"institution-term-cycle","observationWindow":{"kind":"explicit-local-dates","maxDays":366,"afterWindow":"unknown-unless-explicitly-reported"},"freshness":"exact-source-version-and-scope","bases":["student_account","direct_observation","declared_record_review"],"doesNotEstablish":["financial_aid_awarded","advice_caused_success"]}'::jsonb);

CREATE TABLE origen_outcome_episodes (
 account_id uuid NOT NULL, student_id text NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL, step_id text NOT NULL, definition_id text NOT NULL, definition_version integer NOT NULL,
 institution text NOT NULL CHECK(length(btrim(institution)) BETWEEN 1 AND 200),
 term text NOT NULL CHECK(length(btrim(term)) BETWEEN 1 AND 100), cycle text NOT NULL CHECK(length(btrim(cycle)) BETWEEN 1 AND 128),
 window_start date NOT NULL CHECK(window_start>='1900-01-01'), window_end date NOT NULL,
 time_zone text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 accepted_plan_version integer NOT NULL, action_hash text NOT NULL, request_id uuid NOT NULL, response_version integer NOT NULL, valid_until timestamptz NOT NULL,
 consented_at timestamptz NOT NULL CHECK(consented_at<=now()), recorded_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'current' CHECK(state IN ('current','needs_review')),
 invalidation_reason text CHECK(invalidation_reason IN ('action_changed','source_changed','permission_changed','report_changed','restored')),
 PRIMARY KEY(account_id,id), UNIQUE(account_id,plan_id,step_id,definition_id,definition_version,institution,term,cycle),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_review_response_plan_links(account_id,plan_id,step_id) ON DELETE CASCADE,
 FOREIGN KEY(definition_id,definition_version) REFERENCES origen_outcome_definitions(id,version),
 CHECK(window_end>=window_start AND window_end-window_start<366),
 CHECK((state='current' AND invalidation_reason IS NULL) OR (state='needs_review' AND invalidation_reason IS NOT NULL))
);
-- Reserved private evidence links. Step 2 must supply exact approval before any
-- application writer is introduced. Coordinator evidence gets separate scope in step 3.
CREATE TABLE origen_outcome_evidence (
 account_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), episode_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), report_id uuid NOT NULL, report_version integer NOT NULL CHECK(report_version>0),
 response_state text NOT NULL CHECK(response_state IN ('answered','declined','unknown')),
 claim_status text CHECK(claim_status IN ('occurred','not_occurred','pending','unknown','goal_changed')),
 decision text CHECK(decision IN ('approved','denied','other','unknown')),
 origin text NOT NULL DEFAULT 'student_reported' CHECK(origin='student_reported'),
 basis text NOT NULL DEFAULT 'student_account' CHECK(basis='student_account'),
 assessment text NOT NULL DEFAULT 'not_assessed' CHECK(assessment='not_assessed'),
 purpose text NOT NULL DEFAULT 'private_record' CHECK(purpose='private_record'),
 institution_verified boolean NOT NULL DEFAULT false CHECK(NOT institution_verified),
 evaluation_allowed boolean NOT NULL DEFAULT false CHECK(NOT evaluation_allowed),
 event_on date, date_precision text NOT NULL CHECK(date_precision IN ('day','unknown')), time_zone text NOT NULL,
 approved_at timestamptz NOT NULL CHECK(approved_at<=now()), recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id), UNIQUE(account_id,episode_id,report_id,report_version),
 FOREIGN KEY(account_id,episode_id) REFERENCES origen_outcome_episodes(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,report_id) REFERENCES origen_student_follow_up_reports(account_id,id) ON DELETE CASCADE,
 CHECK((response_state='answered' AND claim_status IS NOT NULL) OR (response_state IN ('declined','unknown') AND claim_status IS NULL AND decision IS NULL AND event_on IS NULL)),
 CHECK((date_precision='day' AND event_on IS NOT NULL) OR (date_precision='unknown' AND event_on IS NULL))
);
CREATE INDEX outcome_evidence_report ON origen_outcome_evidence(account_id,report_id);
CREATE INDEX outcome_episode_source ON origen_outcome_episodes(request_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_outcome_definitions','origen_outcome_episodes','origen_outcome_evidence'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 END LOOP;
END $$;

CREATE FUNCTION origen_outcome_episode_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE target jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  -- Foundation permits lifecycle invalidation only. New versions and renewal
  -- require the future explicit-approval writer, not an UPDATE from callers.
  IF (to_jsonb(NEW)-ARRAY['state','invalidation_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','invalidation_reason'])
   OR OLD.state='needs_review' AND NEW.state='current' THEN RAISE EXCEPTION 'outcome_episode_immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) OR NEW.institution<>btrim(NEW.institution) OR NEW.term<>btrim(NEW.term) OR NEW.cycle<>btrim(NEW.cycle)
  OR NEW.institution ~ '[[:cntrl:]]' OR NEW.term ~ '[[:cntrl:]]' OR NEW.cycle ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_outcome_scope' USING ERRCODE='23514'; END IF;
 target:=origen_student_follow_up_target(NEW.account_id,NEW.plan_id,NEW.step_id);
 IF target IS NULL OR target->>'studentId' IS DISTINCT FROM NEW.student_id OR target->>'permitted' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'outcome_source_unavailable' USING ERRCODE='23514'; END IF;
 NEW.accepted_plan_version:=(target->>'planVersion')::integer;NEW.action_hash:=target->>'actionHash';
 NEW.request_id:=(target->'source'->>'requestId')::uuid;NEW.response_version:=(target->'source'->>'responseVersion')::integer;
 NEW.valid_until:=(target->>'validUntil')::timestamptz;
 IF NEW.valid_until IS NULL OR NEW.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'outcome_source_expired' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_episode_guard BEFORE INSERT OR UPDATE ON origen_outcome_episodes FOR EACH ROW EXECUTE FUNCTION origen_outcome_episode_guard();

CREATE FUNCTION origen_outcome_evidence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE episode origen_outcome_episodes%ROWTYPE; report origen_student_follow_up_reports%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'outcome_evidence_immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO episode FROM origen_outcome_episodes WHERE account_id=NEW.account_id AND id=NEW.episode_id;
 IF episode.id IS NOT NULL THEN
  PERFORM origen_outcome_reconcile(NEW.account_id,episode.plan_id);
  SELECT * INTO episode FROM origen_outcome_episodes WHERE account_id=NEW.account_id AND id=NEW.episode_id;
 END IF;
 SELECT * INTO report FROM origen_student_follow_up_reports WHERE account_id=NEW.account_id AND id=NEW.report_id;
 IF episode.id IS NULL OR episode.state<>'current' OR report.id IS NULL OR report.version<>NEW.report_version OR report.student_id<>episode.student_id
  OR report.plan_id<>episode.plan_id OR report.step_id<>episode.step_id OR report.response_state<>NEW.response_state
  THEN RAISE EXCEPTION 'outcome_report_changed' USING ERRCODE='23514'; END IF;
 IF NEW.event_on IS DISTINCT FROM report.occurred_on OR NEW.time_zone<>report.time_zone OR NEW.time_zone<>episode.time_zone OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone)
  OR NEW.event_on IS NOT NULL AND (NEW.event_on<(episode.window_start) OR NEW.event_on>episode.window_end OR NEW.event_on>(clock_timestamp() AT TIME ZONE NEW.time_zone)::date)
  THEN RAISE EXCEPTION 'invalid_outcome_date' USING ERRCODE='23514'; END IF;
 IF episode.definition_id='decision_received' AND NEW.claim_status='occurred' THEN
  IF NEW.decision IS NULL THEN RAISE EXCEPTION 'outcome_decision_required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.decision IS NOT NULL THEN RAISE EXCEPTION 'invalid_outcome_decision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_evidence_guard BEFORE INSERT OR UPDATE ON origen_outcome_evidence FOR EACH ROW EXECUTE FUNCTION origen_outcome_evidence_guard();

CREATE FUNCTION origen_outcome_reconcile(owner uuid,plan uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row record; target jsonb; reason text;
BEGIN
 FOR row IN SELECT * FROM origen_outcome_episodes WHERE account_id=owner AND plan_id=plan AND state='current' LOOP
  target:=origen_student_follow_up_target(owner,plan,row.step_id);
  reason:=CASE WHEN target IS NULL OR target->>'actionHash' IS DISTINCT FROM row.action_hash THEN 'action_changed'
   WHEN target->>'permitted' IS DISTINCT FROM 'true' THEN 'permission_changed'
   WHEN target->>'sourceCurrent' IS DISTINCT FROM 'true' OR row.valid_until<=clock_timestamp() OR (target->>'validUntil')::timestamptz<=clock_timestamp() THEN 'source_changed' END;
  IF reason IS NOT NULL THEN UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason=reason WHERE account_id=owner AND id=row.id; END IF;
 END LOOP;
 DELETE FROM origen_outcome_episodes e WHERE e.account_id=owner AND e.plan_id=plan AND NOT EXISTS(SELECT 1 FROM origen_plan_steps s WHERE s.account_id=owner AND s.plan_id=plan AND s.id=e.step_id);
END $$;
CREATE FUNCTION origen_outcome_plan_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
 PERFORM origen_outcome_reconcile((row->>'account_id')::uuid,(CASE WHEN TG_TABLE_NAME='origen_plans' THEN row->>'id' ELSE row->>'plan_id' END)::uuid);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER outcome_plan_steps AFTER INSERT OR UPDATE OR DELETE ON origen_plan_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_outcome_plan_changed();
CREATE CONSTRAINT TRIGGER outcome_plan AFTER UPDATE ON origen_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_outcome_plan_changed();
CREATE CONSTRAINT TRIGGER outcome_plan_sources AFTER INSERT OR UPDATE OR DELETE ON origen_plan_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION origen_outcome_plan_changed();
CREATE FUNCTION origen_outcome_report_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='report_changed' WHERE account_id=OLD.account_id AND id IN (SELECT episode_id FROM origen_outcome_evidence WHERE account_id=OLD.account_id AND report_id=OLD.id);
 DELETE FROM origen_outcome_evidence WHERE account_id=OLD.account_id AND report_id=OLD.id;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER outcome_report_changed BEFORE UPDATE OR DELETE ON origen_student_follow_up_reports FOR EACH ROW EXECUTE FUNCTION origen_outcome_report_changed();
CREATE FUNCTION origen_outcome_link_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='source_changed' WHERE account_id=OLD.account_id AND plan_id=OLD.plan_id AND step_id=OLD.step_id;RETURN NULL;
END $$;
CREATE TRIGGER outcome_link_changed AFTER UPDATE ON origen_review_response_plan_links FOR EACH ROW WHEN(NEW IS DISTINCT FROM OLD) EXECUTE FUNCTION origen_outcome_link_changed();
CREATE FUNCTION origen_outcome_permission_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid;
BEGIN
 IF TG_TABLE_NAME='origen_accounts' THEN owner:=OLD.id;
 ELSE SELECT id INTO owner FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=OLD.subject_hash; END IF;
 UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='permission_changed' WHERE account_id=owner;RETURN NULL;
END $$;
CREATE TRIGGER outcome_role AFTER UPDATE OF role ON origen_accounts FOR EACH ROW WHEN(NEW.role IS DISTINCT FROM OLD.role) EXECUTE FUNCTION origen_outcome_permission_changed();
CREATE TRIGGER outcome_permission AFTER UPDATE OF status,revision,permission_expires_at OR DELETE ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_outcome_permission_changed();

-- Only catalog/history reads and erasure are exposed in step 1. Neither the
-- feature switch nor model arguments create a writer or an assessment engine.
CREATE FUNCTION origen_outcome_evidence_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; action text:=input->>'action'; plan uuid; step text; student text; row origen_outcome_episodes%ROWTYPE; keys text[];
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"outcome_evidence_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"outcome_evidence_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('definitions','load','delete-episode','export') THEN RETURN '{"error":"invalid_outcome_evidence"}'; END IF;
 IF action IN ('definitions','export') THEN
  IF input-'action'<>'{}'::jsonb THEN RETURN '{"error":"invalid_outcome_evidence"}'; END IF;
  IF action='definitions' THEN RETURN jsonb_build_object('definitions',(SELECT jsonb_agg(contract ORDER BY id,version) FROM origen_outcome_definitions)); END IF;
  PERFORM origen_outcome_reconcile(owner,plan_id) FROM (SELECT DISTINCT plan_id FROM origen_outcome_episodes WHERE account_id=owner) x;
  RETURN jsonb_build_object('episodes',coalesce((SELECT jsonb_agg(to_jsonb(e)-'account_id'-'action_hash') FROM origen_outcome_episodes e WHERE account_id=owner),'[]'::jsonb),
   'evidence',coalesce((SELECT jsonb_agg(to_jsonb(e)-'account_id') FROM origen_outcome_evidence e WHERE account_id=owner),'[]'::jsonb));
 END IF;
 keys:=ARRAY['action','studentId','target']||CASE WHEN action='delete-episode' THEN ARRAY['id','version'] ELSE ARRAY[]::text[] END;
 IF input-keys<>'{}'::jsonb OR NOT(input ?& keys) OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(input->>'studentId') NOT BETWEEN 1 AND 128
  OR jsonb_typeof(input->'target') IS DISTINCT FROM 'object' OR (input->'target')-ARRAY['planId','stepId']<>'{}'::jsonb OR NOT(input->'target' ?& ARRAY['planId','stepId'])
  OR jsonb_typeof(input->'target'->'planId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'target'->'stepId') IS DISTINCT FROM 'string'
  THEN RETURN '{"error":"invalid_outcome_evidence"}'; END IF;
 student:=input->>'studentId';plan:=(input->'target'->>'planId')::uuid;step:=input->'target'->>'stepId';
 IF length(step) NOT BETWEEN 1 AND 128 OR NOT EXISTS(SELECT 1 FROM origen_plans p JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id WHERE p.account_id=owner AND p.id=plan AND p.student_id=student AND s.id=step)
  THEN RETURN '{"error":"outcome_evidence_unavailable"}'; END IF;
 PERFORM origen_outcome_reconcile(owner,plan);
 IF action='delete-episode' THEN
  IF jsonb_typeof(input->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR (input->>'version')::integer<1 OR (input->>'version')::numeric<>(input->>'version')::integer THEN RETURN '{"error":"invalid_outcome_evidence"}'; END IF;
  SELECT * INTO row FROM origen_outcome_episodes WHERE account_id=owner AND id=(input->>'id')::uuid AND plan_id=plan AND step_id=step;
  IF row.id IS NOT NULL AND row.version<>(input->>'version')::integer THEN RETURN '{"error":"outcome_evidence_changed"}'; END IF;
  DELETE FROM origen_outcome_episodes WHERE account_id=owner AND id=row.id;RETURN '{"status":"deleted"}';
 END IF;
 RETURN jsonb_build_object('episodes',coalesce((SELECT jsonb_agg(to_jsonb(e)-'account_id'-'action_hash' ORDER BY e.recorded_at,e.id) FROM (SELECT * FROM origen_outcome_episodes WHERE account_id=owner AND plan_id=plan AND step_id=step ORDER BY recorded_at,id LIMIT 51) e),'[]'::jsonb),
  'evidence',coalesce((SELECT jsonb_agg(to_jsonb(e)-'account_id' ORDER BY e.recorded_at,e.id) FROM (SELECT e.* FROM origen_outcome_evidence e JOIN origen_outcome_episodes p ON p.account_id=e.account_id AND p.id=e.episode_id WHERE e.account_id=owner AND p.plan_id=plan AND p.step_id=step ORDER BY e.recorded_at,e.id LIMIT 101) e),'[]'::jsonb));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_outcome_evidence"}';
END $$;
CREATE FUNCTION origen_outcome_evidence_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_outcome_episodes SET state='needs_review',invalidation_reason='restored';
$$;
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT oid,proname FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'origen_outcome_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.oid::regprocedure);
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn.oid::regprocedure,current_schema());
 END LOOP;
END $$;

-- Account-wide cancellation receipts contain no action wording. Keeping the
-- receipt makes a retry observe current state instead of stopping newer consent.
CREATE TABLE origen_student_follow_up_stops (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL, student_id text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,operation_id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_student_follow_up_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_student_follow_up_stops FROM PUBLIC;

CREATE FUNCTION origen_student_follow_up_controls(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; action text:=input->>'action'; student text:=input->>'studentId'; keys text[]; operation uuid; prior text;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"student_follow_up_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"student_follow_up_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('overview','stop-all') THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
 keys:=CASE WHEN action='overview' THEN ARRAY['action','studentId'] ELSE ARRAY['action','studentId','operationId'] END;
 IF input-keys<>'{}'::jsonb OR NOT(input ?& keys) OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(student) NOT BETWEEN 1 AND 128 THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"student_follow_up_unavailable"}'; END IF;
 IF action='stop-all' THEN
  IF jsonb_typeof(input->'operationId') IS DISTINCT FROM 'string' THEN RETURN '{"error":"invalid_student_follow_up"}'; END IF;
  operation:=(input->>'operationId')::uuid;
  SELECT student_id INTO prior FROM origen_student_follow_up_stops WHERE account_id=owner AND operation_id=operation;
  IF prior IS NOT NULL AND prior<>student THEN RETURN '{"error":"student_follow_up_changed"}'; END IF;
  IF prior IS NULL THEN
   -- Same account lock as prepare/confirm: neither an in-flight approval nor
   -- an old pending preview can silently survive the cancellation boundary.
   UPDATE origen_student_follow_ups SET state='off',pause_reason='student',revision=revision+1,updated_at=clock_timestamp() WHERE account_id=owner AND state<>'off';
   DELETE FROM origen_student_follow_up_previews WHERE account_id=owner;
   INSERT INTO origen_student_follow_up_stops(account_id,operation_id,student_id) VALUES(owner,operation,student);
  END IF;
 END IF;
 PERFORM origen_student_follow_up_reconcile(owner,plan_id) FROM (SELECT DISTINCT plan_id FROM origen_student_follow_ups WHERE account_id=owner) x;
 RETURN jsonb_build_object('items',coalesce((
  SELECT jsonb_agg(jsonb_build_object('target',jsonb_build_object('planId',l.plan_id,'stepId',l.step_id),'planVersion',target->'planVersion',
   'state',coalesce(f.state,'off'),'revision',coalesce(f.revision,0),'pauseReason',f.pause_reason,
   'schedule',CASE WHEN f.consented_at IS NOT NULL THEN jsonb_build_object('onOrAfter',f.on_or_after,'timeZone',f.time_zone) END,
   'canEnroll',target->>'active'='true' AND target->>'sourceCurrent'='true' AND target->>'permitted'='true') ORDER BY l.plan_id,l.step_id)
  FROM origen_review_response_plan_links l LEFT JOIN origen_student_follow_ups f ON f.account_id=l.account_id AND f.plan_id=l.plan_id AND f.step_id=l.step_id
  CROSS JOIN LATERAL (SELECT origen_student_follow_up_target(owner,l.plan_id,l.step_id) AS target) x
  WHERE l.account_id=owner AND l.student_id=student AND target IS NOT NULL),'[]'::jsonb),
  'remaining',(SELECT count(*) FROM origen_student_follow_ups WHERE account_id=owner AND state IN ('scheduled','paused')),
  'pending',(SELECT count(*) FROM origen_student_follow_up_previews WHERE account_id=owner AND consumed_at IS NULL AND expires_at>clock_timestamp()));
EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_student_follow_up"}';
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_student_follow_up_controls(jsonb) SET search_path=%I,pg_temp',current_schema());
 REVOKE ALL ON FUNCTION origen_student_follow_up_controls(jsonb) FROM PUBLIC;
END $$;

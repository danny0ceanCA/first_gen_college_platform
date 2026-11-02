-- One opening allowance per account/conversation, independent of provider,
-- specialist, student scope, telemetry collection or transport reconnection.
CREATE TABLE origen_conversation_openings (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL, student_id text,
 state text NOT NULL CHECK(state IN ('reserved','claimed','presented','released','suppressed','deferred')),
 kind text CHECK(kind IN ('student-follow-up','action','question','coordinator-guidance')),
 claim_id uuid NOT NULL DEFAULT gen_random_uuid(),
 plan_id uuid, step_id text, enrollment_revision integer, action_hash text,
 memory_session_id uuid, initial_sequence integer, language text CHECK(language IN ('en','es')),
 presentation_hash text, deferred_revision integer, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 PRIMARY KEY(account_id,conversation_id), UNIQUE(account_id,claim_id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE SET NULL(student_id),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_student_follow_ups(account_id,plan_id,step_id) ON DELETE SET NULL(plan_id,step_id)
);
CREATE UNIQUE INDEX student_follow_up_one_claim ON origen_conversation_openings(account_id,plan_id,step_id,enrollment_revision) WHERE state='claimed';
CREATE INDEX student_follow_up_claim_attempts ON origen_conversation_openings(account_id,plan_id,step_id,enrollment_revision);
ALTER TABLE origen_student_follow_ups DROP CONSTRAINT origen_student_follow_ups_pause_reason_check;
ALTER TABLE origen_student_follow_ups ADD CONSTRAINT origen_student_follow_ups_pause_reason_check CHECK(pause_reason IN ('student','action_changed','source_changed','permission_changed','restored','attempt_limit'));
ALTER TABLE origen_conversation_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_conversation_openings FROM PUBLIC;

CREATE FUNCTION origen_conversation_opening_retry_limit(owner uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_student_follow_ups f SET state='paused',pause_reason='attempt_limit',revision=revision+1,updated_at=clock_timestamp()
 WHERE f.account_id=owner AND f.state='scheduled' AND (SELECT count(*) FROM origen_conversation_openings c WHERE c.account_id=f.account_id AND c.plan_id=f.plan_id AND c.step_id=f.step_id AND c.enrollment_revision=f.revision AND c.state='released')>=3;
$$;

CREATE FUNCTION origen_conversation_opening_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; role text; action text:=input->>'action'; conversation uuid;
 student text:=input->>'studentId'; row origen_conversation_openings%ROWTYPE; enrollment origen_student_follow_ups%ROWTYPE;
 session origen_live_memory_sessions%ROWTYPE; item record; target jsonb; chosen jsonb; fallback jsonb; n integer:=0; scanned integer:=0; second_checked boolean:=false; ambiguous boolean:=false; reason text;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"status":"unavailable"}'; END IF;
 SELECT a.id,a.role INTO owner,role FROM origen_accounts a WHERE a.auth0_subject=actor AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('select','bind','verify','present','release','defer','classify') THEN RETURN '{"status":"unavailable"}'; END IF;
 IF action='classify' THEN
  IF jsonb_typeof(input->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'targets')>5 THEN RETURN '{"status":"unavailable"}'; END IF;
  RETURN jsonb_build_object('linked',coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(input->'targets') v WHERE EXISTS(
   SELECT 1 FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.plan_id=(v->>'planId')::uuid AND l.step_id=v->>'stepId')),'[]'::jsonb));
 END IF;
 conversation:=(input->>'conversationId')::uuid;
 IF conversation IS NULL THEN RETURN '{"status":"unavailable"}'; END IF;
 IF action='select' THEN
  IF student IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"status":"unavailable"}'; END IF;
  SELECT * INTO row FROM origen_conversation_openings WHERE account_id=owner AND conversation_id=conversation;
  IF FOUND THEN RETURN '{"status":"suppressed","reason":"conversation_already_considered"}'; END IF;
  INSERT INTO origen_conversation_openings(account_id,conversation_id,student_id,state,language) VALUES(owner,conversation,student,'suppressed',input->>'language') RETURNING * INTO row;
  IF input->'eligible' IS DISTINCT FROM 'true'::jsonb OR coalesce(current_setting('origen.student_follow_up',true),'false')<>'true' THEN RETURN '{"status":"suppressed","reason":"current_priority"}'; END IF;
  -- Abandoned claims release the action, never this conversation's allowance.
  UPDATE origen_conversation_openings SET state='released' WHERE account_id=owner AND state='claimed' AND expires_at<=clock_timestamp();
  PERFORM origen_conversation_opening_retry_limit(owner);
  SELECT * INTO session FROM origen_live_memory_sessions WHERE account_id=owner AND id=(input->>'memorySessionId')::uuid AND student_id=student AND NOT closed AND expires_at>clock_timestamp();
  IF session.id IS NOT NULL AND session.turn_sequence>0 THEN RETURN '{"status":"suppressed","reason":"current_priority"}'; END IF;
  IF role='student' AND student IS NOT NULL AND input->'allowFollowUp'='true'::jsonb AND session.id IS NOT NULL AND session.turn_sequence=0 THEN
   -- The scan is capped before source projections. Invalid early rows can
   -- suppress selection; they never cause an unbounded search or a guessed item.
   FOR item IN
    SELECT f.*,CASE WHEN p.category='financial' THEN 'costs' WHEN p.category='applications' THEN 'applications' WHEN p.category='transfer' THEN 'transfer' ELSE 'options' END AS topic,
     CASE WHEN (CASE WHEN p.category='financial' THEN 'costs' WHEN p.category='applications' THEN 'applications' WHEN p.category='transfer' THEN 'transfer' ELSE 'options' END)=ANY(ARRAY(SELECT jsonb_array_elements_text(input->'topics'))) THEN 0 ELSE 1 END AS priority,
     coalesce(f.on_or_after,(f.consented_at AT TIME ZONE f.time_zone)::date) AS selected_day
    FROM origen_student_follow_ups f JOIN origen_plans p ON p.account_id=f.account_id AND p.id=f.plan_id
    WHERE f.account_id=owner AND f.student_id=student AND f.state='scheduled'
     AND (f.on_or_after IS NULL OR f.on_or_after<=(clock_timestamp() AT TIME ZONE f.time_zone)::date)
     AND (input->'focus'='null'::jsonb OR f.plan_id=(input->'focus'->>'planId')::uuid AND f.step_id=input->'focus'->>'stepId')
     AND NOT EXISTS(SELECT 1 FROM origen_conversation_openings c WHERE c.account_id=owner AND c.plan_id=f.plan_id AND c.step_id=f.step_id AND c.enrollment_revision=f.revision AND c.state='claimed')
    ORDER BY priority,selected_day,f.plan_id,f.step_id LIMIT 33
   LOOP
    scanned:=scanned+1;
    target:=origen_student_follow_up_target(owner,item.plan_id,item.step_id);
    reason:=CASE WHEN target IS NULL OR target->>'studentId' IS DISTINCT FROM student OR target->>'active' IS DISTINCT FROM 'true' OR target->>'actionHash' IS DISTINCT FROM item.action_hash THEN 'action_changed'
     WHEN target->>'permitted' IS DISTINCT FROM 'true' THEN 'permission_changed' WHEN target->>'sourceCurrent' IS DISTINCT FROM 'true' OR item.valid_until<=clock_timestamp() THEN 'source_changed' END;
    IF reason IS NOT NULL THEN
     UPDATE origen_student_follow_ups SET state='paused',pause_reason=reason,revision=revision+1,updated_at=clock_timestamp() WHERE account_id=owner AND plan_id=item.plan_id AND step_id=item.step_id AND state='scheduled';
     CONTINUE;
    END IF;
    IF input->>'focusTopic' IS NOT NULL AND input->>'focusTopic'<>item.topic THEN CONTINUE; END IF;
    IF chosen IS NOT NULL THEN
     second_checked:=true;
     IF (chosen->>'priority')::integer=item.priority AND chosen->>'selectedDay'=item.selected_day::text THEN ambiguous:=true; END IF;
     EXIT;
    END IF;
    chosen:=jsonb_build_object('target',jsonb_build_object('planId',item.plan_id,'stepId',item.step_id),'revision',item.revision,'hash',item.action_hash,
     'source',target->'source','title',target->'action'->>'title','topic',item.topic,'selectedDay',item.selected_day,'priority',item.priority,
     'schedule',jsonb_build_object('onOrAfter',item.on_or_after,'timeZone',item.time_zone));
   END LOOP;
   IF scanned=33 AND NOT second_checked THEN RETURN '{"status":"suppressed","reason":"candidate_limit"}'; END IF;
   IF ambiguous THEN RETURN '{"status":"suppressed","reason":"clarification_required"}'; END IF;
   IF chosen IS NOT NULL THEN
    UPDATE origen_conversation_openings SET state='claimed',kind='student-follow-up',plan_id=(chosen->'target'->>'planId')::uuid,step_id=chosen->'target'->>'stepId',enrollment_revision=(chosen->>'revision')::integer,
     action_hash=chosen->>'hash',memory_session_id=session.id,initial_sequence=session.turn_sequence WHERE account_id=owner AND conversation_id=conversation RETURNING * INTO row;
    RETURN jsonb_build_object('status','selected','kind','student-follow-up','claimId',row.claim_id,'expiresAt',row.expires_at,'candidate',chosen-'hash'-'priority');
   END IF;
  END IF;
  -- Only server-selected, already authorized generic candidates are supplied.
  -- Source-linked actions must use explicit follow-up consent, even when that
  -- consent is off, paused, future-dated, expired or claimed by another device.
  FOR fallback IN SELECT value FROM jsonb_array_elements(input->'fallbacks') LIMIT 12 LOOP
   IF fallback->>'kind' IN ('action','question','coordinator-guidance') THEN
    IF fallback->>'kind'<>'action' OR NOT EXISTS(SELECT 1 FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.plan_id=(fallback->'target'->>'planId')::uuid AND l.step_id=fallback->'target'->>'stepId') THEN
     UPDATE origen_conversation_openings SET state='reserved',kind=fallback->>'kind' WHERE account_id=owner AND conversation_id=conversation;
     RETURN jsonb_build_object('status','selected','kind',fallback->>'kind','fallbackIndex',n);
    END IF;
   END IF;n:=n+1;
  END LOOP;
  RETURN '{"status":"suppressed","reason":"no_eligible_opening"}';
 END IF;
 SELECT * INTO row FROM origen_conversation_openings WHERE account_id=owner AND conversation_id=conversation AND claim_id=(input->>'claimId')::uuid AND student_id=student FOR UPDATE;
 IF row.conversation_id IS NULL OR row.kind IS DISTINCT FROM 'student-follow-up' THEN RETURN '{"status":"unavailable"}'; END IF;
 IF action='release' THEN
  UPDATE origen_conversation_openings SET state='released' WHERE account_id=owner AND conversation_id=conversation AND state='claimed';
  PERFORM origen_conversation_opening_retry_limit(owner);
  RETURN '{"status":"released"}';
 END IF;
 SELECT * INTO session FROM origen_live_memory_sessions WHERE account_id=owner AND id=row.memory_session_id AND student_id=student AND NOT closed AND expires_at>clock_timestamp() FOR SHARE;
 IF action IN ('bind','verify','present') THEN
  PERFORM 1 FROM origen_plans WHERE account_id=owner AND id=row.plan_id FOR SHARE;
  PERFORM 1 FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
  PERFORM 1 FROM origen_review_requests WHERE id=(SELECT request_id FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=row.plan_id AND step_id=row.step_id) FOR SHARE;
  PERFORM 1 FROM origen_review_request_responses WHERE request_id=(SELECT request_id FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=row.plan_id AND step_id=row.step_id) FOR SHARE;
 END IF;
 SELECT * INTO enrollment FROM origen_student_follow_ups WHERE account_id=owner AND plan_id=row.plan_id AND step_id=row.step_id FOR UPDATE;
 IF action='defer' THEN
  IF row.state='deferred' THEN RETURN jsonb_build_object('status',CASE WHEN enrollment.state='paused' AND enrollment.revision=row.deferred_revision THEN 'paused' ELSE 'superseded' END); END IF;
  IF jsonb_typeof(input->'sequence') IS DISTINCT FROM 'number' OR input->>'turnId' IS NULL OR input->>'transcript' IS NULL
   OR lower(trim(input->>'transcript')) !~ '^(not now|maybe later|later please|no thanks|no thank you|ahora no|no por ahora|m[áa]s tarde|quiz[áa]s despu[ée]s|no gracias)[.!?,[:space:]]*$' THEN RETURN '{"status":"unavailable"}'; END IF;
  IF session.id IS NULL OR session.turn_sequence<>row.initial_sequence+1 OR session.turn_sequence<>(input->>'sequence')::integer OR session.turn_sequence<(input->>'sequence')::integer OR session.turn_id IS DISTINCT FROM input->>'turnId'
   OR session.transcript_hash IS DISTINCT FROM encode(sha256(convert_to(input->>'transcript','UTF8')),'hex') THEN RETURN '{"status":"unavailable"}'; END IF;
  IF (row.state IN ('claimed','released') AND row.expires_at>clock_timestamp() AND enrollment.state='scheduled' AND enrollment.revision=row.enrollment_revision) OR (row.state='presented' AND enrollment.state='closed' AND enrollment.revision=row.enrollment_revision+1) THEN
   UPDATE origen_student_follow_ups SET state='paused',pause_reason='student',revision=revision+1,updated_at=clock_timestamp() WHERE account_id=owner AND plan_id=row.plan_id AND step_id=row.step_id;
   UPDATE origen_conversation_openings SET state='deferred',deferred_revision=enrollment.revision+1 WHERE account_id=owner AND conversation_id=conversation;
   RETURN '{"status":"paused"}';
  END IF;
  RETURN '{"status":"unavailable"}';
 END IF;
 IF action='present' AND row.state='presented' AND row.presentation_hash=input->>'presentationHash' THEN RETURN '{"status":"presented"}'; END IF;
 target:=origen_student_follow_up_target(owner,row.plan_id,row.step_id);
 IF coalesce(current_setting('origen.student_follow_up',true),'false')<>'true' OR row.state<>'claimed' OR row.expires_at<=clock_timestamp() OR session.id IS NULL OR session.turn_sequence<>row.initial_sequence
  OR enrollment.state IS DISTINCT FROM 'scheduled' OR enrollment.revision IS DISTINCT FROM row.enrollment_revision OR enrollment.valid_until<=clock_timestamp()
  OR target IS NULL OR target->>'studentId' IS DISTINCT FROM student OR target->>'active' IS DISTINCT FROM 'true' OR target->>'permitted' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true' OR target->>'actionHash' IS DISTINCT FROM row.action_hash THEN
  UPDATE origen_conversation_openings SET state='released' WHERE account_id=owner AND conversation_id=conversation AND state='claimed';
  PERFORM origen_conversation_opening_retry_limit(owner);
  RETURN '{"status":"unavailable"}';
 END IF;
 IF action='bind' THEN
  IF input->>'presentationHash' !~ '^[a-f0-9]{64}$' OR input->>'presentationHash' IS NULL THEN RETURN '{"status":"unavailable"}'; END IF;
  UPDATE origen_conversation_openings SET presentation_hash=input->>'presentationHash' WHERE account_id=owner AND conversation_id=conversation AND presentation_hash IS NULL;
  RETURN '{"status":"current"}';
 END IF;
 IF action='verify' THEN RETURN '{"status":"current"}'; END IF;
 IF row.presentation_hash IS NULL OR row.presentation_hash IS DISTINCT FROM input->>'presentationHash' THEN RETURN '{"status":"not_presented"}'; END IF;
 INSERT INTO origen_student_follow_up_presentations(account_id,plan_id,step_id,enrollment_revision,conversation_id) VALUES(owner,row.plan_id,row.step_id,row.enrollment_revision,conversation) ON CONFLICT DO NOTHING;
 UPDATE origen_student_follow_ups SET state='closed',revision=revision+1,updated_at=clock_timestamp() WHERE account_id=owner AND plan_id=row.plan_id AND step_id=row.step_id;
 UPDATE origen_conversation_openings SET state='presented' WHERE account_id=owner AND conversation_id=conversation;
 RETURN '{"status":"presented"}';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"status":"unavailable"}';
END $$;

CREATE FUNCTION origen_conversation_opening_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_conversation_openings SET state='suppressed',presentation_hash=NULL,expires_at=clock_timestamp();
$$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_conversation_opening_retry_limit(uuid)','origen_conversation_opening_command(jsonb)','origen_conversation_opening_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

-- Private student choices. No response prose, coordinator-facing activity or
-- reminders are stored here. Accepted action wording lives in the existing plan.
CREATE TABLE origen_review_response_choices (
 account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL,
 response_version integer NOT NULL CHECK(response_version>0),
 state text NOT NULL CHECK(state IN ('available','deferred')),
 review_on date, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 operation_id uuid NOT NULL, operation_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE,
 CHECK(state='deferred' OR review_on IS NULL)
);
CREATE TABLE origen_review_response_plan_links (
 account_id uuid NOT NULL, student_id text NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL,
 request_id uuid NOT NULL, response_version integer NOT NULL CHECK(response_version>0),
 accepted_at timestamptz NOT NULL DEFAULT now(), source_detached boolean NOT NULL DEFAULT false,
 PRIMARY KEY(account_id,plan_id,step_id),
 FOREIGN KEY(account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
 -- No request FK: an independently accepted private action survives its source.
 -- No step FK: the plan editor replaces steps transactionally, then prunes links.
);
ALTER TABLE origen_review_response_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_review_response_plan_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_live_memory_sessions ADD COLUMN review_response_focus uuid, ADD COLUMN review_response_focus_version integer;
ALTER TABLE origen_live_memory_sessions ADD CONSTRAINT review_response_focus_complete CHECK(
 (review_response_focus IS NULL AND review_response_focus_version IS NULL) OR
 (review_response_focus IS NOT NULL AND review_response_focus_version IS NOT NULL AND review_response_focus_version>0));

CREATE FUNCTION origen_review_response_choice_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; student text:=input->>'studentId'; action text:=input->>'action';
 ref jsonb:=input->'source'; rid uuid; ver integer; connection jsonb; state origen_review_response_choices%ROWTYPE;
 result jsonb; fingerprint text; plan uuid; step text; ready boolean;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account'
  THEN RETURN '{"error":"review_response_choice_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor
  AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex'));
 IF owner IS NULL THEN RETURN '{"error":"review_response_choice_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('load','defer','revisit','check-source','attach-plan','plan-sources','prune-plan','bind-focus','export')
  OR input-ARRAY['action','studentId','source','revision','reviewOn','operationId','planId','stepId','sessionId']<>'{}'::jsonb
  THEN RETURN '{"error":"invalid_review_response_choice"}'; END IF;
 IF action='export' THEN
  RETURN jsonb_build_object('choices',coalesce((SELECT jsonb_agg(to_jsonb(c)-'account_id'-'operation_hash') FROM origen_review_response_choices c WHERE account_id=owner),'[]'::jsonb),
   'planLinks',coalesce((SELECT jsonb_agg(to_jsonb(l)-'account_id') FROM origen_review_response_plan_links l WHERE account_id=owner),'[]'::jsonb));
 END IF;
 IF action='plan-sources' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('planId',l.plan_id,'stepId',l.step_id,'responseVersion',l.response_version,'acceptedAt',l.accepted_at,
   'availability',CASE WHEN NOT l.source_detached AND c->>'availability' IN ('current','historical') AND origen_coordinator_student_ready(owner,l.student_id) THEN c->>'availability' ELSE 'unavailable' END,
   'source',CASE WHEN NOT l.source_detached AND c->>'availability' IN ('current','historical') AND origen_coordinator_student_ready(owner,l.student_id) THEN c->'source' ELSE NULL END)),'[]'::jsonb)
   INTO result FROM origen_review_response_plan_links l
   CROSS JOIN LATERAL (SELECT origen_review_response_connection(l.request_id,l.response_version) c) x
   WHERE l.account_id=owner AND EXISTS(SELECT 1 FROM origen_plan_steps s WHERE s.account_id=owner AND s.plan_id=l.plan_id AND s.id=l.step_id);
  RETURN jsonb_build_object('links',result);
 END IF;
 IF action='prune-plan' THEN
  DELETE FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.plan_id=(input->>'planId')::uuid
   AND NOT EXISTS(SELECT 1 FROM origen_plan_steps s WHERE s.account_id=owner AND s.plan_id=l.plan_id AND s.id=l.step_id);
  RETURN '{"status":"pruned"}';
 END IF;
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['kind','requestId','responseVersion']<>'{}'::jsonb
  OR ref->>'kind' IS DISTINCT FROM 'review-response' OR ref->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR ref->>'responseVersion' !~ '^[1-9][0-9]*$' OR jsonb_typeof(ref->'responseVersion') IS DISTINCT FROM 'number'
  OR student IS NULL OR length(student) NOT BETWEEN 1 AND 128 THEN RETURN '{"error":"invalid_review_response_choice"}'; END IF;
 rid:=(ref->>'requestId')::uuid;ver:=(ref->>'responseVersion')::integer;
 IF NOT EXISTS(SELECT 1 FROM origen_review_requests WHERE account_id=owner AND student_id=student AND id=rid)
  THEN RETURN '{"error":"review_response_unavailable"}'; END IF;
 ready:=origen_coordinator_student_ready(owner,student);
 -- Request and response locks serialize source validation with edits, removal
 -- and withdrawal through the plan commit; no preflight can authorize a write.
 IF action<>'load' THEN
  IF NOT ready THEN RETURN '{"error":"review_response_choice_denied"}'; END IF;
  IF coalesce(current_setting('origen.review_response_context',true),'false')<>'true' THEN RETURN '{"error":"review_response_context_paused"}'; END IF;
  PERFORM 1 FROM origen_review_requests WHERE account_id=owner AND id=rid FOR UPDATE;
  PERFORM 1 FROM origen_review_request_responses WHERE account_id=owner AND request_id=rid FOR UPDATE;
 END IF;
 connection:=origen_review_response_connection(rid,ver);
 IF connection IS NULL OR connection->>'availability'='unavailable' THEN RETURN '{"error":"review_response_unavailable"}'; END IF;
 SELECT * INTO state FROM origen_review_response_choices WHERE account_id=owner AND request_id=rid;
 IF action IN ('defer','revisit') THEN
  IF input->>'operationId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   OR input->>'revision' !~ '^[0-9]+$' THEN RETURN '{"error":"invalid_review_response_choice"}'; END IF;
  IF action='defer' AND input->'reviewOn' IS DISTINCT FROM 'null'::jsonb AND (input->>'reviewOn' IS NULL OR input->>'reviewOn' !~ '^\d{4}-\d{2}-\d{2}$' OR (input->>'reviewOn')::date<current_date)
   THEN RETURN '{"error":"invalid_review_response_choice"}'; END IF;
  fingerprint:=encode(sha256(convert_to((input-'operationId')::text,'UTF8')),'hex');
  IF state.operation_id=(input->>'operationId')::uuid THEN
   IF state.operation_hash<>fingerprint THEN RETURN '{"error":"review_response_choice_changed"}'; END IF;
  ELSE
   IF coalesce(state.revision,0)<>(input->>'revision')::integer THEN RETURN '{"error":"review_response_choice_changed"}'; END IF;
   INSERT INTO origen_review_response_choices(account_id,student_id,request_id,response_version,state,review_on,operation_id,operation_hash)
    VALUES(owner,student,rid,ver,CASE WHEN action='defer' THEN 'deferred' ELSE 'available' END,CASE WHEN action='defer' THEN (input->>'reviewOn')::date END,(input->>'operationId')::uuid,fingerprint)
    ON CONFLICT(account_id,request_id) DO UPDATE SET response_version=ver,state=excluded.state,review_on=excluded.review_on,revision=origen_review_response_choices.revision+1,operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=clock_timestamp()
    RETURNING * INTO state;
  END IF;
 ELSIF action='bind-focus' THEN
  UPDATE origen_live_memory_sessions SET review_response_focus=rid,review_response_focus_version=ver
   WHERE id=(input->>'sessionId')::uuid AND account_id=owner AND student_id=student AND NOT closed AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN '{"error":"review_response_unavailable"}'; END IF;
 ELSIF action='attach-plan' THEN
  plan:=(input->>'planId')::uuid;step:=input->>'stepId';
  IF NOT EXISTS(SELECT 1 FROM origen_plans p JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id
   WHERE p.account_id=owner AND p.student_id=student AND p.id=plan AND s.id=step AND s.status='not-started')
   THEN RETURN '{"error":"review_response_choice_denied"}'; END IF;
  INSERT INTO origen_review_response_plan_links(account_id,student_id,plan_id,step_id,request_id,response_version) VALUES(owner,student,plan,step,rid,ver);
 END IF;
 RETURN jsonb_build_object('available',ready,'source',connection->'source','availability',connection->>'availability',
  'authorName',connection->'response'->'author'->>'name',
  'acceptedActionCount',(SELECT count(*) FROM origen_review_response_plan_links l WHERE l.account_id=owner AND l.request_id=rid AND EXISTS(SELECT 1 FROM origen_plan_steps s WHERE s.account_id=owner AND s.plan_id=l.plan_id AND s.id=l.step_id)),
  'choice',jsonb_build_object('state',coalesce(state.state,'available'),'revision',coalesce(state.revision,0),'reviewOn',state.review_on,
   'shouldOffer',ready AND connection->>'availability'='current' AND (state.state IS DISTINCT FROM 'deferred' OR coalesce(state.review_on<=current_date,false))
    AND NOT EXISTS(SELECT 1 FROM origen_review_response_plan_links l JOIN origen_plan_steps s ON s.account_id=l.account_id AND s.plan_id=l.plan_id AND s.id=l.step_id WHERE l.account_id=owner AND l.request_id=rid)));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN '{"error":"invalid_review_response_choice"}';
END $$;

DO $$ DECLARE definition text; anchor text:='''actionAccepted'',''not_recorded'''; BEGIN
 definition:=pg_get_functiondef('origen_review_response_connection(uuid,integer)'::regprocedure);
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_response_activity'; END IF;
 EXECUTE replace(definition,anchor,'''actionAccepted'',CASE WHEN EXISTS(SELECT 1 FROM origen_review_response_plan_links l JOIN origen_plan_steps s ON s.account_id=l.account_id AND s.plan_id=l.plan_id AND s.id=l.step_id WHERE l.account_id=r.account_id AND l.request_id=r.id) THEN ''recorded'' ELSE ''not_recorded'' END');
END $$;

CREATE FUNCTION origen_review_response_choices_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_review_response_choices SET state='deferred',review_on=NULL,revision=revision+1,operation_id=gen_random_uuid(),operation_hash='',updated_at=now();
 UPDATE origen_review_response_plan_links SET source_detached=true;
$$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_review_response_choice_command(jsonb)','origen_review_response_choices_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

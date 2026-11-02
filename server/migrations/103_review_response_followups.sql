-- A follow-up is a separately approved request, with one exact source reference.
-- There is no copied conversation, response body or recursively expanded thread.
ALTER TABLE origen_review_requests ADD COLUMN related_request_id uuid,
 ADD COLUMN related_response_version integer, ADD COLUMN related_detached boolean NOT NULL DEFAULT false;
ALTER TABLE origen_review_requests ADD CONSTRAINT review_followup_reference CHECK(
 (related_request_id IS NULL AND related_response_version IS NULL AND NOT related_detached) OR
 (related_request_id IS NOT NULL AND related_request_id<>id AND related_response_version IS NOT NULL AND related_response_version>0));
CREATE INDEX review_followup_source ON origen_review_requests(related_request_id) WHERE related_request_id IS NOT NULL;
CREATE FUNCTION origen_review_followup_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.related_request_id,NEW.related_response_version) IS DISTINCT FROM (OLD.related_request_id,OLD.related_response_version)
  OR OLD.related_detached AND NOT NEW.related_detached THEN RAISE EXCEPTION 'review_followup_reference_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_followup_immutable BEFORE UPDATE OF related_request_id,related_response_version,related_detached ON origen_review_requests
 FOR EACH ROW EXECUTE FUNCTION origen_review_followup_immutable();

-- Preserve the existing access test; the public helper also checks every source
-- dependency, with a bounded depth. It is used by staff reads and queue delivery.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('origen_review_request_live(uuid)'::regprocedure);
 EXECUTE replace(d,'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_live(', 'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_unlinked_live(');
END $$;
CREATE FUNCTION origen_review_followup_current(rid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r origen_review_requests%ROWTYPE; parent origen_review_requests%ROWTYPE; depth integer:=0; seen uuid[]:=ARRAY[rid];
BEGIN
 SELECT * INTO r FROM origen_review_requests WHERE id=rid;
 IF r.id IS NULL THEN RETURN false; END IF;
 WHILE r.related_request_id IS NOT NULL LOOP
  depth:=depth+1;
  IF depth>8 OR r.related_detached OR r.related_request_id=ANY(seen) THEN RETURN false; END IF;
  SELECT * INTO parent FROM origen_review_requests WHERE id=r.related_request_id;
  IF parent.id IS NULL OR (parent.account_id,parent.student_id,parent.connection_id,parent.coordinator_id,parent.institution_id)
   IS DISTINCT FROM (r.account_id,r.student_id,r.connection_id,r.coordinator_id,r.institution_id)
   OR NOT origen_review_request_unlinked_live(parent.id)
   OR NOT EXISTS(SELECT 1 FROM origen_review_request_responses a WHERE a.request_id=parent.id
    AND a.version=r.related_response_version AND a.withdrawn_at IS NULL) THEN RETURN false; END IF;
  seen:=array_append(seen,parent.id);r:=parent;
 END LOOP;
 RETURN true;
END $$;
DO $$ DECLARE d text; anchor text:='WHERE r.id=rid AND r.status='; BEGIN
 d:=pg_get_functiondef('origen_review_request_unlinked_live(uuid)'::regprocedure);
 d:=replace(d,'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_unlinked_live(', 'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_live(');
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_access'; END IF;
 -- Keep ordinary requests on the original query plan. A nested SQL wrapper
 -- would repeatedly plan its large access query during bounded voice lookup.
 EXECUTE replace(d,anchor,'WHERE r.id=rid AND (r.related_request_id IS NULL OR origen_review_followup_current(r.id)) AND r.status=');
END $$;
CREATE FUNCTION origen_review_followup_context(rid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT CASE WHEN origen_review_followup_current(r.id) THEN jsonb_build_object('availability','current',
  'source',jsonb_build_object('kind','review-response','requestId',p.id,'responseVersion',r.related_response_version),
  'responseVersion',r.related_response_version,'question',pub.payload->>'question','coordinatorName',a.author_name,'respondedAt',a.updated_at)
  ELSE jsonb_build_object('availability','unavailable','source',NULL,'responseVersion',r.related_response_version) END
 FROM origen_review_requests r LEFT JOIN origen_review_requests p ON p.id=r.related_request_id
 LEFT JOIN origen_review_request_publications pub ON pub.request_id=p.id
 LEFT JOIN origen_review_request_responses a ON a.request_id=p.id
 WHERE r.id=rid AND r.related_request_id IS NOT NULL
$$;

-- No resurrection after a source changes. Invalidation scrubs only the approved
-- shared payload; the child's independently written private question remains.
CREATE FUNCTION origen_review_followup_boundary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE parent_id uuid; child uuid;
BEGIN
 parent_id:=(CASE WHEN TG_TABLE_NAME='origen_review_requests' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(OLD)->>'request_id' END)::uuid;
 FOR child IN SELECT id FROM origen_review_requests WHERE related_request_id=parent_id AND NOT related_detached ORDER BY id LOOP
  UPDATE origen_review_requests SET related_detached=true WHERE id=child;
  PERFORM origen_review_request_invalidate(child,'source_changed');
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER review_followup_response_changed AFTER UPDATE OR DELETE ON origen_review_request_responses
 FOR EACH ROW EXECUTE FUNCTION origen_review_followup_boundary();
CREATE TRIGGER review_followup_request_deleted AFTER DELETE ON origen_review_requests
 FOR EACH ROW EXECUTE FUNCTION origen_review_followup_boundary();
CREATE TRIGGER review_followup_access_changed AFTER UPDATE OF invalidated_at ON origen_review_request_publications
 FOR EACH ROW WHEN(OLD.invalidated_at IS DISTINCT FROM NEW.invalidated_at AND NEW.invalidated_at IS NOT NULL)
 EXECUTE FUNCTION origen_review_followup_boundary();

-- Add the optional source to the existing creation fingerprint and insert. The
-- existing creation receipt still wins on retry, including after source loss.
DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_review_request_base_command(jsonb)'::regprocedure);
 anchor:='''proposedClarification'',''entries'']';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_create_keys'; END IF;
 d:=replace(d,anchor,'''proposedClarification'',''entries'',''relatedResponse'']');
 anchor:='IF jsonb_array_length(input->''entries'')>20';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_validation'; END IF;
 d:=replace(d,anchor,$patch$
 IF input ? 'relatedResponse' AND (jsonb_typeof(input->'relatedResponse') IS DISTINCT FROM 'object'
  OR (input->'relatedResponse')-ARRAY['kind','requestId','responseVersion']<>'{}'::jsonb
  OR input->'relatedResponse'->>'kind' IS DISTINCT FROM 'review-response'
  OR coalesce(input->'relatedResponse'->>'requestId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR jsonb_typeof(input->'relatedResponse'->'responseVersion') IS DISTINCT FROM 'number'
  OR coalesce(input->'relatedResponse'->>'responseVersion','') !~ '^[1-9][0-9]*$')
  THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 $patch$||anchor);
 anchor:='INSERT INTO origen_review_requests(account_id,student_id,request_key,payload_digest,created_by,connection_id,coordinator_id,institution_id,';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_insert'; END IF;
 d:=replace(d,anchor,$patch$
 IF input ? 'relatedResponse' THEN
  IF coalesce(current_setting('origen.review_followups',true),'false')<>'true' THEN RETURN '{"error":"review_followups_paused"}'; END IF;
  PERFORM 1 FROM origen_review_requests WHERE id=(input->'relatedResponse'->>'requestId')::uuid AND account_id=owner AND student_id=student AND connection_id=c.id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"error":"review_request_source_changed"}'; END IF;
  PERFORM 1 FROM origen_review_request_responses WHERE request_id=(input->'relatedResponse'->>'requestId')::uuid FOR SHARE;
 END IF;
 $patch$||anchor);
 anchor:='origin,language,kind,original_question,proposed_clarification)';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_columns'; END IF;
 d:=replace(d,anchor,'origin,language,kind,original_question,proposed_clarification,related_request_id,related_response_version)');
 anchor:='input->>''proposedClarification'') RETURNING * INTO r;';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_values'; END IF;
 d:=replace(d,anchor,$patch$input->>'proposedClarification',(input->'relatedResponse'->>'requestId')::uuid,(input->'relatedResponse'->>'responseVersion')::integer) RETURNING * INTO r;
 IF NOT origen_review_followup_current(r.id) THEN RAISE EXCEPTION 'review_request_source_changed' USING ERRCODE='P0011'; END IF;$patch$);
 d:=replace(d,'EXCEPTION WHEN invalid_text_representation', 'EXCEPTION WHEN SQLSTATE ''P0011'' THEN RETURN ''{"error":"review_request_source_changed"}''; WHEN invalid_text_representation');
 EXECUTE d;

 d:=pg_get_functiondef('origen_review_request_submission_command(jsonb)'::regprocedure);
 d:=replace(d,'''proposedClarification'',''entries'',''enabled'']','''proposedClarification'',''entries'',''relatedResponse'',''enabled'']');
 anchor:='-- Lock sources before request/preview/publication rows to match invalidation.';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_lock'; END IF;
 d:=replace(d,anchor,$patch$
 IF r.related_request_id IS NOT NULL THEN
  IF coalesce(current_setting('origen.review_followups',true),'false')<>'true' THEN RETURN '{"error":"review_followups_paused"}'; END IF;
  PERFORM 1 FROM origen_review_requests WHERE id=r.related_request_id FOR UPDATE;
  PERFORM 1 FROM origen_review_request_responses WHERE request_id=r.related_request_id FOR SHARE;
  IF NOT origen_review_followup_current(r.id) THEN RETURN '{"error":"review_request_source_changed"}'; END IF;
 END IF;
 $patch$||anchor);
 anchor:='''policyVersion'',''review-request-v1'',''entries'',entries);';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_payload'; END IF;
 d:=replace(d,anchor,anchor||$patch$
 IF r.related_request_id IS NOT NULL THEN payload:=payload||jsonb_build_object('relatedResponse',origen_review_followup_context(r.id)); END IF;
 $patch$);
 EXECUTE d;

 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 anchor:='''submittedAt'',r.submitted_at';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_receipt'; END IF;
 EXECUTE replace(d,anchor,'''relatedResponse'',origen_review_followup_context(r.id),'||anchor);
 d:=pg_get_functiondef('origen_coordinator_review_command(jsonb)'::regprocedure);
 anchor:='''question'',pub.payload->>''question'',''entries'',pub.payload->''entries''';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_staff_view'; END IF;
 EXECUTE replace(d,anchor,anchor||',''relatedResponse'',pub.payload->''relatedResponse''');

 -- The optional voice argument goes into the same draft and preview. It cannot
 -- choose a transcript, recipient permission, consent or publication payload.
 d:=pg_get_functiondef('origen_review_voice_command(jsonb)'::regprocedure);
 anchor:='''proposedClarification'',input->>''question'',''entries'',input->''entries''));';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_followup_voice'; END IF;
 EXECUTE replace(d,anchor,$patch$'proposedClarification',input->>'question','entries',input->'entries')||CASE WHEN input ? 'relatedResponse' THEN jsonb_build_object('relatedResponse',input->'relatedResponse') ELSE '{}'::jsonb END);$patch$);
END $$;
CREATE FUNCTION origen_review_followups_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_review_requests SET related_detached=true WHERE related_request_id IS NOT NULL;
 DELETE FROM origen_review_request_previews WHERE request_id IN(SELECT id FROM origen_review_requests WHERE related_request_id IS NOT NULL);
$$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_review_request_unlinked_live(uuid)','origen_review_followup_current(uuid)',
  'origen_review_followup_context(uuid)','origen_review_followup_boundary()','origen_review_followups_after_restore()','origen_review_followup_immutable()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

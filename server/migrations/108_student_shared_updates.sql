-- A student update is an explicitly approved snapshot in the existing request
-- system. No private report table is joined, copied, granted or projected here.
ALTER TABLE origen_review_requests DROP CONSTRAINT origen_review_requests_kind_check;
ALTER TABLE origen_review_requests ADD CONSTRAINT origen_review_requests_kind_check
 CHECK(kind IN ('question','concern','review','student-update'));
ALTER TABLE origen_review_requests ADD CONSTRAINT student_update_source_required
 CHECK(kind<>'student-update' OR related_request_id IS NOT NULL);

DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_review_request_base_command(jsonb)'::regprocedure);
 anchor:='input->>''kind'' NOT IN (''question'',''concern'',''review'')';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_kind'; END IF;
 d:=replace(d,anchor,'input->>''kind'' NOT IN (''question'',''concern'',''review'',''student-update'')');
 anchor:='IF jsonb_array_length(input->''entries'')>20';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_validation'; END IF;
 d:=replace(d,anchor,$patch$
 IF input->>'kind'='student-update' AND NOT input ? 'relatedResponse'
  THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 $patch$||anchor);
 -- Preserve the original idempotency receipt on retries after a pause. Only
 -- creating a new draft needs the rollout capability at this point.
 anchor:='INSERT INTO origen_review_requests(account_id,student_id,request_key,payload_digest,created_by,connection_id,coordinator_id,institution_id,';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_create'; END IF;
 d:=replace(d,anchor,$patch$
 IF input->>'kind'='student-update' AND coalesce(current_setting('origen.student_updates',true),'false')<>'true'
  THEN RETURN '{"error":"student_updates_paused"}'; END IF;
 $patch$||anchor);
 EXECUTE d;

 d:=pg_get_functiondef('origen_review_request_submission_command(jsonb)'::regprocedure);
 anchor:='-- Lock sources before request/preview/publication rows to match invalidation.';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_approval'; END IF;
 d:=replace(d,anchor,$patch$
 IF r.kind='student-update' AND coalesce(current_setting('origen.student_updates',true),'false')<>'true'
  THEN RETURN '{"error":"student_updates_paused"}'; END IF;
 $patch$||anchor);
 anchor:='''policyVersion'',''review-request-v1'',''entries'',entries);';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_payload'; END IF;
 d:=replace(d,anchor,anchor||$patch$
 IF r.kind='student-update' THEN payload:=payload||jsonb_build_object('provenance','student_reported','snapshotPolicy','separate-copy-v1'); END IF;
 $patch$);
 EXECUTE d;

 d:=pg_get_functiondef('origen_coordinator_review_command(jsonb)'::regprocedure);
 anchor:='''question'',pub.payload->>''question'',''entries'',pub.payload->''entries''';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_student_update_read'; END IF;
 EXECUTE replace(d,anchor,anchor||',''provenance'',pub.payload->>''provenance'',''snapshotPolicy'',pub.payload->>''snapshotPolicy''');
END $$;

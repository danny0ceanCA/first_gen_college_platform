-- Owner-only notebook discovery. Approval still uses the exact step 2 command.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('origen_review_request_command(jsonb)'::regprocedure);
 EXECUTE replace(d,'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_command(', 'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_submission_command(');
END $$;

CREATE OR REPLACE FUNCTION origen_review_request_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 owner uuid; student text:=input->>'studentId'; eligible boolean; cursor_row origen_review_requests%ROWTYPE;
 result jsonb; recipients jsonb; entries jsonb; activity jsonb; next_id uuid;
BEGIN
 IF action IS NULL OR action NOT IN ('list','options') THEN RETURN origen_review_request_submission_command(input); END IF;
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_request_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(btrim(student)) NOT BETWEEN 1 AND 128
  OR input-ARRAY['action','studentId','enabled','before']<>'{}'::jsonb OR action='options' AND input ? 'before'
  OR input ? 'before' AND jsonb_typeof(input->'before') IS DISTINCT FROM 'string' THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
 IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR NO KEY UPDATE;
 IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"review_request_unavailable"}'; END IF;
 eligible:=origen_coordinator_student_ready(owner,student);
 IF action='list' THEN
  IF input ? 'before' THEN
   SELECT * INTO cursor_row FROM origen_review_requests WHERE id=(input->>'before')::uuid AND account_id=owner AND student_id=student;
   IF cursor_row.id IS NULL THEN RETURN '{"error":"review_request_list_changed"}'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(origen_review_request_view(r.id) ORDER BY r.created_at DESC,r.id DESC),'[]') INTO result FROM
   (SELECT id,created_at FROM origen_review_requests WHERE account_id=owner AND student_id=student
    AND (cursor_row.id IS NULL OR (created_at,id)<(cursor_row.created_at,cursor_row.id)) ORDER BY created_at DESC,id DESC LIMIT 31) r;
  IF jsonb_array_length(result)>30 THEN next_id:=(result->29->>'id')::uuid;result:=result-30; END IF;
  -- All note annotations survive history pagination; no question/note prose is
  -- duplicated here. The newest request for each note links back to history.
  WITH receipts AS MATERIALIZED (
   SELECT r.id,r.status,r.created_at,r.coordinator_name,r.organization_name,
    origen_review_request_view(r.id)->'publication' AS publication
   FROM origen_review_requests r WHERE r.account_id=owner AND r.student_id=student
  ), latest AS (
   SELECT DISTINCT ON(e.entry_id) e.entry_id,r.* FROM receipts r JOIN origen_review_request_entries e ON e.request_id=r.id
   ORDER BY e.entry_id,r.created_at DESC,r.id DESC
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('entryId',entry_id,'id',id,'status',status,'createdAt',created_at,
    'recipient',jsonb_build_object('coordinatorName',coordinator_name,'organizationName',organization_name),'publication',publication)),'[]') INTO activity FROM latest;
  RETURN jsonb_build_object('available',eligible,'enabled',eligible AND coalesce(input->'enabled'='true'::jsonb,false),'deliveryEnabled',false,'requests',result,'nextCursor',next_id,'activity',activity);
 END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"review_requests_paused"}'; END IF;
 IF NOT eligible THEN RETURN '{"error":"review_request_denied"}'; END IF;
 PERFORM set_config('origen.derived_sharing','false',true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'coordinatorName',p.display_name,'organizationName',i.draft->>'name') ORDER BY c.created_at,c.id),'[]') INTO recipients
 FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id
 JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id JOIN origen_institutions i ON i.id=o.institution_id
 JOIN origen_institution_members m ON m.institution_id=i.id AND m.auth0_subject=p.auth0_subject
 WHERE c.account_id=owner AND c.student_id=student AND c.status='accepted' AND p.status='active' AND o.status='active'
 AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM origen_staff_access_controls s WHERE s.subject_hash=encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex') AND s.blocked);
 -- Existing notebook capacity is 2,000 notes/account. Only eligible manual
 -- sources are returned, even when derived binder sharing is enabled elsewhere.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',source_version,'topic',topic,'kind',kind,'language',language,'content',content) ORDER BY topic,id),'[]') INTO entries FROM origen_binder_eligible_entries(owner,student);
 RETURN jsonb_build_object('connections',recipients,'entries',entries);
EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_review_request"}';
END $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_review_request_submission_command(jsonb)','origen_review_request_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

-- Preserve the existing authorization and lock order. Identical decisions from
-- the same reviewer may acknowledge a committed result after response loss,
-- but never update the application, reactivate access, or repeat side effects.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 definition := pg_get_functiondef('origen_coordinator_application_command(jsonb)'::regprocedure);
 old_text := $old$ IF NOT FOUND OR application.status<>'pending' THEN RAISE EXCEPTION 'application_changed' USING ERRCODE='40001'; END IF;
 IF application.auth0_subject=actor THEN$old$;
 new_text := $new$ IF NOT FOUND THEN RAISE EXCEPTION 'application_changed' USING ERRCODE='40001'; END IF;
 IF application.status<>'pending' THEN
  IF application.reviewed_by=actor AND application.review_note=input->>'reviewNote'
   AND ((action='approve-application' AND application.status='approved' AND application.institution_id=org.id)
    OR (action='decline-application' AND application.status='declined')) THEN
   RETURN '{"ok":true,"replayed":true}'::jsonb;
  END IF;
  RAISE EXCEPTION 'application_changed' USING ERRCODE='40001';
 END IF;
 IF application.auth0_subject=actor THEN$new$;
 IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'approval_recovery_migration_source_mismatch'; END IF;
 EXECUTE replace(definition,old_text,new_text);

 -- The legacy overview retains its shape for coordinator workspaces. The
 -- admin queue gets bounded, stable pagination and database-side search.
 definition := pg_get_functiondef('origen_coordinator_command(jsonb)'::regprocedure);
 old_text := $old$ IF action='overview' THEN$old$;
 new_text := $new$ IF action='organization-queue' THEN
  IF NOT admin THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
  WITH candidates AS (
   SELECT i.id,jsonb_build_object('id',i.id,'name',i.draft->>'name','role',m.role,
    'pilotStatus',COALESCE(o.status,'not-approved'),'verificationStatus',i.verification_status) item
   FROM origen_institutions i
   LEFT JOIN origen_institution_members m ON m.institution_id=i.id AND m.auth0_subject=actor
   LEFT JOIN origen_coordinator_organizations o ON o.institution_id=i.id
   WHERE i.archived_at IS NULL
    AND (NULLIF(input->>'after','') IS NULL OR i.id>(input->>'after')::uuid)
    AND strpos(lower(COALESCE(i.draft->>'name','')),lower(COALESCE(input->>'search','')))>0
   ORDER BY i.id LIMIT 51
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT 50)
  SELECT jsonb_build_object('organizations',COALESCE((SELECT jsonb_agg(item ORDER BY id) FROM page),'[]'::jsonb),
   'next',CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
   'canApprove',true) INTO result;
  RETURN result;
 END IF;
 IF action='overview' THEN$new$;
 IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'organization_queue_migration_source_mismatch'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END $migration$;

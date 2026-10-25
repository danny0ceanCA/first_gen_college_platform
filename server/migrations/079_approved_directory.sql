-- Approved records remain discoverable after leaving the pending queues.
-- Statistics contain counts only, never student identities or conversation text.
CREATE FUNCTION origen_admin_approved_directory(input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); result jsonb;
 application origen_coordinator_applications%ROWTYPE; profile origen_coordinator_profiles%ROWTYPE;
 live boolean:=false; days integer:=coalesce((input->>'days')::integer,30);
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'analytics'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND blocked)
 THEN RAISE EXCEPTION 'approved_directory_denied' USING ERRCODE='42501'; END IF;
 IF input->>'action'='approved-directory' THEN
  WITH records AS (
   SELECT i.id,jsonb_build_object('id',i.id,'name',i.draft->>'name','status',coalesce(o.status,'not-approved')) item,
    coalesce(i.draft->>'name','') search
   FROM origen_institutions i LEFT JOIN origen_coordinator_organizations o ON o.institution_id=i.id
   WHERE input->>'kind'='organizations' AND i.verification_status='verified' AND i.archived_at IS NULL
   UNION ALL
   SELECT a.id,jsonb_build_object('id',a.id,'name',a.display_name,'email',a.verified_email,
    'organizationId',a.institution_id,'organizationName',coalesce(i.draft->>'name',a.organization_name),
    'jobRole',a.job_role,'approvedAt',a.reviewed_at,'status',CASE WHEN EXISTS(
     SELECT 1 FROM origen_organization_active_coordinators(a.institution_id) p WHERE p.auth0_subject=a.auth0_subject
    ) THEN 'active' ELSE 'inactive' END),
    concat_ws(' ',a.display_name,a.verified_email,coalesce(i.draft->>'name',a.organization_name))
   FROM origen_coordinator_applications a LEFT JOIN origen_institutions i ON i.id=a.institution_id
   WHERE input->>'kind'='coordinators' AND a.status='approved'
  ), candidates AS (
   SELECT * FROM records WHERE (nullif(input->>'after','') IS NULL OR id>(input->>'after')::uuid)
    AND strpos(lower(search),lower(coalesce(input->>'search','')))>0 ORDER BY id LIMIT 51
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT 50)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY id) FROM page),'[]'::jsonb),
   'next',CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) END) INTO result;
  RETURN result;
 END IF;
 IF input->>'action'<>'coordinator-overview' OR days NOT IN (7,30,90) THEN RAISE EXCEPTION 'invalid_directory_filter' USING ERRCODE='22023'; END IF;
 SELECT * INTO application FROM origen_coordinator_applications WHERE id=(input->>'id')::uuid AND status='approved';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO profile FROM origen_coordinator_profiles WHERE institution_id=application.institution_id AND auth0_subject=application.auth0_subject;
 live:=EXISTS(SELECT 1 FROM origen_organization_active_coordinators(application.institution_id) p WHERE p.id=profile.id);
 WITH connections AS (
  SELECT c.* FROM origen_binder_connections c WHERE live AND c.coordinator_id=profile.id
   AND c.status IN ('requested','accepted') AND c.expires_at>now() AND origen_coordinator_student_ready(c.account_id,c.student_id)
 ), guidance AS (
  SELECT f.* FROM origen_coordinator_feedback f JOIN origen_binder_share_grants g ON g.id=f.grant_id
   JOIN origen_coordinator_profiles p ON p.id=g.coordinator_id
  WHERE p.institution_id=application.institution_id AND f.author_subject=application.auth0_subject
   AND f.created_at>=now()-make_interval(days=>days) AND f.created_at<now()
   AND f.withdrawn_at IS NULL AND f.removed_at IS NULL
 )
 SELECT jsonb_build_object('id',application.id,'days',days,'generatedAt',now(),'active',live,
  'linkedStudents',(SELECT count(DISTINCT(account_id,student_id)) FROM connections WHERE status='accepted'),
  'pendingConnections',(SELECT count(*) FROM connections WHERE status='requested'),
  'sharedBinders',(SELECT count(DISTINCT(g.account_id,g.student_id)) FROM origen_coordinator_visible_binders(profile.id) v
   JOIN origen_binder_share_grants g ON g.id=v.id WHERE live),
  'guidanceEntries',(SELECT count(*) FROM guidance),
  'reviewedEntries',(SELECT count(*) FROM guidance WHERE reviewed_version=version),
  'lastGuidanceAt',(SELECT max(coalesce(edited_at,created_at)) FROM guidance)
 ) INTO result;
 RETURN result;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_admin_approved_directory(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_admin_approved_directory(jsonb) FROM PUBLIC;

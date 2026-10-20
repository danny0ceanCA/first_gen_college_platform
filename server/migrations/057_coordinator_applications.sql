-- Applications never create organization membership, codes, or sharing grants.
CREATE TABLE origen_coordinator_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth0_subject text NOT NULL UNIQUE REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 100),
 verified_email text NOT NULL CHECK(length(verified_email) BETWEEN 3 AND 320),
 organization_name text NOT NULL CHECK(length(btrim(organization_name)) BETWEEN 1 AND 200),
 organization_website text NOT NULL CHECK(length(organization_website) BETWEEN 1 AND 2000),
 job_role text NOT NULL CHECK(length(btrim(job_role)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
 institution_id uuid REFERENCES origen_institutions(id) ON DELETE SET NULL,
 review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 reviewed_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz
);
ALTER TABLE origen_coordinator_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_coordinator_applications FROM PUBLIC;

CREATE FUNCTION origen_coordinator_application_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text:=NULLIF(current_setting('origen.subject',true),'');
 action text:=input->>'action';
 application origen_coordinator_applications%ROWTYPE;
 org origen_institutions%ROWTYPE;
 result jsonb;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'account' THEN
  RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501';
 END IF;
 IF action IN ('application-status','submit-application','withdraw-application') THEN
  -- Serialize first registration with account deletion, even without a personal account.
  INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
  IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN
   RAISE EXCEPTION 'account_closed' USING ERRCODE='42501';
  END IF;
  IF action='submit-application' THEN
   INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role)
    VALUES(actor,input->>'displayName',input->>'verifiedEmail',input->>'jobRole') ON CONFLICT DO NOTHING;
   INSERT INTO origen_coordinator_applications(auth0_subject,display_name,verified_email,organization_name,organization_website,job_role)
    VALUES(actor,input->>'displayName',input->>'verifiedEmail',input->>'organizationName',input->>'organizationWebsite',input->>'jobRole')
    ON CONFLICT(auth0_subject) DO NOTHING;
  ELSIF action='withdraw-application' THEN
   DELETE FROM origen_coordinator_applications WHERE auth0_subject=actor AND status<>'approved';
  END IF;
  SELECT jsonb_build_object('id',a.id,'displayName',a.display_name,'email',a.verified_email,'organizationName',a.organization_name,
   'organizationWebsite',a.organization_website,'jobRole',a.job_role,'status',a.status,'reviewNote',a.review_note,
   'createdAt',a.created_at,'reviewedAt',a.reviewed_at) INTO result FROM origen_coordinator_applications a WHERE auth0_subject=actor;
  RETURN jsonb_build_object('application',result);
 END IF;
 IF COALESCE(current_setting('origen.coordinator_verified',true),'false')<>'true'
  OR COALESCE(current_setting('origen.coordinator_admin',true),'false')<>'true'
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND
   (blocked OR COALESCE(NULLIF(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN
  RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501';
 END IF;
 IF action='applications' THEN
  SELECT COALESCE(jsonb_agg(item ORDER BY id),'[]') INTO result FROM (
   SELECT a.id,jsonb_build_object('id',a.id,'displayName',a.display_name,'email',a.verified_email,
    'organizationName',a.organization_name,'organizationWebsite',a.organization_website,'jobRole',a.job_role,'createdAt',a.created_at) item
   FROM origen_coordinator_applications a WHERE a.status='pending' AND (NULLIF(input->>'after','') IS NULL OR a.id>(input->>'after')::uuid)
   ORDER BY a.id LIMIT 51
  ) pending;
  RETURN jsonb_build_object('applications',result);
 END IF;
 IF action NOT IN ('approve-application','decline-application') THEN RAISE EXCEPTION 'invalid_coordinator_action' USING ERRCODE='22023'; END IF;
 -- Match the existing institution -> membership -> profile lock order.
 IF action='approve-application' THEN
  SELECT * INTO org FROM origen_institutions WHERE id=(input->>'institutionId')::uuid FOR UPDATE;
  IF NOT FOUND OR org.archived_at IS NOT NULL OR org.verification_status<>'verified' OR org.parent_approval<>'approved'
   OR NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations WHERE institution_id=org.id AND status='active') THEN
   RAISE EXCEPTION 'organization_verification_required' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM origen_institution_members WHERE auth0_subject=actor AND institution_id IN (org.id,org.parent_institution_id)) THEN
   RAISE EXCEPTION 'independent_review_required' USING ERRCODE='42501';
  END IF;
 END IF;
 SELECT * INTO application FROM origen_coordinator_applications WHERE id=(input->>'id')::uuid FOR UPDATE;
 IF NOT FOUND OR application.status<>'pending' THEN RAISE EXCEPTION 'application_changed' USING ERRCODE='40001'; END IF;
 IF application.auth0_subject=actor THEN RAISE EXCEPTION 'independent_review_required' USING ERRCODE='42501'; END IF;
 IF action='approve-application' THEN
  IF NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=application.auth0_subject) THEN
   RAISE EXCEPTION 'application_membership_required' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(application.auth0_subject,'UTF8')),'hex') AND blocked) THEN
   RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO origen_coordinator_profiles(institution_id,auth0_subject,display_name,status)
   VALUES(org.id,application.auth0_subject,application.display_name,'active')
   ON CONFLICT(institution_id,auth0_subject) DO UPDATE SET status='active',display_name=EXCLUDED.display_name;
  INSERT INTO origen_institution_access_events(institution_id,actor_subject,action,target_subject)
   VALUES(org.id,actor,'coordinator-approve-application',application.auth0_subject);
 END IF;
 UPDATE origen_coordinator_applications SET status=CASE WHEN action='approve-application' THEN 'approved' ELSE 'declined' END,
  institution_id=org.id,review_note=input->>'reviewNote',reviewed_by=actor,reviewed_at=now() WHERE id=application.id;
 RETURN '{"ok":true}'::jsonb;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_coordinator_application_command(jsonb) SET search_path TO %I, pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_coordinator_application_command(jsonb) FROM PUBLIC;

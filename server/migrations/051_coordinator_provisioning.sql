-- Coordinator provisioning only. The runtime still has no direct privileges
-- or RLS policies on profiles, codes, grants, publications or family data.
CREATE TABLE origen_coordinator_organizations (
 institution_id uuid PRIMARY KEY REFERENCES origen_institutions(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('active','suspended')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 approved_by text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE origen_coordinator_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_coordinator_organizations FROM PUBLIC;

CREATE FUNCTION origen_coordinator_disable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  NEW.revision := OLD.revision+1;
  IF NEW.status <> 'active' THEN
   UPDATE origen_coordinator_codes SET revoked_at=COALESCE(revoked_at,now()) WHERE coordinator_id=NEW.id;
   UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1,current_publication_id=NULL WHERE coordinator_id=NEW.id AND status<>'revoked';
   UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE coordinator_id=NEW.id AND status IN ('requested','accepted');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_disable BEFORE UPDATE OF status ON origen_coordinator_profiles FOR EACH ROW EXECUTE FUNCTION origen_coordinator_disable();

CREATE FUNCTION origen_coordinator_suspend_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.status='suspended' THEN
  UPDATE origen_coordinator_profiles SET status='disabled' WHERE institution_id=NEW.institution_id AND status='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_suspend_organization AFTER UPDATE OF status ON origen_coordinator_organizations FOR EACH ROW EXECUTE FUNCTION origen_coordinator_suspend_organization();

CREATE FUNCTION origen_coordinator_institution_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL OR NEW.verification_status<>'verified' THEN
  UPDATE origen_coordinator_organizations SET status='suspended',revision=revision+1,updated_at=now() WHERE institution_id=NEW.id AND status='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_institution_change AFTER UPDATE OF archived_at,verification_status ON origen_institutions FOR EACH ROW EXECUTE FUNCTION origen_coordinator_institution_change();

CREATE FUNCTION origen_coordinator_staff_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 -- Restoring a staff account never restores a previous code or sharing grant.
 IF NEW.blocked OR (TG_OP='UPDATE' AND NEW.token_valid_after IS DISTINCT FROM OLD.token_valid_after) THEN
  UPDATE origen_coordinator_profiles SET status='disabled' WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=NEW.subject_hash AND status='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_staff_change AFTER INSERT OR UPDATE ON origen_staff_access_controls FOR EACH ROW EXECUTE FUNCTION origen_coordinator_staff_change();

CREATE FUNCTION origen_coordinator_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text := NULLIF(current_setting('origen.subject',true),'');
 admin boolean := COALESCE(current_setting('origen.coordinator_admin',true),'false')='true';
 action text := input->>'action';
 org origen_institutions%ROWTYPE;
 pilot origen_coordinator_organizations%ROWTYPE;
 profile origen_coordinator_profiles%ROWTYPE;
 member_role text;
 target_name text;
 result jsonb;
BEGIN
 IF actor IS NULL OR COALESCE(current_setting('origen.coordinator_verified',true),'false')<>'true'
  OR COALESCE(current_setting('origen.purpose',true),'')<>'account'
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND
    (blocked OR COALESCE(NULLIF(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN
  RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501';
 END IF;
 IF action='overview' THEN
  SELECT COALESCE(jsonb_agg(row_data),'[]') INTO result FROM (
   SELECT jsonb_build_object('id',i.id,'name',i.draft->>'name','role',m.role,
    'pilotStatus',COALESCE(o.status,'not-approved'),'verificationStatus',i.verification_status,
    'profile',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'displayName',p.display_name,'status',p.status) END) row_data
   FROM origen_institutions i
   LEFT JOIN origen_institution_members m ON m.institution_id=i.id AND m.auth0_subject=actor
   LEFT JOIN origen_coordinator_profiles p ON p.institution_id=i.id AND p.auth0_subject=actor
   LEFT JOIN origen_coordinator_organizations o ON o.institution_id=i.id
   WHERE i.archived_at IS NULL AND (admin OR m.role='owner' OR p.status='active' AND o.status='active' AND i.verification_status='verified')
   ORDER BY i.created_at DESC LIMIT 100
  ) visible;
  IF NOT admin AND jsonb_array_length(result)=0 THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('organizations',result,'canApprove',admin,'sharingEnabled',false);
 END IF;
 -- All membership, code and lifecycle changes serialize on the institution,
 -- matching the existing invitation/removal repository's lock order.
 SELECT * INTO org FROM origen_institutions WHERE id=(input->>'id')::uuid FOR UPDATE;
 IF NOT FOUND OR org.archived_at IS NOT NULL THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
 SELECT role INTO member_role FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=actor;
 IF action IN ('approve-organization','suspend-organization') THEN
  IF NOT admin THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
  IF action='approve-organization' THEN
   IF member_role IS NOT NULL OR EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.parent_institution_id AND auth0_subject=actor)
    THEN RAISE EXCEPTION 'independent_review_required' USING ERRCODE='42501'; END IF;
   IF org.verification_status<>'verified' OR org.parent_approval<>'approved' THEN RAISE EXCEPTION 'organization_verification_required' USING ERRCODE='42501'; END IF;
   INSERT INTO origen_coordinator_organizations(institution_id,status,approved_by) VALUES(org.id,'active',actor)
   ON CONFLICT(institution_id) DO UPDATE SET status='active',revision=origen_coordinator_organizations.revision+1,approved_by=actor,approved_at=now(),updated_at=now();
  ELSE
   UPDATE origen_coordinator_organizations SET status='suspended',revision=revision+1,updated_at=now() WHERE institution_id=org.id;
  END IF;
 ELSIF action IN ('enable-member','disable-member','team') THEN
  IF member_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
  IF action='team' THEN
   SELECT COALESCE(jsonb_agg(jsonb_build_object('subject',m.auth0_subject,'name',r.first_name,'role',m.role,'coordinatorStatus',COALESCE(p.status,'disabled')) ORDER BY r.first_name),'[]') INTO result
    FROM origen_institution_members m JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject
    LEFT JOIN origen_coordinator_profiles p ON p.institution_id=m.institution_id AND p.auth0_subject=m.auth0_subject WHERE m.institution_id=org.id;
   RETURN jsonb_build_object('members',result);
  END IF;
  SELECT r.first_name INTO target_name FROM origen_institution_members m JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject
   WHERE m.institution_id=org.id AND m.auth0_subject=input->>'subject';
  IF NOT FOUND THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
  IF action='enable-member' THEN
   SELECT * INTO pilot FROM origen_coordinator_organizations WHERE institution_id=org.id;
   IF pilot.status IS DISTINCT FROM 'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved'
    OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(input->>'subject','UTF8')),'hex') AND blocked)
    THEN RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501'; END IF;
   INSERT INTO origen_coordinator_profiles(institution_id,auth0_subject,display_name,status) VALUES(org.id,input->>'subject',COALESCE(NULLIF(btrim(target_name),''),'Coordinator'),'active')
    ON CONFLICT(institution_id,auth0_subject) DO UPDATE SET status='active';
  ELSE
   UPDATE origen_coordinator_profiles SET status='disabled' WHERE institution_id=org.id AND auth0_subject=input->>'subject';
  END IF;
 ELSE
  SELECT * INTO pilot FROM origen_coordinator_organizations WHERE institution_id=org.id;
  SELECT * INTO profile FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor FOR UPDATE;
  IF member_role IS NULL OR pilot.status IS DISTINCT FROM 'active' OR profile.status IS DISTINCT FROM 'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' THEN
   RAISE EXCEPTION 'coordinator_access_denied' USING ERRCODE='42501';
  END IF;
  IF action='profile' THEN
   SELECT jsonb_build_object('id',profile.id,'displayName',profile.display_name,'organizationName',org.draft->>'name','status',profile.status,
    'code', (SELECT jsonb_build_object('expiresAt',expires_at,'createdAt',created_at) FROM origen_coordinator_codes WHERE coordinator_id=profile.id AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1)) INTO result;
   RETURN jsonb_build_object('profile',result);
  ELSIF action='save-profile' THEN
   UPDATE origen_coordinator_profiles SET display_name=btrim(input->>'displayName') WHERE id=profile.id;
  ELSIF action='rotate-code' THEN
   UPDATE origen_coordinator_codes SET revoked_at=now() WHERE coordinator_id=profile.id AND revoked_at IS NULL;
   INSERT INTO origen_coordinator_codes(coordinator_id,code_hash,expires_at) VALUES(profile.id,input->>'codeHash',now()+interval '720 hours')
    RETURNING jsonb_build_object('expiresAt',expires_at) INTO result;
  ELSIF action='revoke-code' THEN
   UPDATE origen_coordinator_codes SET revoked_at=now() WHERE coordinator_id=profile.id AND revoked_at IS NULL;
  ELSE RAISE EXCEPTION 'invalid_coordinator_action' USING ERRCODE='22023';
  END IF;
 END IF;
 INSERT INTO origen_institution_access_events(institution_id,actor_subject,action,target_subject) VALUES(org.id,actor,'coordinator-'||action,CASE WHEN action IN ('enable-member','disable-member') THEN input->>'subject' ELSE NULL END);
 RETURN COALESCE(result,'{"ok":true}'::jsonb);
END $$;

DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_coordinator_disable()','origen_coordinator_suspend_organization()','origen_coordinator_institution_change()','origen_coordinator_staff_change()','origen_coordinator_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO %I, pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

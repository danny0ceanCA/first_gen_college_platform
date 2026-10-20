-- Student choice uses existing account permission, not operator pilot enrollment.
-- Guardian approval is the stored, unexpired permission decision, not email verification.
CREATE OR REPLACE FUNCTION origen_coordinator_student_ready(owner uuid, student text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM origen_accounts a
 JOIN origen_students s ON s.account_id=a.id AND s.id=student
 JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
 WHERE a.id=owner AND a.role='student'
 AND (e.status='adult' OR (e.status='approved' AND e.permission_expires_at>clock_timestamp()))
 AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts x WHERE x.subject_hash=e.subject_hash)
 AND NOT EXISTS(SELECT 1 FROM origen_student_links l WHERE
  (l.member_account_id=owner AND l.member_student_id=student) OR
  (l.owner_account_id=owner AND l.owner_student_id=student)))
$$;

-- Revocation must work even when no legacy pilot row was ever created.
CREATE FUNCTION origen_coordinator_revoke_student_access(owner uuid, student text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 DELETE FROM origen_coordinator_link_contexts WHERE account_id=owner AND (student IS NULL OR student_id=student);
 UPDATE origen_binder_connections SET status='revoked',revision=revision+1
 WHERE account_id=owner AND (student IS NULL OR student_id=student) AND status IN ('requested','accepted');
 UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1,current_publication_id=NULL
 WHERE account_id=owner AND (student IS NULL OR student_id=student) AND status<>'revoked';
 DELETE FROM origen_coordinator_student_pilots WHERE account_id=owner AND (student IS NULL OR student_id=student);
END $$;

CREATE OR REPLACE FUNCTION origen_coordinator_student_boundary_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid;
BEGIN
 IF TG_TABLE_NAME='origen_accounts' THEN
  IF NEW.role IS DISTINCT FROM OLD.role THEN PERFORM origen_coordinator_revoke_student_access(NEW.id); END IF;
 ELSIF TG_TABLE_NAME='origen_eligibility' THEN
  IF TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.revision IS DISTINCT FROM OLD.revision
   OR NEW.permission_expires_at IS DISTINCT FROM OLD.permission_expires_at THEN
   FOR owner IN SELECT id FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=OLD.subject_hash LOOP
    PERFORM origen_coordinator_revoke_student_access(owner);
   END LOOP;
  END IF;
 ELSE
  PERFORM origen_coordinator_revoke_student_access(NEW.owner_account_id,NEW.owner_student_id);
  PERFORM origen_coordinator_revoke_student_access(NEW.member_account_id,NEW.member_student_id);
  IF TG_OP='UPDATE' THEN
   PERFORM origen_coordinator_revoke_student_access(OLD.owner_account_id,OLD.owner_student_id);
   PERFORM origen_coordinator_revoke_student_access(OLD.member_account_id,OLD.member_student_id);
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER coordinator_student_permission_change ON origen_eligibility;
CREATE TRIGGER coordinator_student_permission_change AFTER UPDATE OF status,revision,permission_expires_at OR DELETE
 ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_coordinator_student_boundary_change();

DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_coordinator_student_ready(uuid,text)','origen_coordinator_revoke_student_access(uuid,text)','origen_coordinator_student_boundary_change()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO %I, pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

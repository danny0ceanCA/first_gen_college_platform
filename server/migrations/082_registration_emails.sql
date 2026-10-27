-- Trusted sign-in email is separate from the editable public/work contact.
ALTER TABLE origen_institution_representatives ADD COLUMN verified_email text;
ALTER TABLE origen_institution_representatives ADD COLUMN email_verified_at timestamptz;
UPDATE origen_institution_representatives r SET verified_email=a.verified_email,email_verified_at=a.created_at
 FROM origen_coordinator_applications a WHERE a.auth0_subject=r.auth0_subject;

CREATE TABLE origen_registration_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('organization-received','organization-approved','coordinator-received','coordinator-approved')),
 recipient_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 recipient text NOT NULL,
 name text NOT NULL,
 organization_name text NOT NULL,
 application_id uuid REFERENCES origen_coordinator_applications(id) ON DELETE CASCADE,
 institution_id uuid REFERENCES origen_institutions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token uuid,
 accepted_at timestamptz,
 CHECK((application_id IS NOT NULL)<>(institution_id IS NOT NULL))
);
ALTER TABLE origen_registration_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_registration_emails FROM PUBLIC;
CREATE INDEX registration_email_pending ON origen_registration_emails(available_at) WHERE status IN ('pending','sending');

CREATE FUNCTION origen_registration_email_application() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Only submit-application accepts this value, from server-verified userinfo.
  UPDATE origen_institution_representatives SET verified_email=NEW.verified_email,email_verified_at=now() WHERE auth0_subject=NEW.auth0_subject;
  INSERT INTO origen_registration_emails(event_key,kind,recipient_subject,recipient,name,organization_name,application_id)
   VALUES('coordinator-received:'||NEW.id,'coordinator-received',NEW.auth0_subject,NEW.verified_email,NEW.display_name,NEW.organization_name,NEW.id) ON CONFLICT DO NOTHING;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
  -- Don't send an obsolete pending notice after a decision has been made.
  UPDATE origen_registration_emails SET status='cancelled',recipient='',name='',organization_name=''
   WHERE application_id=NEW.id AND kind='coordinator-received' AND status='pending';
  IF NEW.status='approved' THEN
   INSERT INTO origen_registration_emails(event_key,kind,recipient_subject,recipient,name,organization_name,application_id)
    VALUES('coordinator-approved:'||NEW.id,'coordinator-approved',NEW.auth0_subject,NEW.verified_email,NEW.display_name,
     coalesce((SELECT draft->>'name' FROM origen_institutions WHERE id=NEW.institution_id),NEW.organization_name),NEW.id) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_email_application AFTER INSERT OR UPDATE OF status ON origen_coordinator_applications
 FOR EACH ROW EXECUTE FUNCTION origen_registration_email_application();

-- Called inside the successful organization-registration transaction. No
-- recipient or event kind can be supplied by a browser or reviewer.
CREATE FUNCTION origen_registration_email_organization(org uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),'');
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'account' THEN RETURN; END IF;
 INSERT INTO origen_registration_emails(event_key,kind,recipient_subject,recipient,name,organization_name,institution_id)
 SELECT 'organization-received:'||i.id||':'||r.auth0_subject,'organization-received',r.auth0_subject,r.verified_email,r.first_name,i.draft->>'name',i.id
 FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id AND m.role='owner'
 JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject
 WHERE i.id=org AND r.auth0_subject=actor AND r.verified_email IS NOT NULL AND r.email_verified_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM origen_institution_registration_requests q WHERE q.institution_id=i.id AND q.auth0_subject=actor)
 ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION origen_registration_email_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  UPDATE origen_registration_emails SET status='cancelled',recipient='',name='',organization_name=''
   WHERE institution_id=NEW.institution_id AND kind='organization-received' AND status='pending';
  INSERT INTO origen_registration_emails(event_key,kind,recipient_subject,recipient,name,organization_name,institution_id)
  SELECT 'organization-approved:'||i.id||':'||r.auth0_subject,'organization-approved',r.auth0_subject,r.verified_email,r.first_name,i.draft->>'name',i.id
  FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id AND m.role='owner'
  JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject
  WHERE i.id=NEW.institution_id AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL
  AND r.verified_email IS NOT NULL AND r.email_verified_at IS NOT NULL ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_email_approval AFTER INSERT OR UPDATE OF status ON origen_coordinator_organizations
 FOR EACH ROW EXECUTE FUNCTION origen_registration_email_approval();

-- Only the restricted maintenance role gets EXECUTE. The HTTP role cannot read
-- the queue, enqueue arbitrary recipients, or claim/acknowledge another send.
CREATE FUNCTION origen_registration_email_delivery(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE item origen_registration_emails%ROWTYPE;
BEGIN
 IF input->>'action'='finish' THEN
  UPDATE origen_registration_emails SET status=CASE WHEN input->>'accepted'='true' THEN 'accepted' WHEN attempts>=6 THEN 'failed' ELSE 'pending' END,
   accepted_at=CASE WHEN input->>'accepted'='true' THEN now() ELSE NULL END,
   available_at=now()+make_interval(secs=>least(3600,60*power(3,attempts-1)::integer)),lease_until=NULL,lease_token=NULL,
   recipient=CASE WHEN input->>'accepted'='true' OR attempts>=6 THEN '' ELSE recipient END,
   name=CASE WHEN input->>'accepted'='true' OR attempts>=6 THEN '' ELSE name END,
   organization_name=CASE WHEN input->>'accepted'='true' OR attempts>=6 THEN '' ELSE organization_name END
   WHERE id=(input->>'id')::uuid AND status='sending' AND lease_token=(input->>'leaseToken')::uuid;
  RETURN jsonb_build_object('updated',FOUND);
 END IF;
 IF input->>'action'<>'claim' THEN RAISE EXCEPTION 'invalid_email_delivery_action'; END IF;
 -- Stop retries before the provider's 24-hour idempotency window expires.
 UPDATE origen_registration_emails SET status='cancelled',recipient='',name='',organization_name='',lease_token=NULL,lease_until=NULL
  WHERE status IN ('pending','sending') AND (created_at<now()-interval '23 hours' OR attempts>=6 AND coalesce(lease_until,now())<=now());
 DELETE FROM origen_registration_emails WHERE created_at<now()-interval '30 days';
 FOR item IN SELECT * FROM origen_registration_emails WHERE (status='pending' AND available_at<=now() OR status='sending' AND lease_until<=now())
  ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(item.recipient_subject,'UTF8')),'hex'))
   OR item.application_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_coordinator_applications a WHERE a.id=item.application_id AND a.auth0_subject=item.recipient_subject AND a.verified_email=item.recipient
    AND (item.kind='coordinator-received' AND a.status='pending' OR item.kind='coordinator-approved' AND a.status='approved'
     AND EXISTS(SELECT 1 FROM origen_coordinator_profiles p JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id
      JOIN origen_institutions i ON i.id=p.institution_id WHERE p.auth0_subject=a.auth0_subject AND p.institution_id=a.institution_id AND p.status='active' AND o.status='active' AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL)))
   OR item.institution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_institution_members m JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject
    JOIN origen_institutions i ON i.id=m.institution_id WHERE m.institution_id=item.institution_id AND m.role='owner' AND m.auth0_subject=item.recipient_subject AND r.verified_email=item.recipient AND r.email_verified_at IS NOT NULL AND i.archived_at IS NULL
    AND (item.kind='organization-received' AND NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations o WHERE o.institution_id=i.id AND o.status='active')
     OR item.kind='organization-approved' AND i.verification_status='verified' AND i.parent_approval='approved' AND EXISTS(SELECT 1 FROM origen_coordinator_organizations o WHERE o.institution_id=i.id AND o.status='active'))) THEN
   UPDATE origen_registration_emails SET status='cancelled',recipient='',name='',organization_name='' WHERE id=item.id;
   CONTINUE;
  END IF;
  UPDATE origen_registration_emails SET status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() WHERE id=item.id RETURNING * INTO item;
  RETURN jsonb_build_object('id',item.id,'kind',item.kind,'recipient',item.recipient,'name',item.name,'organizationName',item.organization_name,'leaseToken',item.lease_token);
 END LOOP;
 RETURN '{}'::jsonb;
END $$;

DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['origen_registration_email_application()','origen_registration_email_organization(uuid)','origen_registration_email_approval()','origen_registration_email_delivery(jsonb)'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
 END LOOP;
END $$;

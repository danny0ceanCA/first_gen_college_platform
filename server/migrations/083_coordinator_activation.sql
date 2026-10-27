-- Minimal Auth0 evidence for coordinator account setup. No credentials, raw
-- provider logs, email addresses or student data are copied into these tables.
CREATE TABLE origen_coordinator_activation (
 auth0_subject text PRIMARY KEY REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 password_set_at timestamptz,
 first_sign_in_at timestamptz,
 CHECK(password_set_at IS NOT NULL OR first_sign_in_at IS NOT NULL)
);
CREATE TABLE origen_coordinator_identity_stream (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 started_at timestamptz NOT NULL DEFAULT now(),
 last_received_at timestamptz
);
INSERT INTO origen_coordinator_identity_stream(singleton) VALUES(true);
ALTER TABLE origen_coordinator_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_coordinator_identity_stream ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_coordinator_activation,origen_coordinator_identity_stream FROM PUBLIC;

CREATE FUNCTION origen_record_coordinator_identity_events(events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF current_setting('origen.purpose',true) IS DISTINCT FROM 'identity-events'
 OR nullif(current_setting('origen.subject',true),'') IS NOT NULL
 THEN RAISE EXCEPTION 'identity_event_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(events) IS DISTINCT FROM 'array' OR jsonb_array_length(events)>1000
 THEN RAISE EXCEPTION 'invalid_identity_events' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(events) e WHERE
  jsonb_typeof(e) IS DISTINCT FROM 'object' OR coalesce(e->>'kind','') NOT IN ('password-set','sign-in')
  OR length(coalesce(e->>'subject','')) NOT BETWEEN 1 AND 255
  OR coalesce(e->>'occurredAt','')=''
  OR (e->>'occurredAt')::timestamptz NOT BETWEEN '2000-01-01'::timestamptz AND now()+interval '5 minutes')
 THEN RAISE EXCEPTION 'invalid_identity_events' USING ERRCODE='22023'; END IF;
 -- A known representative is required; student-only identities and identities
 -- already erased are ignored. The FK also cascades future account erasure.
 INSERT INTO origen_coordinator_activation(auth0_subject,password_set_at,first_sign_in_at)
 SELECT r.auth0_subject,
  min((e->>'occurredAt')::timestamptz) FILTER(WHERE e->>'kind'='password-set'),
  min((e->>'occurredAt')::timestamptz) FILTER(WHERE e->>'kind'='sign-in')
 FROM jsonb_array_elements(events) e
 JOIN origen_institution_representatives r ON r.auth0_subject=e->>'subject'
 WHERE NOT EXISTS(SELECT 1 FROM origen_closed_accounts c WHERE c.subject_hash=encode(sha256(convert_to(r.auth0_subject,'UTF8')),'hex'))
 GROUP BY r.auth0_subject ORDER BY r.auth0_subject
 ON CONFLICT(auth0_subject) DO UPDATE SET
  password_set_at=least(origen_coordinator_activation.password_set_at,excluded.password_set_at),
  first_sign_in_at=least(origen_coordinator_activation.first_sign_in_at,excluded.first_sign_in_at);
 UPDATE origen_coordinator_identity_stream SET last_received_at=now() WHERE singleton;
END $$;

CREATE FUNCTION origen_admin_coordinator_activation(application_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); result jsonb;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'analytics'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND blocked)
 THEN RAISE EXCEPTION 'coordinator_activation_denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('id',a.id,'passwordSetAt',m.password_set_at,'firstSignInAt',m.first_sign_in_at,
  'trackingStartedAt',s.started_at,'lastReceivedAt',s.last_received_at)
 INTO result FROM origen_coordinator_applications a
 LEFT JOIN origen_coordinator_activation m ON m.auth0_subject=a.auth0_subject
 CROSS JOIN origen_coordinator_identity_stream s WHERE a.id=application_id AND a.status='approved';
 RETURN result;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_record_coordinator_identity_events(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION origen_admin_coordinator_activation(uuid) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_record_coordinator_identity_events(jsonb),origen_admin_coordinator_activation(uuid) FROM PUBLIC;

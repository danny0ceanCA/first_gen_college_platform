-- Installed into the independent erasure ledger by migration 003.
CREATE TABLE support_grants(
 id uuid PRIMARY KEY,environment text NOT NULL,case_id uuid NOT NULL,scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 actor_hash text NOT NULL CHECK(actor_hash~'^[a-f0-9]{64}$'),recipient_hash text NOT NULL CHECK(recipient_hash~'^[a-f0-9]{64}$'),
 operation_ids uuid[] NOT NULL CHECK(cardinality(operation_ids) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked')),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE INDEX support_grant_expiry ON support_grants(expires_at);
CREATE INDEX support_grant_actor ON support_grants(actor_hash,created_at);
CREATE FUNCTION support_environment() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT environment FROM ledger_scopes WHERE role_name=session_user $$;
CREATE TABLE support_access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,environment text NOT NULL,case_id uuid,actor_hash text NOT NULL CHECK(actor_hash~'^[a-f0-9]{64}$'),action text NOT NULL CHECK(action IN('issue','query','revoke')),outcome text NOT NULL CHECK(outcome IN('authorized','denied','completed')),occurred_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION support_audit(case_ref uuid,actor text,verb text,result text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE scope text;
BEGIN SELECT environment INTO scope FROM ledger_scopes WHERE role_name=session_user;IF scope IS NULL THEN RAISE EXCEPTION 'support_unavailable';END IF;
 INSERT INTO support_access_audit(environment,case_id,actor_hash,action,outcome) VALUES(scope,case_ref,actor,verb,result);
END $$;
CREATE FUNCTION support_register(id_ref uuid,case_ref uuid,fingerprint text,actor text,recipient text,operations uuid[],expiry timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE scope text;
BEGIN
 SELECT environment INTO scope FROM ledger_scopes WHERE role_name=session_user;IF scope IS NULL THEN RAISE EXCEPTION 'support_unavailable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor,72));
 IF (SELECT count(*) FROM support_grants WHERE environment=scope AND actor_hash=actor AND created_at>now()-interval '1 minute')>=20 OR (SELECT count(*) FROM support_grants WHERE environment=scope AND expires_at>now())>=1000 THEN RAISE EXCEPTION 'support_unavailable';END IF;
 IF EXISTS(SELECT 1 FROM ledger_erased WHERE environment=scope AND expires_at>now() AND (kind='case' AND reference=case_ref::text OR kind='operation' AND reference=ANY(operations::text[]))) THEN RAISE EXCEPTION 'support_unavailable';END IF;
 INSERT INTO support_grants(id,environment,case_id,scope_hash,actor_hash,recipient_hash,operation_ids,expires_at) VALUES(id_ref,scope,case_ref,fingerprint,actor,recipient,operations,expiry);
 PERFORM support_audit(case_ref,actor,'issue','authorized');
END $$;
CREATE FUNCTION support_authorized(id_ref uuid,fingerprint text,recipient text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM support_grants g WHERE g.id=id_ref AND g.environment=(SELECT environment FROM ledger_scopes WHERE role_name=session_user) AND g.scope_hash=fingerprint AND g.recipient_hash=recipient AND g.status='active' AND g.expires_at>now() AND NOT EXISTS(SELECT 1 FROM ledger_erased e WHERE e.environment=g.environment AND e.expires_at>now() AND (e.kind='case' AND e.reference=g.case_id::text OR e.kind='operation' AND e.reference=ANY(g.operation_ids::text[]))))
$$;
CREATE FUNCTION support_revoke(id_ref uuid,recipient text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN UPDATE support_grants SET status='revoked' WHERE id=id_ref AND recipient_hash=recipient AND environment=(SELECT environment FROM ledger_scopes WHERE role_name=session_user);END $$;
CREATE OR REPLACE FUNCTION ledger_expire() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM ledger_erased WHERE (environment,kind,reference) IN(SELECT environment,kind,reference FROM ledger_erased WHERE expires_at<=now() LIMIT 10000);
 DELETE FROM support_grants WHERE id IN(SELECT id FROM support_grants WHERE expires_at<=now() LIMIT 10000);
 DELETE FROM support_access_audit WHERE id IN(SELECT id FROM support_access_audit WHERE occurred_at<now()-interval '90 days' LIMIT 10000);
END $$;
REVOKE ALL ON support_grants,support_access_audit FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION support_environment(),support_audit(uuid,text,text,text),support_register(uuid,uuid,text,text,text,uuid[],timestamptz),support_authorized(uuid,text,text),support_revoke(uuid,text) FROM PUBLIC;

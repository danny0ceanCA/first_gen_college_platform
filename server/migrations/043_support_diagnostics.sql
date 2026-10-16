ALTER TABLE origen_privileged_access_audit DROP CONSTRAINT origen_privileged_access_audit_area_check;
ALTER TABLE origen_privileged_access_audit ADD CHECK(area IN('admin','institution','inquiry','campaign','metrics','family','support'));
ALTER TABLE origen_telemetry_erasure_outbox DROP CONSTRAINT origen_telemetry_erasure_outbox_kind_check;
ALTER TABLE origen_telemetry_erasure_outbox ADD CHECK(kind IN('operation','request','trace','case'));
-- Existing references have no known receipt time; never invent one on upgrade.
ALTER TABLE origen_diagnostic_request_refs ADD COLUMN created_at timestamptz;
ALTER TABLE origen_diagnostic_request_refs ALTER COLUMN created_at SET DEFAULT now();
CREATE TABLE origen_support_cases(
 id uuid PRIMARY KEY,account_id uuid REFERENCES origen_accounts(id) ON DELETE CASCADE,
 origin text NOT NULL CHECK(origin IN('user_report','system_incident')),
 purpose text NOT NULL CHECK(purpose IN('sign-in','onboarding','voice','saving','availability')),
 environment text NOT NULL CHECK(environment IN('production','staging','test','development')),
 operation_ids uuid[] NOT NULL CHECK(cardinality(operation_ids) BETWEEN 1 AND 100),
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 data_classes text[] NOT NULL DEFAULT ARRAY['technical_events','aggregate_metrics']::text[]
 CHECK(data_classes=ARRAY['technical_events','aggregate_metrics']::text[]),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),
 CHECK(window_end>window_start AND window_end-window_start<=interval '24 hours'),
 CHECK(expires_at<=created_at+interval '24 hours'),
 CHECK((origin='user_report')=(account_id IS NOT NULL))
);
CREATE INDEX support_case_account ON origen_support_cases(account_id);
CREATE TABLE origen_support_case_actors(case_id uuid REFERENCES origen_support_cases(id) ON DELETE CASCADE,actor_hash text NOT NULL CHECK(actor_hash~'^[a-f0-9]{64}$'),PRIMARY KEY(case_id,actor_hash));
CREATE INDEX support_actor_cases ON origen_support_case_actors(actor_hash);
ALTER TABLE origen_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_support_case_actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_case_read ON origen_support_cases FOR SELECT USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY support_case_insert ON origen_support_cases FOR INSERT WITH CHECK(origin='user_report' AND account_id=(SELECT origen_current_account_id()) AND NOT EXISTS(
 SELECT 1 FROM unnest(operation_ids) op WHERE NOT EXISTS(SELECT 1 FROM origen_diagnostic_operations d WHERE d.operation_id=op AND d.account_id=origen_support_cases.account_id AND d.expires_at>now())));
-- Runtime can close an owned case but cannot rewrite its approved scope.
CREATE POLICY support_case_close ON origen_support_cases FOR UPDATE USING(account_id=(SELECT origen_current_account_id())) WITH CHECK(status='closed' AND account_id=(SELECT origen_current_account_id()));
CREATE FUNCTION origen_support_case_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.status='closed' THEN
  INSERT INTO origen_telemetry_erasure_outbox(kind,reference) VALUES('case',OLD.id::text) ON CONFLICT DO NOTHING;
 END IF;RETURN OLD;
END $$;

CREATE TRIGGER support_case_deleted BEFORE DELETE ON origen_support_cases FOR EACH ROW EXECUTE FUNCTION origen_support_case_erasure();
CREATE TRIGGER support_case_closed AFTER UPDATE OF status ON origen_support_cases FOR EACH ROW WHEN(NEW.status='closed') EXECUTE FUNCTION origen_support_case_erasure();
CREATE FUNCTION origen_support_scope_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN UPDATE origen_support_cases SET status='closed' WHERE status='open' AND OLD.operation_id=ANY(operation_ids);RETURN OLD;END $$;
CREATE TRIGGER support_operation_deleted BEFORE DELETE ON origen_diagnostic_operations FOR EACH ROW EXECUTE FUNCTION origen_support_scope_deleted();
CREATE FUNCTION origen_support_permission_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.revision<>OLD.revision OR NEW.status NOT IN('adult','approved') THEN
  UPDATE origen_support_cases c SET status='closed' WHERE c.status='open' AND (c.account_id IN(SELECT id FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=NEW.subject_hash) OR EXISTS(SELECT 1 FROM origen_diagnostic_operations d JOIN origen_accounts a ON a.id=d.account_id WHERE d.operation_id=ANY(c.operation_ids) AND encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')=NEW.subject_hash));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER support_permission_changed AFTER UPDATE ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_support_permission_changed();
CREATE FUNCTION origen_support_staff_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended(NEW.subject_hash,73));UPDATE origen_support_cases SET status='closed' WHERE status='open' AND id IN(SELECT case_id FROM origen_support_case_actors WHERE actor_hash=NEW.subject_hash);RETURN NEW;END $$;
CREATE TRIGGER support_staff_changed AFTER INSERT OR UPDATE ON origen_staff_access_controls FOR EACH ROW EXECUTE FUNCTION origen_support_staff_changed();
-- Gateway sees a bounded technical scope only. It never receives the account,
-- student, Auth0 subject, profile, transcript, or free-form support text.
CREATE FUNCTION origen_support_scope(case_ref uuid,actor text,issued_at bigint,register boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c record;
BEGIN
 IF actor IS NULL OR actor!~'^[a-f0-9]{64}$' OR issued_at IS NULL OR issued_at<=0 OR issued_at>extract(epoch FROM now())+30 OR EXISTS(SELECT 1 FROM origen_telemetry_erasure_outbox WHERE delivered_at IS NULL AND created_at<now()-interval '60 seconds') THEN RETURN NULL;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor,73));
 SELECT * INTO c FROM origen_support_cases WHERE id=case_ref AND status='open' AND expires_at>now();
 IF NOT FOUND OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=actor AND (blocked OR to_timestamp(issued_at)<=token_valid_after)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM unnest(c.operation_ids) op WHERE NOT EXISTS(SELECT 1 FROM origen_diagnostic_operations d JOIN origen_accounts a ON a.id=d.account_id JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex') WHERE d.operation_id=op AND (c.account_id IS NULL OR d.account_id=c.account_id) AND d.expires_at>now() AND (e.status='adult' OR e.status='approved' AND e.permission_expires_at>now()))) THEN RETURN NULL;END IF;
 IF register THEN INSERT INTO origen_support_case_actors VALUES(c.id,actor) ON CONFLICT DO NOTHING;END IF;
 RETURN jsonb_build_object('id',c.id,'origin',c.origin,'purpose',c.purpose,'environment',c.environment,'operations',c.operation_ids,'start',c.window_start,'end',c.window_end,'dataClasses',c.data_classes,'expiresAt',c.expires_at);
END $$;
REVOKE ALL ON origen_support_cases,origen_support_case_actors FROM PUBLIC;
REVOKE ALL ON FUNCTION origen_support_case_erasure(),origen_support_scope_deleted(),origen_support_permission_changed(),origen_support_staff_changed(),origen_support_scope(uuid,text,bigint,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION origen_telemetry_outbox_expire() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM origen_support_cases WHERE id IN(SELECT id FROM origen_support_cases WHERE expires_at<=now() LIMIT 1000);
 DELETE FROM origen_telemetry_erasure_outbox WHERE expires_at<=now();
END $$;

DO $$ DECLARE s text=current_schema();f text;BEGIN
 FOREACH f IN ARRAY ARRAY['origen_support_case_erasure()','origen_support_scope_deleted()','origen_support_permission_changed()','origen_support_staff_changed()','origen_support_scope(uuid,text,bigint,boolean)','origen_telemetry_outbox_expire()'] LOOP
  IF to_regprocedure(format('%I.%s',s,f)) IS NOT NULL THEN EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO pg_catalog,%I',s,f,s);END IF;
 END LOOP;
END $$;

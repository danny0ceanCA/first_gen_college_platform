-- Additive production catalog schema. Existing v1.2 tables remain unchanged.
CREATE SCHEMA IF NOT EXISTS coa_catalog;
CREATE TABLE IF NOT EXISTS coa_catalog.batches (
 id text PRIMARY KEY, source_sha256 text NOT NULL, importer_version text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS coa_catalog.budgets (
 batch_id text NOT NULL REFERENCES coa_catalog.batches(id), budget_key text NOT NULL,
 scenario_key text NOT NULL, campus text NOT NULL, academic_year text NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('reconciled','derived','discrepancy','incomplete','invalid')),
 flagged boolean NOT NULL, eligible_for_review boolean NOT NULL,
 published_cents bigint, components_cents bigint NOT NULL, difference_cents bigint,
 payload jsonb NOT NULL, record_digest text NOT NULL,
 PRIMARY KEY(batch_id,budget_key), UNIQUE(batch_id,budget_key,record_digest)
);
CREATE TABLE IF NOT EXISTS coa_catalog.items (
 batch_id text NOT NULL, budget_key text NOT NULL, item_key text NOT NULL,
 amount_cents bigint, raw_amount numeric, period_factor numeric, role text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(batch_id,item_key),
 FOREIGN KEY(batch_id,budget_key) REFERENCES coa_catalog.budgets(batch_id,budget_key)
);
CREATE TABLE IF NOT EXISTS coa_catalog.approvals (
 batch_id text NOT NULL, budget_key text NOT NULL, record_digest text NOT NULL,
 reviewed_by text NOT NULL CHECK(length(trim(reviewed_by))>0), reviewed_at timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz NOT NULL, review_note text NOT NULL CHECK(length(trim(review_note))>0), revoked_at timestamptz,
 PRIMARY KEY(batch_id,budget_key),
 FOREIGN KEY(batch_id,budget_key,record_digest) REFERENCES coa_catalog.budgets(batch_id,budget_key,record_digest),
 CHECK(valid_until>reviewed_at)
);
CREATE TABLE IF NOT EXISTS coa_catalog.approval_events (
 id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 operation text NOT NULL, before_record jsonb, after_record jsonb
);
CREATE OR REPLACE FUNCTION coa_catalog.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catalog revisions are immutable; import a new batch'; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='coa_budget_immutable') THEN
 CREATE TRIGGER coa_budget_immutable BEFORE UPDATE OR DELETE ON coa_catalog.budgets FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
 CREATE TRIGGER coa_item_immutable BEFORE UPDATE OR DELETE ON coa_catalog.items FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
 CREATE TRIGGER coa_batch_immutable BEFORE UPDATE OR DELETE ON coa_catalog.batches FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
 END IF;
END $$;
CREATE OR REPLACE FUNCTION coa_catalog.audit_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO coa_catalog.approval_events(operation,before_record,after_record)
 VALUES(TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coa_approval_audit ON coa_catalog.approvals;
CREATE TRIGGER coa_approval_audit AFTER INSERT OR UPDATE ON coa_catalog.approvals FOR EACH ROW EXECUTE FUNCTION coa_catalog.audit_approval();
DROP TRIGGER IF EXISTS coa_approval_no_delete ON coa_catalog.approvals;
CREATE TRIGGER coa_approval_no_delete BEFORE DELETE ON coa_catalog.approvals FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
DROP TRIGGER IF EXISTS coa_approval_events_immutable ON coa_catalog.approval_events;
CREATE TRIGGER coa_approval_events_immutable BEFORE UPDATE OR DELETE ON coa_catalog.approval_events FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
CREATE OR REPLACE FUNCTION coa_catalog.check_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM coa_catalog.budgets b WHERE b.batch_id=NEW.batch_id AND b.budget_key=NEW.budget_key
 AND b.record_digest=NEW.record_digest AND b.eligible_for_review AND NOT b.flagged AND b.bucket='reconciled'
 AND coalesce(b.payload->'raw'->>'Scope and exclusions','') !~* 'source conflict')
 THEN RAISE EXCEPTION 'catalog record is not eligible for approval'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coa_approval_check ON coa_catalog.approvals;
CREATE TRIGGER coa_approval_check BEFORE INSERT OR UPDATE ON coa_catalog.approvals FOR EACH ROW EXECUTE FUNCTION coa_catalog.check_approval();
CREATE INDEX IF NOT EXISTS coa_scope_lookup ON coa_catalog.budgets(campus,academic_year);
CREATE INDEX IF NOT EXISTS coa_housing_lookup ON coa_catalog.budgets(campus,academic_year,(payload->'normalized'->>'housing'));
CREATE OR REPLACE VIEW coa_catalog.published WITH(security_barrier=true) AS
 SELECT b.*,a.reviewed_at AS source_reviewed_at,a.valid_until FROM coa_catalog.budgets b JOIN coa_catalog.approvals a
 ON (a.batch_id,a.budget_key,a.record_digest)=(b.batch_id,b.budget_key,b.record_digest)
 WHERE b.eligible_for_review AND NOT b.flagged AND a.revoked_at IS NULL AND a.valid_until>now()
 AND coalesce(b.payload->'raw'->>'Scope and exclusions','') !~* 'source conflict';
REVOKE ALL ON SCHEMA coa_catalog FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA coa_catalog FROM PUBLIC;


CREATE TABLE IF NOT EXISTS coa_catalog.production_releases (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), batch_id text NOT NULL REFERENCES coa_catalog.batches(id),
 released_at timestamptz NOT NULL DEFAULT now(), released_by text NOT NULL CHECK(length(trim(released_by))>0),
 note text NOT NULL CHECK(length(trim(note))>0), source_reviewed_at timestamptz NOT NULL,
 valid_until timestamptz NOT NULL, review_evidence jsonb NOT NULL, manifest jsonb NOT NULL,
 CHECK(valid_until>source_reviewed_at)
);
CREATE TABLE IF NOT EXISTS coa_catalog.production_release_records (
 release_id text NOT NULL REFERENCES coa_catalog.production_releases(id), batch_id text NOT NULL,
 budget_key text NOT NULL, record_digest text NOT NULL,
 PRIMARY KEY(release_id,budget_key),
 FOREIGN KEY(batch_id,budget_key,record_digest) REFERENCES coa_catalog.budgets(batch_id,budget_key,record_digest)
);
CREATE OR REPLACE FUNCTION coa_catalog.check_publication_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM coa_catalog.production_releases r JOIN coa_catalog.budgets b ON b.batch_id=r.batch_id
 WHERE r.id=NEW.release_id AND b.batch_id=NEW.batch_id AND b.budget_key=NEW.budget_key AND b.record_digest=NEW.record_digest AND b.bucket<>'invalid')
 THEN RAISE EXCEPTION 'invalid publication record'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coa_publication_record_check ON coa_catalog.production_release_records;
CREATE TRIGGER coa_publication_record_check BEFORE INSERT ON coa_catalog.production_release_records FOR EACH ROW EXECUTE FUNCTION coa_catalog.check_publication_record();
DROP TRIGGER IF EXISTS coa_production_release_immutable ON coa_catalog.production_releases;
CREATE TRIGGER coa_production_release_immutable BEFORE UPDATE OR DELETE ON coa_catalog.production_releases FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
DROP TRIGGER IF EXISTS coa_production_record_immutable ON coa_catalog.production_release_records;
CREATE TRIGGER coa_production_record_immutable BEFORE UPDATE OR DELETE ON coa_catalog.production_release_records FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
CREATE OR REPLACE VIEW coa_catalog.production_published WITH(security_barrier=true) AS
 SELECT b.*,r.source_reviewed_at,r.valid_until,true AS caveated_publication,
 jsonb_build_object('reviewNotes',coalesce((SELECT jsonb_agg(n.value) FROM jsonb_array_elements(r.review_evidence->'reviewNotes') AS n(value) WHERE n.value->'values'->>'Budget ID'=b.budget_key),'[]'::jsonb)) AS review_evidence
 FROM coa_catalog.budgets b JOIN coa_catalog.production_release_records p USING(batch_id,budget_key,record_digest)
 JOIN coa_catalog.production_releases r ON r.id=p.release_id
 WHERE b.bucket<>'invalid' AND r.valid_until>now() AND r.id=(SELECT id FROM coa_catalog.production_releases WHERE valid_until>now() ORDER BY released_at DESC,id DESC LIMIT 1);
REVOKE ALL ON ALL TABLES IN SCHEMA coa_catalog FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='origen_research_worker') THEN
 GRANT USAGE ON SCHEMA coa_catalog TO origen_research_worker;
 GRANT SELECT ON coa_catalog.production_published TO origen_research_worker;
END IF; END $$;

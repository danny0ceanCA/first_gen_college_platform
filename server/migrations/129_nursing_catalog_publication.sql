-- Local pending research only. Deliberately separate from coa_catalog release views.
CREATE SCHEMA IF NOT EXISTS nursing_catalog;
CREATE TABLE IF NOT EXISTS nursing_catalog.metadata(version text PRIMARY KEY);
INSERT INTO nursing_catalog.metadata VALUES('nursing-local-v1') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS nursing_catalog.batches(
 id text PRIMARY KEY, source_workbook_sha256 text NOT NULL, source_archive_sha256 text NOT NULL,
 importer_version text NOT NULL, adapter_fingerprint text NOT NULL, payload_digest text NOT NULL, source_archive_filename text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL, companions jsonb NOT NULL, manifest jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS nursing_catalog.budgets(
 batch_id text NOT NULL REFERENCES nursing_catalog.batches(id), budget_id text NOT NULL,
 source_row integer NOT NULL, campus text NOT NULL, program text, pathway text,
 academic_year_raw text, academic_year_display text, academic_year_key text, academic_year_status text NOT NULL,
 cohort text, residency text, housing text, enrollment text, budget_period text, currency text,
 source_url text, cost_coverage text, bucket text NOT NULL CHECK(bucket IN('reconciled','derived','discrepancy','incomplete','non_additive')),
 published_cents bigint, components_cents bigint, difference_cents bigint,
 review_state text NOT NULL DEFAULT 'pending' CHECK(review_state='pending'),
 source_verified boolean NOT NULL DEFAULT false CHECK(NOT source_verified),
 live_eligible boolean NOT NULL DEFAULT false CHECK(NOT live_eligible),
 automatic_production_permission boolean NOT NULL DEFAULT false CHECK(NOT automatic_production_permission),
 payload jsonb NOT NULL, record_digest text NOT NULL, PRIMARY KEY(batch_id,budget_id)
);
CREATE TABLE IF NOT EXISTS nursing_catalog.items(
 batch_id text NOT NULL, item_id text NOT NULL, budget_id text NOT NULL, source_row integer NOT NULL,
 original_label text, category_raw text, category_candidate text, category_mapping_status text,
 role_raw text NOT NULL, role_normalized text, amount_period text, source_url text,
 value_representation text NOT NULL CHECK(value_representation IN('Recorded scalar amount','Published range','Published lower bound','Published upper bound','Unpriced or variable')),
 source_scalar_cents bigint CHECK(source_scalar_cents>=0), source_scalar_status text NOT NULL,
 budget_period_cents bigint CHECK(budget_period_cents>=0), lower_bound_cents bigint CHECK(lower_bound_cents>=0), upper_bound_cents bigint CHECK(upper_bound_cents>=0),
 bounds_automatically_additive boolean NOT NULL DEFAULT false CHECK(NOT bounds_automatically_additive),
 bound_extraction_basis text, caveated_handling text, fresh_range_verification text,
 review_state text NOT NULL DEFAULT 'pending' CHECK(review_state='pending'),
 source_verified boolean NOT NULL DEFAULT false CHECK(NOT source_verified),
 live_eligible boolean NOT NULL DEFAULT false CHECK(NOT live_eligible),
 payload jsonb NOT NULL, record_digest text NOT NULL, PRIMARY KEY(batch_id,item_id),
 FOREIGN KEY(batch_id,budget_id) REFERENCES nursing_catalog.budgets(batch_id,budget_id),
 CHECK((value_representation='Published range' AND lower_bound_cents IS NOT NULL AND upper_bound_cents IS NOT NULL AND lower_bound_cents<=upper_bound_cents)
 OR (value_representation='Published lower bound' AND lower_bound_cents IS NOT NULL AND upper_bound_cents IS NULL)
 OR (value_representation='Published upper bound' AND lower_bound_cents IS NULL AND upper_bound_cents IS NOT NULL)
 OR (value_representation IN('Recorded scalar amount','Unpriced or variable') AND lower_bound_cents IS NULL AND upper_bound_cents IS NULL)),
 CHECK(value_representation='Recorded scalar amount' OR (source_scalar_cents IS NULL AND budget_period_cents IS NULL))
);
CREATE TABLE IF NOT EXISTS nursing_catalog.decisions(
 batch_id text NOT NULL, reference text NOT NULL, budget_id text NOT NULL, item_id text,
 treatment text NOT NULL, suggested_wording text, required_caveat text NOT NULL, still_unresolved text, source_url text,
 live_eligible boolean NOT NULL DEFAULT false CHECK(NOT live_eligible),
 normalized jsonb NOT NULL, companion jsonb NOT NULL, record_digest text NOT NULL,
 PRIMARY KEY(batch_id,reference), FOREIGN KEY(batch_id,budget_id) REFERENCES nursing_catalog.budgets(batch_id,budget_id),
 FOREIGN KEY(batch_id,item_id) REFERENCES nursing_catalog.items(batch_id,item_id)
);
CREATE TABLE IF NOT EXISTS nursing_catalog.evidence(
 batch_id text NOT NULL REFERENCES nursing_catalog.batches(id), sheet_name text NOT NULL,
 rows jsonb NOT NULL, record_digest text NOT NULL, PRIMARY KEY(batch_id,sheet_name)
);
CREATE OR REPLACE FUNCTION nursing_catalog.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'nursing research revisions are immutable; import a new batch'; END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['batches','budgets','items','decisions','evidence'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('nursing_catalog.'||tab)::regclass AND tgname='nursing_immutable') THEN
   EXECUTE format('CREATE TRIGGER nursing_immutable BEFORE UPDATE OR DELETE ON nursing_catalog.%I FOR EACH ROW EXECUTE FUNCTION nursing_catalog.immutable_record()',tab);
  END IF;
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS nursing_budget_scope ON nursing_catalog.budgets(campus,academic_year_key,program);
CREATE INDEX IF NOT EXISTS nursing_item_parent ON nursing_catalog.items(batch_id,budget_id);
REVOKE ALL ON SCHEMA nursing_catalog FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nursing_catalog FROM PUBLIC;

-- User-authorized caveated availability is separate from source approval.
CREATE TABLE IF NOT EXISTS nursing_catalog.production_releases(
 id text PRIMARY KEY, batch_id text NOT NULL REFERENCES nursing_catalog.batches(id),
 released_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL,
 released_by text NOT NULL CHECK(length(trim(released_by))>0),
 note text NOT NULL CHECK(length(trim(note))>0), CHECK(valid_until>released_at)
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='nursing_catalog.production_releases'::regclass AND tgname='nursing_release_immutable') THEN
 CREATE TRIGGER nursing_release_immutable BEFORE UPDATE OR DELETE ON nursing_catalog.production_releases FOR EACH ROW EXECUTE FUNCTION nursing_catalog.immutable_record();
END IF; END $$;
CREATE OR REPLACE VIEW nursing_catalog.production_budgets WITH(security_barrier=true) AS
 WITH latest AS (SELECT * FROM nursing_catalog.production_releases ORDER BY released_at DESC,id DESC LIMIT 1)
 SELECT b.*,r.id AS publication_id,r.valid_until,true AS caveated_publication
 FROM nursing_catalog.budgets b JOIN latest r ON b.batch_id=r.batch_id WHERE r.valid_until>now();
CREATE OR REPLACE VIEW nursing_catalog.production_items WITH(security_barrier=true) AS
 SELECT i.* FROM nursing_catalog.items i JOIN nursing_catalog.production_budgets b USING(batch_id,budget_id);
CREATE OR REPLACE VIEW nursing_catalog.production_decisions WITH(security_barrier=true) AS
 SELECT d.* FROM nursing_catalog.decisions d JOIN nursing_catalog.production_budgets b USING(batch_id,budget_id);
REVOKE ALL ON nursing_catalog.production_releases FROM PUBLIC;
GRANT USAGE ON SCHEMA nursing_catalog TO origen_research_worker;
GRANT SELECT ON nursing_catalog.production_budgets,nursing_catalog.production_items,nursing_catalog.production_decisions TO origen_research_worker;

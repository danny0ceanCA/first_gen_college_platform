-- Local testing only. Does not change the production approval view.
CREATE TABLE IF NOT EXISTS coa_catalog.test_releases (
 batch_id text PRIMARY KEY REFERENCES coa_catalog.batches(id),
 evidence jsonb NOT NULL, released_at timestamptz NOT NULL DEFAULT now(),
 valid_until timestamptz NOT NULL CHECK(valid_until>released_at),
 released_by text NOT NULL, note text NOT NULL
);
DROP TRIGGER IF EXISTS coa_test_release_immutable ON coa_catalog.test_releases;
CREATE TRIGGER coa_test_release_immutable BEFORE UPDATE OR DELETE ON coa_catalog.test_releases FOR EACH ROW EXECUTE FUNCTION coa_catalog.immutable_record();
CREATE OR REPLACE VIEW coa_catalog.testing_published WITH(security_barrier=true) AS
 SELECT b.*,r.released_at AS source_reviewed_at,r.valid_until,true AS test_publication,
 jsonb_build_object('reviewNotes',coalesce((SELECT jsonb_agg(review_rows.value) FROM jsonb_array_elements(r.evidence->'reviewNotes') AS review_rows(value) WHERE review_rows.value->'values'->>'Budget ID'=b.budget_key),'[]'::jsonb)) AS review_evidence
 FROM coa_catalog.budgets b JOIN coa_catalog.test_releases r ON b.batch_id=r.batch_id
 WHERE r.valid_until>now() AND b.bucket<>'invalid'
 AND r.batch_id=(SELECT batch_id FROM coa_catalog.test_releases WHERE valid_until>now() ORDER BY released_at DESC,batch_id LIMIT 1);
REVOKE ALL ON coa_catalog.test_releases,coa_catalog.testing_published FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='origen_coa_catalog_test_reader') THEN CREATE ROLE origen_coa_catalog_test_reader LOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA coa_catalog TO origen_coa_catalog_test_reader;
GRANT SELECT ON coa_catalog.testing_published TO origen_coa_catalog_test_reader;

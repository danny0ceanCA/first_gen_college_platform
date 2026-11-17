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

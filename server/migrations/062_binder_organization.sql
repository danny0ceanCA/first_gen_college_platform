-- Additive metadata only; no historic content extraction or job backfill.
ALTER TABLE origen_conversation_summaries ADD COLUMN organization_reported_by text NOT NULL DEFAULT 'unknown'
 CHECK(organization_reported_by IN ('student','parent','unknown'));
CREATE FUNCTION origen_capture_summary_reporter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 SELECT CASE WHEN role IN ('student','parent') THEN role ELSE 'unknown' END INTO NEW.organization_reported_by
 FROM origen_accounts WHERE id=NEW.account_id;
 NEW.organization_reported_by:=coalesce(NEW.organization_reported_by,'unknown');
 RETURN NEW;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION %I.origen_capture_summary_reporter() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_capture_summary_reporter() FROM PUBLIC;
CREATE TRIGGER capture_summary_reporter BEFORE INSERT ON origen_conversation_summaries FOR EACH ROW EXECUTE FUNCTION origen_capture_summary_reporter();

ALTER TABLE origen_topic_notes ADD COLUMN organization jsonb CHECK(organization IS NULL OR (jsonb_typeof(organization)='object' AND octet_length(organization::text)<2000));
ALTER TABLE origen_student_memories ADD COLUMN organization jsonb CHECK(organization IS NULL OR (jsonb_typeof(organization)='object' AND octet_length(organization::text)<2000));
ALTER TABLE origen_topic_note_batches ADD COLUMN organization_version text;
-- Account/scope-salted hashes retain dismissal deduplication without a content copy.
ALTER TABLE origen_topic_note_batches ADD COLUMN organization_keys text[] NOT NULL DEFAULT '{}' CHECK(cardinality(organization_keys)<=6);
-- Existing RLS, source-deletion cascades, retention and provenance triggers remain in force.

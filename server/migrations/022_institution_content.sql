-- Content remains inside revisioned draft/published snapshots. Stable record UUIDs
-- connect language variants and later RSVP records without publishing draft edits.
ALTER TABLE origen_institutions ADD COLUMN content_schema_version integer NOT NULL DEFAULT 1 CHECK (content_schema_version IN (1,2));
CREATE INDEX origen_institution_public_directory ON origen_institutions(slug) WHERE published IS NOT NULL AND archived_at IS NULL;

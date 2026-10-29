-- Optional structured delivery preferences. Existing drafts, publications and
-- revision history are left unchanged; no reinterpretation or auto-publication.
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_draft_conversation_approach CHECK (
 NOT (draft ? 'conversationApproach') OR
 (jsonb_typeof(draft->'conversationApproach')='string' AND length(draft->>'conversationApproach')<=1500)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_published_conversation_approach CHECK (
 published IS NULL OR NOT (published ? 'conversationApproach') OR
 (jsonb_typeof(published->'conversationApproach')='string' AND length(published->>'conversationApproach')<=1500)
);

-- A single teaching must fit the reader's 12 KB reference envelope. Allow large
-- drafts, but reject a new oversized publication explicitly instead of letting
-- the reader silently omit it. Leave margin for the reference ID and revision.
CREATE FUNCTION origen_validate_teaching_publication() RETURNS trigger LANGUAGE plpgsql
SET search_path TO pg_catalog AS $$
BEGIN
 IF NEW.published IS NOT NULL AND
 (TG_OP='INSERT' OR NEW.published IS DISTINCT FROM OLD.published) AND
 octet_length(NEW.published::text)>11600
 THEN RAISE EXCEPTION 'teaching_delivery_too_large' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION origen_validate_teaching_publication() FROM PUBLIC;
CREATE TRIGGER origen_teaching_publication_capacity
 BEFORE INSERT OR UPDATE OF published ON origen_teachings
 FOR EACH ROW EXECUTE FUNCTION origen_validate_teaching_publication();

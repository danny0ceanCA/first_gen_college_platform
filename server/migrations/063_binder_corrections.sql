-- Undo receipts contain hashes and identifiers only. Previous text stays in the
-- requesting browser's memory, never a second server-side content archive.
CREATE TABLE origen_binder_changes (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 student_id text,
 store text NOT NULL CHECK(store IN ('memory','note')),
 item_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('update','delete','confirm','undo')),
 request_hash text NOT NULL,
 before_hash text NOT NULL,
 result_id uuid NOT NULL,
 result_version integer NOT NULL CHECK(result_version>0),
 source_summary_id text,
 source_hash text,
 permission_revision integer NOT NULL,
 undo_of uuid,
 undone_by uuid,
 withdrawn integer NOT NULL DEFAULT 0,
 undo_until timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,operation_id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,source_summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_binder_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_binder_changes ON origen_binder_changes USING(account_id=(SELECT origen_current_account_id()));
CREATE INDEX origen_binder_changes_scope ON origen_binder_changes(account_id,student_id,created_at);
ALTER TABLE origen_topic_notes ADD COLUMN context_current boolean NOT NULL DEFAULT false;
ALTER TABLE origen_topic_notes ADD COLUMN restored_from uuid;
ALTER TABLE origen_student_memories ADD COLUMN context_current boolean NOT NULL DEFAULT false;
-- A replacement must not acquire fresh sharing eligibility under a changed
-- account role. Retain the original ID and leave restored removals private.
CREATE FUNCTION origen_binder_restore_private() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE restored uuid;
BEGIN
 SELECT id INTO restored FROM origen_binder_source_lineage WHERE account_id=NEW.account_id AND source_kind='note' AND source_id=NEW.id::text;
 UPDATE origen_binder_source_lineage SET classification=origen_binder_restrict_classification(classification,'unknown'),complete=false,active=false,revision=revision+1,updated_at=now() WHERE id=restored;
 RETURN NEW;
END $$;
-- pg_catalog is implicitly searched first; explicitly place pg_temp last.
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_binder_restore_private() SET search_path TO %I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_binder_restore_private() FROM PUBLIC;
-- PostgreSQL runs same-event triggers alphabetically; run after binder_note_source.
CREATE TRIGGER z_binder_restore_private AFTER INSERT ON origen_topic_notes FOR EACH ROW WHEN(NEW.restored_from IS NOT NULL) EXECUTE FUNCTION origen_binder_restore_private();
-- Additive columns change the whole-row digest used by existing sharing checks.
-- Refresh only provably current pre-062/063 note digests; never certify stale
-- content or widen classification. Lineage triggers invalidate prepared/shared
-- snapshots, so publication still requires a fresh review after migration.
UPDATE origen_binder_source_lineage l SET
 source_digest=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex'),revision=l.revision+1,updated_at=now()
FROM origen_topic_notes n
WHERE l.account_id=n.account_id AND l.source_kind='note' AND l.source_id=n.id::text AND l.source_version=n.version
 AND l.source_digest IN (
  encode(sha256(convert_to((to_jsonb(n)-ARRAY['context_current','restored_from'])::text,'UTF8')),'hex'),
  encode(sha256(convert_to((to_jsonb(n)-ARRAY['context_current','restored_from','organization'])::text,'UTF8')),'hex')
 );
-- Existing source/lineage triggers withdraw stale shared snapshots. Application
-- undo never writes grants, publications, previews, deletion journals or lineage.

-- Private, account-owned memory. Superseded/deleted versions retain metadata only.
CREATE TABLE origen_student_memories (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 student_id text,
 category text NOT NULL CHECK(category IN ('goal','constraint','preference','question')),
 content text NOT NULL CHECK(length(content) <= 1000),
 language text NOT NULL CHECK(language IN ('en','es')),
 speaker text NOT NULL CHECK(speaker IN ('student','parent','family','unknown')),
 reported_by text NOT NULL CHECK(reported_by IN ('student','parent','unknown')),
 last_action text NOT NULL CHECK(last_action IN ('create','propose','update','confirm','delete')),
 status text NOT NULL CHECK(status IN ('proposed','confirmed','superseded','deleted')),
 source_summary_id text,
 source_version text,
 source_at timestamptz,
 source_quote text NOT NULL DEFAULT '' CHECK(length(source_quote) <= 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id,version),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,source_summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE,
 CHECK((status IN ('proposed','confirmed') AND length(btrim(content)) > 0) OR (status IN ('superseded','deleted') AND content='' AND source_quote=''))
);
CREATE UNIQUE INDEX origen_memory_current ON origen_student_memories(account_id,id) WHERE status <> 'superseded';
CREATE INDEX origen_memory_scope ON origen_student_memories(account_id,student_id,status,updated_at DESC);
-- A completed receipt survives dismissing every proposal. Suppressed sources stay
-- visible in history, but cannot reintroduce corrected/removed facts into voice.
CREATE TABLE origen_memory_batches (
 account_id uuid NOT NULL,
 summary_id text NOT NULL,
 source_version text NOT NULL,
 suppressed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(account_id,summary_id),
 FOREIGN KEY(account_id,summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_memory_scopes (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 scope_key text NOT NULL,
 student_id text,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 PRIMARY KEY(account_id,scope_key),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 CHECK(scope_key=coalesce(student_id,''))
);
ALTER TABLE origen_student_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_memory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_memory_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_memory ON origen_student_memories USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_memory_batches ON origen_memory_batches USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_memory_scopes ON origen_memory_scopes USING(account_id=(SELECT origen_current_account_id()));

ALTER TABLE origen_deletion_journal DROP CONSTRAINT origen_deletion_journal_kind_check;
ALTER TABLE origen_deletion_journal ADD CHECK(kind IN ('account','student','summary','note','plan','sheet','memory'));
CREATE TRIGGER privacy_delete BEFORE DELETE ON origen_student_memories FOR EACH ROW EXECUTE FUNCTION origen_record_deletion('memory');
CREATE TRIGGER privacy_insert BEFORE INSERT ON origen_student_memories FOR EACH ROW EXECUTE FUNCTION origen_prevent_resurrection('memory');

-- Deletion/retention and edits from another device invalidate pending extraction
-- and active provider snapshots. Account/student cascades need no surviving epoch.
CREATE FUNCTION origen_memory_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE target text; BEGIN
 IF TG_TABLE_NAME='origen_students' THEN target:=OLD.id; ELSE target:=OLD.student_id; END IF;
 IF EXISTS(SELECT 1 FROM origen_accounts WHERE id=OLD.account_id)
 AND (target IS NULL OR EXISTS(SELECT 1 FROM origen_students WHERE account_id=OLD.account_id AND id=target)) THEN
  INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES(OLD.account_id,coalesce(target,''),target)
   ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1;
 END IF;
 IF TG_TABLE_NAME='origen_students' THEN
  IF (to_jsonb(OLD)-ARRAY['needs','notes','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['needs','notes','updated_at']) THEN
   INSERT INTO origen_memory_scopes(account_id,scope_key,student_id)
    SELECT member_account_id,member_student_id,member_student_id FROM origen_student_links WHERE owner_account_id=OLD.account_id AND owner_student_id=OLD.id
    ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1;
  END IF;
 END IF;
 RETURN OLD;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_memory_context_changed() SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_memory_context_changed() FROM PUBLIC;
CREATE TRIGGER memory_source_deleted AFTER DELETE ON origen_conversation_summaries FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();
CREATE TRIGGER memory_profile_changed AFTER UPDATE ON origen_students FOR EACH ROW WHEN(OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION origen_memory_context_changed();
CREATE TRIGGER memory_erased AFTER DELETE ON origen_student_memories FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();

CREATE TRIGGER privacy_memory_removed AFTER UPDATE ON origen_student_memories FOR EACH ROW WHEN(NEW.status='deleted' AND OLD.status<>'deleted') EXECUTE FUNCTION origen_record_deletion('memory');

-- Existing notes/actions are part of the same brief; corrections and removals
-- must also expire a provider snapshot that has already received their text.
CREATE TRIGGER memory_note_changed AFTER UPDATE ON origen_topic_notes FOR EACH ROW WHEN((OLD.content,OLD.status,OLD.kind,OLD.topic) IS DISTINCT FROM (NEW.content,NEW.status,NEW.kind,NEW.topic)) EXECUTE FUNCTION origen_memory_context_changed();
CREATE TRIGGER memory_note_deleted AFTER DELETE ON origen_topic_notes FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();
CREATE TRIGGER memory_plan_changed AFTER UPDATE OR DELETE ON origen_plans FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();

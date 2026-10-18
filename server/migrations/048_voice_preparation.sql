-- Revision only: no cached prompts, credentials or transcripts in PostgreSQL.
CREATE TABLE origen_voice_context_versions (
 account_id uuid PRIMARY KEY REFERENCES origen_accounts(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1
);
ALTER TABLE origen_voice_context_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_voice_context_version ON origen_voice_context_versions
 USING(account_id=(SELECT origen_current_account_id()));

CREATE FUNCTION origen_voice_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE a uuid; row_data jsonb; BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='origen_accounts' THEN a:=(row_data->>'id')::uuid;
 ELSIF TG_TABLE_NAME='origen_student_links' THEN a:=(row_data->>'member_account_id')::uuid;
 ELSIF TG_TABLE_NAME='origen_plan_steps' THEN SELECT account_id INTO a FROM origen_plans WHERE id=(row_data->>'plan_id')::uuid;
 ELSE a:=(row_data->>'account_id')::uuid; END IF;
 IF a IS NOT NULL AND EXISTS(SELECT 1 FROM origen_accounts WHERE id=a) THEN
  INSERT INTO origen_voice_context_versions(account_id) VALUES(a)
   ON CONFLICT(account_id) DO UPDATE SET revision=origen_voice_context_versions.revision+1;
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_accounts','origen_student_links','origen_students','origen_conversation_summaries','origen_topic_notes','origen_topic_note_batches','origen_plans','origen_plan_steps','origen_student_memories','origen_memory_batches','origen_memory_scopes'] LOOP
  EXECUTE format('CREATE TRIGGER voice_context_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION origen_voice_context_changed()',t);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION origen_voice_context_changed() FROM PUBLIC;

DO $$ BEGIN EXECUTE format('ALTER FUNCTION %I.origen_voice_context_changed() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema()); END $$;

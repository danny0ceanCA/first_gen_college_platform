-- Operator-managed, one-way test copies. No application role can configure a
-- mirror, and no coordinator links, permissions, credentials or telemetry move.
CREATE TABLE origen_private_test_mirrors (
 source_account_id uuid PRIMARY KEY REFERENCES origen_accounts(id) ON DELETE CASCADE,
 target_account_id uuid NOT NULL UNIQUE REFERENCES origen_accounts(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 last_synced_at timestamptz,
 last_error text,
 CHECK(source_account_id<>target_account_id)
);
ALTER TABLE origen_private_test_mirrors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_private_test_mirrors FROM PUBLIC;

CREATE FUNCTION origen_private_test_mirror_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE original jsonb; payload jsonb; destination uuid; cols text; values_sql text;
 keys text; predicate text; updates text; source_owner uuid; mirror_kind text; failures text;
BEGIN
 IF TG_TABLE_NAME NOT IN ('origen_students','origen_conversation_summaries',
   'origen_topic_notes','origen_student_memories','origen_topic_note_batches','origen_memory_batches','origen_plans','origen_plan_steps','origen_plan_sources','origen_plan_conversations','origen_workspace_sheets') THEN
  RAISE EXCEPTION 'unsupported_mirror_table';
 END IF;
 original:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 source_owner:=(original->>'account_id')::uuid;
 SELECT m.target_account_id INTO destination FROM origen_private_test_mirrors m
 JOIN origen_accounts a ON a.id=m.target_account_id
 WHERE m.source_account_id=source_owner AND m.enabled
   AND a.email='student-test@example.test'
   AND NOT EXISTS(SELECT 1 FROM origen_private_test_mirrors p WHERE p.target_account_id=source_owner AND p.enabled);
 IF destination IS NULL THEN RETURN NULL; END IF;
 -- A failure in the disposable copy must never prevent saving the real account.
 BEGIN
  payload:=original||jsonb_build_object('account_id',destination);
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
         string_agg(format('p.%I',a.attname),',' ORDER BY a.attnum),
         string_agg(format('%I=EXCLUDED.%I',a.attname,a.attname),',' ORDER BY a.attnum)
    INTO cols,values_sql,updates FROM pg_attribute a
   WHERE a.attrelid=TG_RELID AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='';
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
         string_agg(format('t.%I=p.%I',a.attname,a.attname),' AND ' ORDER BY a.attnum)
    INTO keys,predicate FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
   WHERE i.indrelid=TG_RELID AND i.indisprimary;
  IF TG_OP='DELETE' THEN
   EXECUTE format('DELETE FROM %I.%I t USING jsonb_populate_record(NULL::%I.%I,$1) p WHERE %s',TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_TABLE_SCHEMA,TG_TABLE_NAME,predicate) USING payload;
  ELSE
   -- Existing privacy tombstones remain authoritative: never resurrect a test
   -- record the tester explicitly erased. Surface that condition to the operator.
   mirror_kind:=CASE TG_TABLE_NAME WHEN 'origen_students' THEN 'student' WHEN 'origen_conversation_summaries' THEN 'summary' WHEN 'origen_topic_notes' THEN 'note' WHEN 'origen_student_memories' THEN 'memory' END;
   IF mirror_kind IS NOT NULL AND EXISTS(SELECT 1 FROM origen_deletion_journal j WHERE j.account_id=destination AND j.kind=mirror_kind AND j.record_id=original->>'id') THEN
    RAISE EXCEPTION 'mirror_target_erased';
   END IF;
   EXECUTE format('INSERT INTO %I.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I.%I,$1) p ON CONFLICT (%s) DO UPDATE SET %s',TG_TABLE_SCHEMA,TG_TABLE_NAME,cols,values_sql,TG_TABLE_SCHEMA,TG_TABLE_NAME,keys,updates) USING payload;
   IF TG_TABLE_NAME='origen_conversation_summaries' THEN
    UPDATE origen_conversation_summaries SET organization_reported_by=original->>'organization_reported_by'
      WHERE account_id=destination AND id=original->>'id';
    UPDATE origen_binder_jobs SET status='cancelled' WHERE account_id=destination AND summary_id=original->>'id' AND status='pending';
   END IF;
   IF mirror_kind IN ('note','summary','memory') THEN
    UPDATE origen_binder_source_lineage d SET classification=s.classification,complete=false,active=false
     FROM origen_binder_source_lineage s WHERE s.account_id=source_owner AND d.account_id=destination
     AND s.source_kind=mirror_kind AND s.source_id=original->>'id' AND d.source_kind=s.source_kind AND d.source_id=s.source_id;
   END IF;
  END IF;
  IF TG_TABLE_NAME='origen_student_memories' THEN
   INSERT INTO origen_memory_scopes(account_id,scope_key,student_id,revision) VALUES(destination,coalesce(original->>'student_id',''),original->>'student_id',1) ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1;
  END IF;
  UPDATE origen_private_test_mirrors SET last_synced_at=now() WHERE source_account_id=source_owner;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failures=RETURNED_SQLSTATE;
  UPDATE origen_private_test_mirrors SET last_error=TG_TABLE_NAME||':'||failures WHERE source_account_id=source_owner;
 END;
 RETURN NULL;
END $$;
DO $$ DECLARE tab text; BEGIN
 EXECUTE format('ALTER FUNCTION origen_private_test_mirror_row() SET search_path TO pg_catalog,%I,pg_temp',current_schema());
 FOREACH tab IN ARRAY ARRAY['origen_students','origen_conversation_summaries','origen_topic_notes','origen_student_memories','origen_topic_note_batches','origen_memory_batches','origen_plans','origen_plan_steps','origen_plan_sources','origen_plan_conversations','origen_workspace_sheets'] LOOP
  EXECUTE format('CREATE TRIGGER zz_private_test_mirror AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION origen_private_test_mirror_row()',tab);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION origen_private_test_mirror_row() FROM PUBLIC;


-- Delete copied personal records before removing their source owner/mapping.
CREATE FUNCTION origen_private_test_mirror_owner_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE destination uuid; tab text;
BEGIN
 SELECT target_account_id INTO destination FROM origen_private_test_mirrors WHERE source_account_id=OLD.id;
 IF destination IS NOT NULL THEN
  FOREACH tab IN ARRAY ARRAY['origen_students','origen_workspace_sheets','origen_plans','origen_topic_notes','origen_student_memories','origen_conversation_summaries'] LOOP
   EXECUTE format('DELETE FROM %I d USING %I s WHERE s.account_id=$1 AND d.account_id=$2 AND d.id=s.id',tab,tab) USING OLD.id,destination;
  END LOOP;
 END IF;
 RETURN OLD;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_private_test_mirror_owner_erased() SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_private_test_mirror_owner_erased() FROM PUBLIC;
CREATE TRIGGER private_test_mirror_owner_erased BEFORE DELETE ON origen_accounts
 FOR EACH ROW EXECUTE FUNCTION origen_private_test_mirror_owner_erased();

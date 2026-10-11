-- Content-free receipts survive account cascades. Export these separately from
-- backups and replay the latest trusted journal BEFORE restoring traffic.
CREATE TABLE origen_deletion_journal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
 account_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('account','student','summary','note','plan','sheet')),
 record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 128),
 deleted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,kind,record_id)
);
CREATE TABLE origen_identity_closures (
 subject_hash text PRIMARY KEY CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
 requested_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE TABLE origen_privacy_preferences (
 account_id uuid PRIMARY KEY REFERENCES origen_accounts(id) ON DELETE CASCADE,
 summary_days integer CHECK (summary_days IN (30,90,365)),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE origen_deletion_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_identity_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_privacy_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_deletion_receipts ON origen_deletion_journal FOR SELECT USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY own_identity_closure ON origen_identity_closures FOR SELECT USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY own_preferences ON origen_privacy_preferences USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY retention_preferences ON origen_privacy_preferences FOR SELECT USING(current_setting('origen.purpose',true)='retention');

CREATE FUNCTION origen_record_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner_id uuid; who text; BEGIN
 IF TG_ARGV[0]='account' THEN
  owner_id:=OLD.id; who:=OLD.auth0_subject;
 ELSE
  owner_id:=OLD.account_id;
  SELECT auth0_subject INTO who FROM origen_accounts WHERE id=owner_id;
 END IF;
 -- Cascades from a deleted account are covered by its BEFORE DELETE receipt.
 IF who IS NOT NULL THEN
  INSERT INTO origen_deletion_journal(subject_hash,account_id,kind,record_id)
   VALUES(encode(sha256(convert_to(who,'UTF8')),'hex'),owner_id,TG_ARGV[0],OLD.id::text) ON CONFLICT DO NOTHING;
 END IF;
 IF TG_ARGV[0]='account' THEN
  INSERT INTO origen_closed_accounts(subject_hash) VALUES(encode(sha256(convert_to(who,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
  INSERT INTO origen_identity_closures(subject_hash) VALUES(encode(sha256(convert_to(who,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 ELSIF TG_ARGV[0]='summary' AND who IS NOT NULL THEN
  INSERT INTO origen_conversation_lifecycle(account_id,id,deleted_at) VALUES(owner_id,OLD.id,now())
   ON CONFLICT(account_id,id) DO UPDATE SET deleted_at=now(),student_id=NULL,mode=NULL;
 END IF;
 RETURN OLD;
END $$;
CREATE FUNCTION origen_prevent_resurrection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM origen_deletion_journal WHERE account_id=NEW.account_id AND kind=TG_ARGV[0] AND record_id=NEW.id::text) THEN
  RAISE EXCEPTION 'private_record_deleted' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE s text:=current_schema(); t text; k text; BEGIN
 EXECUTE format('ALTER FUNCTION origen_record_deletion() SET search_path=%I,pg_temp',s);
 EXECUTE format('ALTER FUNCTION origen_prevent_resurrection() SET search_path=%I,pg_temp',s);
 FOREACH t IN ARRAY ARRAY['accounts','students','conversation_summaries','topic_notes','plans','workspace_sheets'] LOOP
  k:=CASE t WHEN 'accounts' THEN 'account' WHEN 'students' THEN 'student' WHEN 'conversation_summaries' THEN 'summary' WHEN 'topic_notes' THEN 'note' WHEN 'plans' THEN 'plan' ELSE 'sheet' END;
  EXECUTE format('CREATE TRIGGER privacy_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION origen_record_deletion(%L)','origen_'||t,k);
  IF k<>'account' THEN
   EXECUTE format('CREATE TRIGGER privacy_insert BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION origen_prevent_resurrection(%L)','origen_'||t,k);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION origen_record_deletion(),origen_prevent_resurrection() FROM PUBLIC;
CREATE FUNCTION origen_queue_identity_closure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 INSERT INTO origen_identity_closures(subject_hash,requested_at) VALUES(NEW.subject_hash,NEW.closed_at) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_queue_identity_closure() SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_queue_identity_closure() FROM PUBLIC;
CREATE TRIGGER privacy_identity_closure AFTER INSERT ON origen_closed_accounts FOR EACH ROW EXECUTE FUNCTION origen_queue_identity_closure();
INSERT INTO origen_deletion_journal(subject_hash,account_id,kind,record_id,deleted_at)
 SELECT encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex'),l.account_id,'summary',l.id,l.deleted_at
 FROM origen_conversation_lifecycle l JOIN origen_accounts a ON a.id=l.account_id WHERE l.deleted_at IS NOT NULL ON CONFLICT DO NOTHING;
-- Carry forward older closure receipts; no plaintext identity is retained.
INSERT INTO origen_identity_closures(subject_hash,requested_at)
 SELECT subject_hash,closed_at FROM origen_closed_accounts ON CONFLICT DO NOTHING;

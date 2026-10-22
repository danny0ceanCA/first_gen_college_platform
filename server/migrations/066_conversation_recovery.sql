-- Opt-in temporary recovery. Dispatch metadata is separate from private text.
CREATE TABLE origen_recovery_epochs (
 account_id uuid PRIMARY KEY REFERENCES origen_accounts(id) ON DELETE CASCADE,
 epoch integer NOT NULL DEFAULT 1
);
CREATE TABLE origen_conversation_checkpoints (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id text NOT NULL, student_id text, mode text NOT NULL,
 permission_revision integer NOT NULL, epoch integer NOT NULL,
 context_revision integer NOT NULL,
 sequence integer NOT NULL DEFAULT 0, payload_hash text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','running','review','complete','failed','cancelled')),
 manual_retries integer NOT NULL DEFAULT 0 CHECK(manual_retries BETWEEN 0 AND 2),
 attempts integer NOT NULL DEFAULT 0, attempt_times timestamptz[] NOT NULL DEFAULT '{}',
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_checkpoint_text (
 account_id uuid NOT NULL, id text NOT NULL, body jsonb NOT NULL,
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,id) REFERENCES origen_conversation_checkpoints(account_id,id) ON DELETE CASCADE,
 CHECK(octet_length(body::text)<=100000)
);
CREATE INDEX origen_checkpoint_due ON origen_conversation_checkpoints(available_at) WHERE status IN ('pending','running');
ALTER TABLE origen_recovery_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_conversation_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_checkpoint_text ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_recovery_epoch ON origen_recovery_epochs USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_checkpoint ON origen_conversation_checkpoints USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_checkpoint_text ON origen_checkpoint_text USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY checkpoint_dispatch ON origen_conversation_checkpoints FOR SELECT USING(current_setting('origen.purpose',true)='retention');
CREATE POLICY checkpoint_claim ON origen_conversation_checkpoints FOR UPDATE USING(current_setting('origen.purpose',true)='retention') WITH CHECK(current_setting('origen.purpose',true)='retention');
CREATE POLICY checkpoint_expire ON origen_conversation_checkpoints FOR DELETE USING(current_setting('origen.purpose',true)='retention' AND created_at<now()-interval '7 days');

-- Completion/discard/expiry immediately removes content. Cancellation tombstones
-- the existing summary reservation so delayed requests cannot recreate it.
CREATE FUNCTION origen_checkpoint_terminal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.status IN ('complete','cancelled') THEN
  DELETE FROM origen_checkpoint_text WHERE account_id=NEW.account_id AND id=NEW.id;
  IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN
   UPDATE origen_conversation_lifecycle SET deleted_at=now(),student_id=NULL,mode=NULL WHERE account_id=NEW.account_id AND id=NEW.id AND deleted_at IS NULL;
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER checkpoint_terminal AFTER UPDATE OF status ON origen_conversation_checkpoints FOR EACH ROW EXECUTE FUNCTION origen_checkpoint_terminal();
CREATE FUNCTION origen_checkpoint_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=NEW.account_id AND id=NEW.id AND status NOT IN ('complete','cancelled');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER checkpoint_deleted AFTER UPDATE OF deleted_at ON origen_conversation_lifecycle FOR EACH ROW EXECUTE FUNCTION origen_checkpoint_deleted();
CREATE FUNCTION origen_checkpoint_permission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE owner uuid; BEGIN
 IF NEW.revision IS DISTINCT FROM OLD.revision THEN
  SELECT id INTO owner FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=NEW.subject_hash;
  UPDATE origen_recovery_epochs SET epoch=epoch+1 WHERE account_id=owner;
  UPDATE origen_conversation_checkpoints SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE account_id=owner AND status NOT IN ('complete','cancelled');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER checkpoint_permission AFTER UPDATE OF revision ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_checkpoint_permission();
REVOKE ALL ON FUNCTION origen_checkpoint_terminal(),origen_checkpoint_deleted(),origen_checkpoint_permission() FROM PUBLIC;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION %I.origen_checkpoint_terminal() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.origen_checkpoint_deleted() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema());
 EXECUTE format('ALTER FUNCTION %I.origen_checkpoint_permission() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema());
END $$;

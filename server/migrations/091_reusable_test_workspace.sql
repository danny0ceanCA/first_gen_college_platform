-- Preserve deletion receipts, but do not permanently close the dedicated
-- synthetic onboarding login when its application workspace is reset.
CREATE OR REPLACE FUNCTION origen_record_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
 -- This pinned fictional-email account is reusable. An explicit account
 -- closure still inserts its tombstone before DELETE and follows normal policy.
 IF TG_ARGV[0]='account' AND (who<>'auth0|6ad14bb9afcad1dcde4964b9'
  OR EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(who,'UTF8')),'hex'))) THEN
  INSERT INTO origen_closed_accounts(subject_hash) VALUES(encode(sha256(convert_to(who,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
  INSERT INTO origen_identity_closures(subject_hash) VALUES(encode(sha256(convert_to(who,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 ELSIF TG_ARGV[0]='summary' AND who IS NOT NULL THEN
  INSERT INTO origen_conversation_lifecycle(account_id,id,deleted_at) VALUES(owner_id,OLD.id,now())
   ON CONFLICT(account_id,id) DO UPDATE SET deleted_at=now(),student_id=NULL,mode=NULL;
 END IF;
 RETURN OLD;
END $$;

-- Repair only the pending closure created by the old reset trigger.
-- Never reverse a completed identity-provider deletion.
DO $$ DECLARE key text:=encode(sha256(convert_to('auth0|6ad14bb9afcad1dcde4964b9','UTF8')),'hex'); BEGIN
 IF EXISTS(SELECT 1 FROM origen_identity_closures WHERE subject_hash=key AND completed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'test_identity_closure_already_completed';
 END IF;
 DELETE FROM origen_identity_closures WHERE subject_hash=key;
 DELETE FROM origen_closed_accounts WHERE subject_hash=key;
END $$;

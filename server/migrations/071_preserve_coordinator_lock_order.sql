-- Phase 9: the Phase 7/8 function replacements must retain migration 061's
-- account and preview lock order. The unchanged connection command keeps its fix.
-- Account IDs/subjects are never changed by these commands. NO KEY UPDATE
-- preserves account mutation serialization while allowing the KEY SHARE locks
-- taken by audit/outbox foreign keys. Previously, a read held a grant and waited
-- on its account FK while revocation held the account and waited on that grant;
-- publication and organization suspension formed the corresponding outbox cycle.
-- Keep subject, institution, profile, grant and content locks unchanged.
DO $$
DECLARE
 command text; definition text;
 old_lock constant text := 'FROM origen_accounts WHERE auth0_subject=actor FOR UPDATE';
 new_lock constant text := 'FROM origen_accounts WHERE auth0_subject=actor FOR NO KEY UPDATE';
BEGIN
 FOREACH command IN ARRAY ARRAY[
  'origen_binder_sharing_command(jsonb)',
  'origen_binder_help_command(jsonb)',
  'origen_coordinator_feedback_v6(jsonb)'
 ] LOOP
  definition := pg_get_functiondef(to_regprocedure(command));
  -- Fail atomically if a prerequisite changed: do not silently leave a path
  -- with its old lock. CREATE OR REPLACE preserves ownership, ACLs and settings.
  IF definition IS NULL OR
   length(definition)-length(replace(definition,old_lock,''))<>length(old_lock) THEN
   RAISE EXCEPTION 'unexpected_coordinator_account_lock: %',command;
  END IF;
  EXECUTE replace(definition,old_lock,new_lock);
 END LOOP;
END $$;

-- Publication must not retain its preview while waiting for the institution:
-- suspension holds that institution and invalidates previews through the grant
-- trigger. Match the institution -> connection -> grant -> preview order used
-- by access removal. The first read only locates the connection; re-read and
-- lock the exact owned preview after the authorization/grant locks are held.
DO $$
DECLARE
 definition text := pg_get_functiondef('origen_binder_sharing_command(jsonb)'::regprocedure);
 preview_lock constant text := $source$SELECT * INTO card FROM origen_binder_previews WHERE account_id=owner AND student_id=student AND id=(input->>'previewId')::uuid FOR UPDATE;$source$;
 grant_lock constant text := $source$SELECT * INTO g FROM origen_binder_share_grants WHERE connection_id=c.id FOR UPDATE;$source$;
BEGIN
 IF length(definition)-length(replace(definition,preview_lock,''))<>length(preview_lock)
  OR length(definition)-length(replace(definition,grant_lock,''))<>length(grant_lock) THEN
  RAISE EXCEPTION 'unexpected_coordinator_publication_lock_order';
 END IF;
 definition := replace(definition,preview_lock,replace(preview_lock,' FOR UPDATE',''));
 definition := replace(definition,grant_lock,grant_lock||E'\n'||$late$
 IF action='publish' THEN
  SELECT * INTO card FROM origen_binder_previews WHERE account_id=owner AND student_id=student AND id=(input->>'previewId')::uuid FOR UPDATE;
  IF card.id IS NULL OR card.connection_id IS DISTINCT FROM c.id THEN RETURN '{"error":"sharing_changed"}'; END IF;
 END IF;
$late$);
 EXECUTE definition;
END $$;

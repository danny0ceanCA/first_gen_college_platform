-- Keep stop controls independent of admission gates, and make cancellation
-- receipts truthful. Preserve the installed functions' lock order and ACLs.
DO $$
DECLARE
 definition text := pg_get_functiondef('origen_binder_sharing_command(jsonb)'::regprocedure);
 anchor text := $old$IF g.id IS NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;$old$;
BEGIN
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'unexpected_sharing_stop_anchor';
 END IF;
 -- Even an idempotent stop must invalidate reviews prepared since the last
 -- stop. Otherwise another tab can restore access after this stop succeeds.
 EXECUTE replace(definition,anchor,anchor||E'\n'||
  '  DELETE FROM origen_binder_previews WHERE connection_id=g.connection_id;');
END $$;

DO $$
DECLARE
 definition text := pg_get_functiondef('origen_coordinator_connection_command(jsonb)'::regprocedure);
 admission text := $old$IF ctx.channel='voice' AND input->>'voiceEnabled' IS DISTINCT FROM 'true' THEN RETURN '{"error":"connection_denied"}'; END IF;$old$;
 cancel_statement text := $old$DELETE FROM origen_coordinator_link_challenges WHERE context_id=ctx.id AND id=(input->>'challengeId')::uuid AND connection_id IS NULL;$old$;
BEGIN
 IF length(definition)-length(replace(definition,admission,''))<>length(admission)
  OR length(definition)-length(replace(definition,cancel_statement,''))<>length(cancel_statement) THEN
  RAISE EXCEPTION 'unexpected_connection_stop_anchor';
 END IF;
 definition:=replace(definition,admission,$new$
  -- The authenticated owner can inspect and remove existing connections even
  -- after permission expires or coordinator admission is paused. No new access.
  IF action IN ('list','withdraw') THEN
   IF NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student)
    OR EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN
    RETURN '{"error":"connection_denied"}';
   END IF;
   IF action='list' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'status',CASE WHEN c.status='requested' AND c.expires_at<=now() THEN 'expired' ELSE c.status END,'coordinatorName',p.display_name,'organizationName',i.draft->>'name','topics',c.intended_topics,'expiresAt',c.expires_at) ORDER BY c.created_at DESC),'[]') INTO result
    FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id JOIN origen_institutions i ON i.id=p.institution_id WHERE c.account_id=owner AND c.student_id=student;
    RETURN jsonb_build_object('connections',result,'sharingEnabled',false);
   END IF;
   SELECT * INTO connection FROM origen_binder_connections WHERE id=(input->>'connectionId')::uuid AND account_id=owner AND student_id=student FOR UPDATE;
   IF connection.id IS NULL THEN RETURN '{"error":"connection_denied"}'; END IF;
   UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=connection.id AND status IN ('requested','accepted');
   UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),current_publication_id=NULL,revision=revision+1 WHERE connection_id=connection.id AND status<>'revoked';
   DELETE FROM origen_binder_previews WHERE connection_id=connection.id;
   RETURN jsonb_build_object('status',(SELECT status FROM origen_binder_connections WHERE id=connection.id),'sharingEnabled',false);
  END IF;
$new$||admission);
 definition:=replace(definition,cancel_statement,$new$
    SELECT c.* INTO connection FROM origen_coordinator_link_challenges ch JOIN origen_binder_connections c ON c.id=ch.connection_id
     WHERE ch.context_id=ctx.id AND ch.id=(input->>'challengeId')::uuid AND c.account_id=owner AND c.student_id=student;
    IF connection.id IS NOT NULL THEN
     RETURN jsonb_build_object('status',CASE WHEN connection.status='requested' AND connection.expires_at<=now() THEN 'expired' ELSE connection.status END,'connectionId',connection.id,'sharingEnabled',false);
    END IF;
$new$||cancel_statement);
 EXECUTE definition;
END $$;

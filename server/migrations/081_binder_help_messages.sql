-- Messages belong to an explicitly reviewed publication, never to private chat.
ALTER TABLE origen_binder_previews ADD COLUMN student_message text NOT NULL DEFAULT '' CHECK(length(student_message)<=1000);
ALTER TABLE origen_binder_previews ADD COLUMN request_help boolean NOT NULL DEFAULT false;
ALTER TABLE origen_binder_publications ADD COLUMN student_message text NOT NULL DEFAULT '' CHECK(length(student_message)<=1000);
ALTER TABLE origen_binder_share_grants ADD COLUMN help_request_id uuid;
ALTER TABLE origen_binder_share_grants ADD COLUMN help_resolved_publication_id uuid;
UPDATE origen_binder_share_grants SET help_request_id=gen_random_uuid() WHERE help_publication_id IS NOT NULL;

-- Keep all installed authorization, source checks, lock ordering and ACLs.
DO $$
DECLARE definition text:=pg_get_functiondef('origen_binder_sharing_command(jsonb)'::regprocedure); patch record;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
 ($old$IF action='preview' THEN
  DELETE FROM origen_binder_previews$old$,
 $new$IF action='preview' THEN
  IF input ? 'message' AND (jsonb_typeof(input->'message') IS DISTINCT FROM 'string' OR length(input->>'message')>1000)
   OR input ? 'requestHelp' AND jsonb_typeof(input->'requestHelp') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"sharing_denied"}'; END IF;
  DELETE FROM origen_binder_previews$new$),
 ($old$RETURN jsonb_build_object('previewId',card.id$old$,
 $new$UPDATE origen_binder_previews SET student_message=btrim(coalesce(input->>'message','')),request_help=coalesce((input->>'requestHelp')::boolean,false) WHERE id=card.id RETURNING * INTO card;
  RETURN jsonb_build_object('message',card.student_message,'requestHelp',card.request_help,'previewId',card.id$new$),
 ($old$UPDATE origen_binder_share_grants SET current_publication_id=pub.id WHERE id=g.id;$old$,
 $new$UPDATE origen_binder_publications SET student_message=card.student_message WHERE id=pub.id;
 UPDATE origen_binder_share_grants SET current_publication_id=pub.id,help_publication_id=CASE WHEN card.request_help THEN pub.id ELSE NULL END,
  help_request_id=CASE WHEN card.request_help THEN gen_random_uuid() ELSE NULL END,help_resolved_publication_id=NULL WHERE id=g.id;$new$),
 ($old$'expiresAt',sg.expires_at,$old$,
 $new$'expiresAt',sg.expires_at,'helpResolved',coalesce(sg.help_resolved_publication_id=sg.current_publication_id AND origen_binder_grant_live(sg.id),false),
  'message',CASE WHEN enabled AND origen_binder_grant_live(sg.id) THEN coalesce((SELECT student_message FROM origen_binder_publications WHERE id=sg.current_publication_id),'') ELSE '' END,$new$)
 ) AS patches(old_text,new_text) LOOP
  IF length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) THEN RAISE EXCEPTION 'unexpected_binder_message_anchor'; END IF;
  definition:=replace(definition,patch.old_text,patch.new_text);
 END LOOP;
 EXECUTE definition;
END $$;

DO $$
DECLARE definition text:=pg_get_functiondef('origen_binder_help_command(jsonb)'::regprocedure);
 anchor text:='UPDATE origen_binder_share_grants SET help_publication_id=CASE WHEN (input->>''requested'')::boolean THEN current_publication_id ELSE NULL END WHERE id=g.id;';
BEGIN
 IF length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'unexpected_help_request_anchor'; END IF;
 EXECUTE replace(definition,anchor,$new$UPDATE origen_binder_share_grants SET help_publication_id=CASE WHEN (input->>'requested')::boolean THEN current_publication_id ELSE NULL END,
  help_request_id=CASE WHEN (input->>'requested')::boolean THEN gen_random_uuid() ELSE NULL END,help_resolved_publication_id=NULL WHERE id=g.id;$new$);
END $$;

DO $$
DECLARE definition text:=pg_get_functiondef('origen_coordinator_binder_command(jsonb)'::regprocedure); patch record;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
 ($old$action NOT IN ('list','read','review')$old$,$new$action NOT IN ('list','read','review','resolve-help')$new$),
 ($old$PERFORM 1 FROM origen_binder_share_grants WHERE coordinator_id=p.id AND (action='list' OR id=(input->>'grantId')::uuid) ORDER BY id FOR SHARE;$old$,
 $new$IF action='resolve-help' THEN
  PERFORM 1 FROM origen_binder_share_grants WHERE coordinator_id=p.id AND id=(input->>'grantId')::uuid FOR UPDATE;
 ELSE
  PERFORM 1 FROM origen_binder_share_grants WHERE coordinator_id=p.id AND (action='list' OR id=(input->>'grantId')::uuid) ORDER BY id FOR SHARE;
 END IF;$new$),
 ($old$IF action='review' THEN$old$,
 $new$IF action='resolve-help' THEN
  IF row.publication_id IS DISTINCT FROM (input->>'publicationId')::uuid OR NOT EXISTS(
   SELECT 1 FROM origen_binder_share_grants WHERE id=row.id AND help_request_id=(input->>'helpRequestId')::uuid
   AND (help_publication_id=row.publication_id OR help_resolved_publication_id=row.publication_id)) THEN RETURN '{"error":"binder_changed"}'; END IF;
  UPDATE origen_binder_share_grants SET help_publication_id=NULL,help_resolved_publication_id=row.publication_id WHERE id=row.id;
  RETURN '{"status":"resolved"}';
 END IF;
 IF action='review' THEN$new$),
 ($old$'helpRequested',row.help_requested,'entries',contents$old$,
 $new$'helpRequested',row.help_requested,'helpRequestId',(SELECT help_request_id FROM origen_binder_share_grants WHERE id=row.id),
 'helpResolved',coalesce((SELECT help_resolved_publication_id=row.publication_id FROM origen_binder_share_grants WHERE id=row.id),false),
 'message',(SELECT student_message FROM origen_binder_publications WHERE id=row.publication_id),'entries',contents$new$)
 ) AS patches(old_text,new_text) LOOP
  IF length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) THEN RAISE EXCEPTION 'unexpected_help_resolution_anchor'; END IF;
  definition:=replace(definition,patch.old_text,patch.new_text);
 END LOOP;
 EXECUTE definition;
END $$;

-- Superseded publication messages follow the same erasure as shared note text.
CREATE FUNCTION origen_clear_invalidated_share_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.invalidated_at IS NOT NULL THEN NEW.student_message:=''; END IF; RETURN NEW; END $$;
CREATE TRIGGER binder_clear_invalidated_message BEFORE UPDATE ON origen_binder_publications
 FOR EACH ROW EXECUTE FUNCTION origen_clear_invalidated_share_message();
REVOKE ALL ON FUNCTION origen_clear_invalidated_share_message() FROM PUBLIC;

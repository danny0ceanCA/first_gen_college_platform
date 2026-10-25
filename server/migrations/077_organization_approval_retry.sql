-- A duplicate enable may acknowledge the immediately preceding decision by
-- the same reviewer. It cannot reverse suspension or any later revision.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 definition := pg_get_functiondef('origen_coordinator_command(jsonb)'::regprocedure);
 old_text := $old$   IF COALESCE((input->>'revision')::integer,0)<>COALESCE(pilot.revision,0) THEN
    RAISE EXCEPTION 'organization_changed' USING ERRCODE='40001';
   END IF;$old$;
 new_text := $new$   IF COALESCE((input->>'revision')::integer,0)<>COALESCE(pilot.revision,0) THEN
    IF pilot.status='active' AND pilot.approved_by=actor
     AND pilot.revision::bigint=COALESCE((input->>'revision')::bigint,0)+1 THEN
     RETURN '{"ok":true,"replayed":true}'::jsonb;
    END IF;
    RAISE EXCEPTION 'organization_changed' USING ERRCODE='40001';
   END IF;$new$;
 IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'organization_approval_retry_source_mismatch'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END $migration$;

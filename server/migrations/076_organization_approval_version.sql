-- Only the version an admin reviewed may be enabled. A delayed approval must
-- never reverse a suspension, archival, or affiliation invalidation.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 definition := pg_get_functiondef('origen_coordinator_command(jsonb)'::regprocedure);
 old_text := $old$   INSERT INTO origen_coordinator_organizations(institution_id,status,approved_by) VALUES(org.id,'active',actor)$old$;
 new_text := $new$   SELECT * INTO pilot FROM origen_coordinator_organizations WHERE institution_id=org.id;
   IF COALESCE((input->>'revision')::integer,0)<>COALESCE(pilot.revision,0) THEN
    RAISE EXCEPTION 'organization_changed' USING ERRCODE='40001';
   END IF;
   INSERT INTO origen_coordinator_organizations(institution_id,status,approved_by) VALUES(org.id,'active',actor)$new$;
 IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'organization_approval_version_source_mismatch'; END IF;
 definition := replace(definition,old_text,new_text);
 -- Both the legacy workspace overview and the paginated admin queue expose
 -- this token; zero means coordinator access has never been approved.
 old_text := $old$'pilotStatus',COALESCE(o.status,'not-approved')$old$;
 new_text := $new$'pilotRevision',COALESCE(o.revision,0),'pilotStatus',COALESCE(o.status,'not-approved')$new$;
 IF length(definition)-length(replace(definition,old_text,''))<>2*length(old_text) THEN RAISE EXCEPTION 'organization_approval_overview_source_mismatch'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END $migration$;

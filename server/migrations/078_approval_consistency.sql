-- Review decisions must refer to the affiliation version the reviewer saw.
ALTER TABLE origen_institution_affiliation_requests
 ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);

-- Preserve original application claims while exposing the exact registration
-- that signup created. Renames must not redirect approval to a name match.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 definition := pg_get_functiondef('origen_coordinator_application_command(jsonb)'::regprocedure);
 old_text := $old$'organizationWebsite',a.organization_website,'jobRole',a.job_role,'createdAt',a.created_at) item
   FROM origen_coordinator_applications a WHERE a.status='pending'$old$;
 new_text := $new$'organizationWebsite',a.organization_website,'jobRole',a.job_role,'createdAt',a.created_at,
    'registeredInstitutionId',registration.institution_id,'registeredOrganizationName',registered.draft->>'name') item
   FROM origen_coordinator_applications a
   LEFT JOIN origen_institution_registration_requests registration ON registration.auth0_subject=a.auth0_subject AND registration.request_id=a.id
   LEFT JOIN origen_institutions registered ON registered.id=registration.institution_id
   WHERE a.status='pending'$new$;
 IF strpos(definition,old_text)=0 THEN RAISE EXCEPTION 'approval_registration_link_source_mismatch'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END $migration$;

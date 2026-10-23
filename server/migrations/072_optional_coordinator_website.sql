-- Coordinator applications may be reviewed without an organization website.
-- Keep NOT NULL and the existing length bound; blank means not supplied.
ALTER TABLE origen_coordinator_applications
 DROP CONSTRAINT origen_coordinator_applications_organization_website_check;
ALTER TABLE origen_coordinator_applications
 ADD CONSTRAINT origen_coordinator_applications_organization_website_check
 CHECK (length(organization_website) BETWEEN 0 AND 2000);

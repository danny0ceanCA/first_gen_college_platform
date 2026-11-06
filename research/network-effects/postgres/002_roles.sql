-- Apply explicitly with the separate migration credential after 001_foundation,
-- including reruns that add scoped processing_gaps or other shadow-only tables.
-- Role passwords are provisioned separately; none are saved in this repository.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='origen_network_worker') THEN
    CREATE ROLE origen_network_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='origen_network_admin') THEN
    CREATE ROLE origen_network_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA origen_network_effects TO origen_network_worker,origen_network_admin;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA origen_network_effects TO origen_network_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA origen_network_effects TO origen_network_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA origen_network_effects TO origen_network_admin;
GRANT INSERT ON origen_network_effects.reviews TO origen_network_admin;
-- Review recalculates only this offline derived projection, never an operational record.
GRANT INSERT,UPDATE,DELETE ON origen_network_effects.episodes TO origen_network_admin;
GRANT USAGE,SELECT ON SEQUENCE origen_network_effects.reviews_sequence_seq TO origen_network_admin;

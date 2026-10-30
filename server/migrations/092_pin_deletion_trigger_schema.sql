-- CREATE OR REPLACE resets function settings. Keep the security-definer
-- trigger bound to its migration schema, as originally configured in 037.
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_record_deletion() SET search_path=%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_record_deletion() FROM PUBLIC;

ALTER TABLE ledger_erased DROP CONSTRAINT ledger_erased_kind_check;
ALTER TABLE ledger_erased ADD CHECK(kind IN('operation','request','trace','case'));
CREATE OR REPLACE FUNCTION ledger_append(refs jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb;scope text;generation bigint;
BEGIN
 SELECT environment INTO scope FROM ledger_scopes WHERE role_name=session_user;IF scope IS NULL OR jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)>200 THEN RAISE EXCEPTION 'invalid_erasure';END IF;
 PERFORM 1 FROM ledger_control FOR UPDATE;
 FOR r IN SELECT * FROM jsonb_array_elements(refs) LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(r))<>2 OR r->>'kind' NOT IN('operation','request','trace','case') OR (r->>'reference')!~(CASE WHEN r->>'kind'='trace' THEN '^[a-f0-9]{32}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END) THEN RAISE EXCEPTION 'invalid_erasure';END IF;
  INSERT INTO ledger_erased(environment,kind,reference) VALUES(scope,r->>'kind',r->>'reference') ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE ledger_control SET generation=GREATEST(ledger_control.generation,(SELECT COALESCE(max(sequence),0) FROM ledger_erased)) WHERE id RETURNING ledger_control.generation INTO generation;RETURN generation;
END $$;

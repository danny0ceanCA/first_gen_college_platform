REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE ledger_scopes(role_name name PRIMARY KEY,environment text NOT NULL);
CREATE TABLE ledger_control(id boolean PRIMARY KEY DEFAULT true CHECK(id),generation bigint NOT NULL DEFAULT 0);INSERT INTO ledger_control(id) VALUES(true);
CREATE TABLE ledger_erased(sequence bigserial UNIQUE,environment text NOT NULL,kind text NOT NULL CHECK(kind IN('operation','request','trace')),reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '720 hours',PRIMARY KEY(environment,kind,reference));
CREATE INDEX ledger_erased_expiry ON ledger_erased(expires_at);
CREATE FUNCTION ledger_append(refs jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb;scope text;generation bigint;
BEGIN
 SELECT environment INTO scope FROM ledger_scopes WHERE role_name=session_user;IF scope IS NULL OR jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)>200 THEN RAISE EXCEPTION 'invalid_erasure';END IF;
 PERFORM 1 FROM ledger_control FOR UPDATE;
 FOR r IN SELECT * FROM jsonb_array_elements(refs) LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(r))<>2 OR r->>'kind' NOT IN('operation','request','trace') OR (r->>'reference')!~(CASE WHEN r->>'kind'='trace' THEN '^[a-f0-9]{32}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END) THEN RAISE EXCEPTION 'invalid_erasure';END IF;
  INSERT INTO ledger_erased(environment,kind,reference) VALUES(scope,r->>'kind',r->>'reference') ON CONFLICT DO NOTHING;
 END LOOP;
 UPDATE ledger_control SET generation=GREATEST(ledger_control.generation,(SELECT COALESCE(max(sequence),0) FROM ledger_erased)) WHERE id RETURNING ledger_control.generation INTO generation;RETURN generation;
END $$;
CREATE FUNCTION ledger_page(after_sequence bigint,until_sequence bigint) RETURNS TABLE(sequence bigint,environment text,kind text,reference text,expires_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sequence,environment,kind,reference,expires_at FROM ledger_erased WHERE expires_at>now() AND sequence>after_sequence AND sequence<=until_sequence ORDER BY sequence LIMIT 200 $$;
CREATE FUNCTION ledger_generation() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT generation FROM ledger_control $$;
CREATE FUNCTION ledger_expire() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM ledger_erased WHERE (environment,kind,reference) IN(SELECT environment,kind,reference FROM ledger_erased WHERE expires_at<=now() LIMIT 10000) $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION ledger_append(jsonb),ledger_page(bigint,bigint),ledger_generation(),ledger_expire() FROM PUBLIC;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE agent_audit(
 call_id uuid NOT NULL,phase text NOT NULL CHECK(phase IN('intent','completion')),case_id uuid NOT NULL,run_id uuid NOT NULL,
 tool text NOT NULL CHECK(tool IN('start','finish','get_report','unknown','get_incident','get_timeline','get_request','get_metrics','get_release','get_runbook','read_source','propose_reproduction')),
 decision text NOT NULL CHECK(decision IN('allowed','denied','completed','unavailable','budget_exhausted','revoked')),
 result_count integer NOT NULL CHECK(result_count BETWEEN 0 AND 200),artifact_id uuid,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(call_id,phase)
);
CREATE INDEX agent_audit_expiry ON agent_audit(created_at);
CREATE FUNCTION agent_audit_append(call_ref uuid,stage text,case_ref uuid,run_ref uuid,tool_name text,decision_code text,results integer,artifact_ref uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF stage='completion' AND NOT EXISTS(SELECT 1 FROM agent_audit WHERE call_id=call_ref AND phase='intent' AND case_id=case_ref AND run_id=run_ref AND tool=tool_name AND decision='allowed') THEN RAISE EXCEPTION 'audit_unavailable';END IF;
 INSERT INTO agent_audit(call_id,phase,case_id,run_id,tool,decision,result_count,artifact_id) VALUES(call_ref,stage,case_ref,run_ref,tool_name,decision_code,results,artifact_ref);
END $$;
CREATE TABLE agent_reports(id uuid PRIMARY KEY,case_id uuid NOT NULL,run_id uuid NOT NULL UNIQUE,body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=8192),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)));
CREATE INDEX agent_reports_expiry ON agent_reports(expires_at);
CREATE TABLE agent_lease(id boolean PRIMARY KEY DEFAULT true CHECK(id),run_id uuid NOT NULL,expires_at timestamptz NOT NULL);
CREATE FUNCTION agent_run_claim(run_ref uuid,expiry timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF expiry<=now() OR expiry>now()+interval '10 minutes' THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(728426,2);
 IF EXISTS(SELECT 1 FROM agent_lease WHERE expires_at>now()) THEN RETURN false;END IF;
 INSERT INTO agent_lease VALUES(true,run_ref,expiry) ON CONFLICT(id) DO UPDATE SET run_id=EXCLUDED.run_id,expires_at=EXCLUDED.expires_at;RETURN true;
END $$;
CREATE FUNCTION agent_run_release(run_ref uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM agent_lease WHERE run_id=run_ref $$;
CREATE FUNCTION agent_report_save(report_ref uuid,case_ref uuid,run_ref uuid,report jsonb,expiry timestamptz,call_ref uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF expiry<=now() OR expiry>now()+interval '15 minutes' OR NOT EXISTS(SELECT 1 FROM agent_audit WHERE call_id=call_ref AND phase='completion' AND decision='completed' AND case_id=case_ref AND run_id=run_ref AND tool='finish' AND artifact_id=report_ref) OR (SELECT count(*) FROM jsonb_object_keys(report))<>10 OR report->>'status' NOT IN('diagnosis','partial') OR report->>'suspectedFailure' NOT IN('storage-failure','provider-timeout','permission-change','connection-failure','insufficient-evidence') OR report->>'uncertainty' NOT IN('low','medium','high') THEN RAISE EXCEPTION 'report_unavailable';END IF;
 INSERT INTO agent_reports VALUES(report_ref,case_ref,run_ref,report,expiry);
END $$;
CREATE FUNCTION agent_report_load(report_ref uuid,case_ref uuid,run_ref uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT body FROM agent_reports WHERE id=report_ref AND case_id=case_ref AND run_id=run_ref AND expires_at>now() $$;
CREATE FUNCTION agent_report_revoke(run_ref uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM agent_reports WHERE run_id=run_ref $$;
CREATE FUNCTION agent_expire() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN DELETE FROM agent_reports WHERE id IN(SELECT id FROM agent_reports WHERE expires_at<=now() LIMIT 1000);DELETE FROM agent_audit WHERE (call_id,phase) IN(SELECT call_id,phase FROM agent_audit WHERE created_at<now()-interval '90 days' LIMIT 10000);END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION agent_run_claim(uuid,timestamptz),agent_run_release(uuid),agent_audit_append(uuid,text,uuid,uuid,text,text,integer,uuid),agent_report_save(uuid,uuid,uuid,jsonb,timestamptz,uuid),agent_report_load(uuid,uuid,uuid),agent_report_revoke(uuid),agent_expire() FROM PUBLIC;

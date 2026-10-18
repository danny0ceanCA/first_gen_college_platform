-- A summary and its organization job commit together. No transcript/token copy.
CREATE TABLE origen_binder_jobs (
 account_id uuid NOT NULL,
 summary_id text NOT NULL,
 student_id text,
 permission_revision integer,
 language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','es')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,
 manual_retries integer NOT NULL DEFAULT 0 CHECK(manual_retries BETWEEN 0 AND 2),
 attempt_times timestamptz[] NOT NULL DEFAULT '{}',
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,summary_id),
 FOREIGN KEY(account_id,summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_binder_due ON origen_binder_jobs(available_at) WHERE status IN ('pending','running');
ALTER TABLE origen_binder_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_binder_jobs ON origen_binder_jobs USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY binder_job_dispatch ON origen_binder_jobs FOR SELECT USING(current_setting('origen.purpose',true)='retention');
CREATE POLICY binder_job_claim ON origen_binder_jobs FOR UPDATE USING(current_setting('origen.purpose',true)='retention') WITH CHECK(current_setting('origen.purpose',true)='retention');
CREATE POLICY binder_job_expire ON origen_binder_jobs FOR DELETE USING(current_setting('origen.purpose',true)='retention' AND created_at<now()-interval '7 days');

CREATE FUNCTION origen_enqueue_binder_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE r integer; BEGIN
 SELECT e.revision INTO r FROM origen_accounts a JOIN origen_eligibility e
  ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex') WHERE a.id=NEW.account_id;
 INSERT INTO origen_binder_jobs(account_id,summary_id,student_id,permission_revision)
  VALUES(NEW.account_id,NEW.id,NEW.student_id,r) ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER enqueue_binder_job AFTER INSERT ON origen_conversation_summaries FOR EACH ROW EXECUTE FUNCTION origen_enqueue_binder_job();

REVOKE ALL ON FUNCTION origen_enqueue_binder_job() FROM PUBLIC;

DO $$ BEGIN EXECUTE format('ALTER FUNCTION %I.origen_enqueue_binder_job() SET search_path TO pg_catalog,%I,pg_temp',current_schema(),current_schema()); END $$;

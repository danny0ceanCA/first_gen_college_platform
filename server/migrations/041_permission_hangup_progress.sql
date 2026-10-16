ALTER TABLE origen_permission_calls ADD COLUMN hangup_pending_at timestamptz;
ALTER TABLE origen_permission_calls ADD COLUMN hangup_attempts integer NOT NULL DEFAULT 0 CHECK(hangup_attempts BETWEEN 0 AND 1000000);
CREATE INDEX origen_permission_calls_pending ON origen_permission_calls(hangup_pending_at,expires_at);
CREATE POLICY permission_calls_job_progress ON origen_permission_calls FOR UPDATE
 USING(current_setting('origen.purpose',true)='retention')
 WITH CHECK(current_setting('origen.purpose',true)='retention');

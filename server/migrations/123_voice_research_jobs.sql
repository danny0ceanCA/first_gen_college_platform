CREATE TABLE origen_voice_research_jobs (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 student_id text,
 session_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key)<=100),
 input jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 started_at timestamptz,
 finished_at timestamptz,
 UNIQUE(account_id,session_id,request_key),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX voice_research_pending ON origen_voice_research_jobs(created_at) WHERE status='queued';
ALTER TABLE origen_voice_research_jobs ENABLE ROW LEVEL SECURITY;
-- CASE prevents invoking the account lookup for the queue-only worker role.
-- That role intentionally has no SELECT privilege on accounts or students.
CREATE POLICY voice_research_access ON origen_voice_research_jobs
 USING(CASE WHEN current_user='origen_research_worker' THEN true
       ELSE account_id=origen_current_account_id() END)
 WITH CHECK(CASE WHEN current_user='origen_research_worker' THEN true
       ELSE account_id=origen_current_account_id() END);

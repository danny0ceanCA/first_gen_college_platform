-- Optional feedback opportunities; no transcript, free text, or institution attribution.
CREATE TABLE origen_feedback_prompts (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL, student_id text, language text NOT NULL CHECK(language IN ('en','es')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_progress_reports ADD COLUMN prompt_id uuid;
ALTER TABLE origen_progress_reports ADD CONSTRAINT origen_report_prompt_fk
 FOREIGN KEY(account_id,prompt_id) REFERENCES origen_feedback_prompts(account_id,id) ON DELETE CASCADE;
ALTER TABLE origen_progress_reports ADD CONSTRAINT origen_feedback_prompt_kind CHECK(prompt_id IS NULL OR kind='feedback');
CREATE UNIQUE INDEX origen_feedback_once_per_prompt ON origen_progress_reports(account_id,prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX origen_feedback_prompt_window ON origen_feedback_prompts(recorded_at,account_id);
CREATE INDEX origen_progress_reporting_window ON origen_progress_reports(recorded_at,kind,account_id);

-- Explicitly saved, suppressed institution report pages only. No personal progress is copied.
CREATE TABLE origen_institution_report_snapshots (
 id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), month text NOT NULL,
 payload jsonb NOT NULL
);
CREATE INDEX origen_institution_snapshot_retention ON origen_institution_report_snapshots(created_at DESC,id);
CREATE INDEX origen_outreach_state_at_cutoff ON origen_institution_outreach_states(fact_id,created_at DESC,id DESC);

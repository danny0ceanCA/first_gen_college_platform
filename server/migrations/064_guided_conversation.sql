-- Only bounded question keys/statuses, never answer text or transcripts.
CREATE TABLE origen_guidance_questions (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 scope_key text NOT NULL,
 student_id text,
 question_key text NOT NULL CHECK(question_key IN ('work_days','aid_progress','entry_term','interests')),
 status text NOT NULL CHECK(status IN ('asked','answered','declined')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(account_id,scope_key,question_key),
 CHECK(scope_key=coalesce(student_id,'')),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_guidance_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_guidance_questions ON origen_guidance_questions USING(account_id=(SELECT origen_current_account_id()));
ALTER TABLE origen_live_memory_sessions ADD COLUMN gap_key text CHECK(gap_key IN ('work_days','aid_progress','entry_term','interests'));
ALTER TABLE origen_live_memory_sessions ADD COLUMN gap_turn integer;
ALTER TABLE origen_live_memory_sessions ADD COLUMN gap_presented boolean NOT NULL DEFAULT false;

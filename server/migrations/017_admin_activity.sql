-- Operational usage only: no audio, transcripts, prompts or student details.
CREATE TABLE origen_login_activity (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_login_activity_date ON origen_login_activity(created_at);
CREATE TABLE origen_voice_activity (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 topic text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 seconds double precision NOT NULL DEFAULT 0 CHECK(seconds BETWEEN 0 AND 600)
);
CREATE INDEX origen_voice_activity_date ON origen_voice_activity(started_at);

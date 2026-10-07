ALTER TABLE origen_accounts ADD COLUMN onboarding_started_at timestamptz;
ALTER TABLE origen_accounts ADD COLUMN onboarding_completed_at timestamptz;
-- Historical completion dates cannot be reconstructed reliably; leave them unknown.
CREATE INDEX origen_login_account_date ON origen_login_activity(account_id,created_at DESC);
CREATE INDEX origen_voice_account_date ON origen_voice_activity(account_id,started_at DESC);

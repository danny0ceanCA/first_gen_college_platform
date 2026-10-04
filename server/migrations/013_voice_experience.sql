ALTER TABLE origen_accounts ADD COLUMN IF NOT EXISTS welcome_heard_at timestamptz;
ALTER TABLE origen_accounts ADD COLUMN IF NOT EXISTS voice_used_at timestamptz;

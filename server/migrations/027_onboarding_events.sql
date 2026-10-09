CREATE TABLE origen_onboarding_attempts (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 last_received_at timestamptz NOT NULL DEFAULT now(),
 resumed boolean NOT NULL DEFAULT false,
 saved_at timestamptz,
 PRIMARY KEY(account_id,id)
);
CREATE TABLE origen_onboarding_events (
 account_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 producer text NOT NULL CHECK(producer IN ('client','server')),
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=2000),
 name text NOT NULL,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(account_id,attempt_id,producer,sequence),
 FOREIGN KEY(account_id,attempt_id) REFERENCES origen_onboarding_attempts(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_onboarding_events_date ON origen_onboarding_events(received_at);
CREATE INDEX origen_onboarding_attempts_date ON origen_onboarding_attempts(last_received_at);

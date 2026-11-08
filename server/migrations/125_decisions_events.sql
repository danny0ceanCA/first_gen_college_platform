-- Durable metadata only. No transcript, prompt, raw provider reasoning or secrets.
CREATE TABLE origen_decisions_events (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 run_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),
 stage text NOT NULL CHECK(length(stage)<=100),
 observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 release text,
 data jsonb NOT NULL CHECK(octet_length(data::text)<=20000),
 UNIQUE(account_id,session_id,run_id,sequence)
);
CREATE INDEX decisions_events_call ON origen_decisions_events(account_id,session_id,sequence);
ALTER TABLE origen_decisions_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY decisions_events_owner ON origen_decisions_events
 USING(account_id=origen_current_account_id())
 WITH CHECK(account_id=origen_current_account_id());

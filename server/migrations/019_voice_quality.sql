CREATE TABLE origen_voice_quality_events (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 attempt_id uuid NOT NULL,
 session_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=100000),
 event text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 mode text,
 language text,
 code text,
 connection_state text,
 duration_ms integer,
 PRIMARY KEY(account_id,attempt_id,sequence)
);
CREATE INDEX origen_voice_quality_date ON origen_voice_quality_events(received_at);

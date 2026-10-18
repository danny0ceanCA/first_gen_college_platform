-- Short-lived, content-free capabilities. No transcript, proposed text, or
-- provider output is archived here. Source tables own all saved content.
CREATE TABLE origen_live_memory_sessions (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 student_id text,
 revision integer NOT NULL CHECK(revision>=0),
 turn_sequence integer NOT NULL DEFAULT 0,
 turn_id text NOT NULL DEFAULT '',
 transcript_hash text NOT NULL DEFAULT '',
 turn_language text NOT NULL DEFAULT 'en' CHECK(turn_language IN ('en','es')),
 proposal_hash text,
 proposal_turn integer,
 proposal_at timestamptz,
 proposal_presented boolean NOT NULL DEFAULT false,
 closed boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_live_memory_receipts (
 account_id uuid NOT NULL,
 session_id uuid NOT NULL,
 turn_sequence integer NOT NULL,
 request_id uuid NOT NULL,
 fingerprint text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('create','update','delete','next-step')),
 record_id uuid NOT NULL,
 record_version integer NOT NULL,
 revision integer NOT NULL,
 PRIMARY KEY(account_id,session_id,turn_sequence),
 UNIQUE(account_id,request_id),
 FOREIGN KEY(account_id,session_id) REFERENCES origen_live_memory_sessions(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_live_memory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_live_memory_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_live_memory_session ON origen_live_memory_sessions USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_live_memory_receipt ON origen_live_memory_receipts USING(account_id=(SELECT origen_current_account_id()));

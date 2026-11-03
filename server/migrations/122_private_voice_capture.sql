-- Explicitly requested private diagnostic archive. Never available to coordinator/reporting roles.
CREATE TABLE origen_private_voice_capture (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 student_id text,
 sequence integer NOT NULL CHECK(sequence>0),
 client_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
 data jsonb NOT NULL CHECK(octet_length(data::text)<=60000),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX private_voice_capture_session ON origen_private_voice_capture(account_id,session_id,received_at,id);
ALTER TABLE origen_private_voice_capture ENABLE ROW LEVEL SECURITY;
CREATE POLICY private_voice_capture_owner ON origen_private_voice_capture
 USING(account_id=(SELECT origen_current_account_id()))
 WITH CHECK(account_id=(SELECT origen_current_account_id()));
CREATE POLICY private_voice_capture_expired ON origen_private_voice_capture FOR SELECT
 USING(current_setting('origen.purpose',true)='retention' AND expires_at<=now());
CREATE POLICY private_voice_capture_purge ON origen_private_voice_capture FOR DELETE
 USING(current_setting('origen.purpose',true)='retention' AND expires_at<=now());

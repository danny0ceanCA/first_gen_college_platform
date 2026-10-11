CREATE TABLE origen_staff_access_controls (
 subject_hash text PRIMARY KEY CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
 blocked boolean NOT NULL DEFAULT true,
 token_valid_after timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE origen_privileged_access_audit (
 id uuid PRIMARY KEY,
 actor_hash text NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
 area text NOT NULL CHECK (area IN ('admin','institution','inquiry','campaign','metrics','family')),
 action text NOT NULL CHECK (action ~ '^[a-z][a-z-]{0,40}$'),
 target_hash text CHECK (target_hash ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK (outcome IN ('authorized','denied','completed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_privileged_access_audit_actor_time ON origen_privileged_access_audit(actor_hash,created_at DESC);
CREATE INDEX origen_privileged_access_audit_time ON origen_privileged_access_audit(created_at);
ALTER TABLE origen_privileged_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY origen_privileged_audit_insert ON origen_privileged_access_audit FOR INSERT
 WITH CHECK (actor_hash = nullif(current_setting('origen.subject_hash',true),''));
ALTER TABLE origen_staff_access_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY origen_staff_control_read ON origen_staff_access_controls FOR SELECT
 USING (subject_hash = nullif(current_setting('origen.subject_hash',true),''));
-- No audit read/update/delete policy. Review and retention use an operator
-- credential outside the web service. Runtime grants are applied separately.

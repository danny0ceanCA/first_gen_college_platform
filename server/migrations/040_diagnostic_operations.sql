-- Correlation hints never authorize access. No analytics/institution read policy.
CREATE TABLE origen_diagnostic_operations (
 operation_id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 student_id text,
 kind text NOT NULL CHECK(kind IN ('voice','summary','history','notes','onboarding')),
 client_operation_id uuid NOT NULL,
 trace_id text NOT NULL CHECK(trace_id ~ '^[a-f0-9]{32}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '336 hours'),
 CHECK(expires_at=created_at+interval '336 hours'),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
-- Existing student IDs cannot be empty, so NULL and student scopes cannot collide.
CREATE UNIQUE INDEX origen_diagnostic_operations_scope ON origen_diagnostic_operations(account_id,COALESCE(student_id,''),kind,client_operation_id);
CREATE INDEX origen_diagnostic_operations_expiry ON origen_diagnostic_operations(expires_at);
CREATE INDEX origen_diagnostic_operations_budget ON origen_diagnostic_operations(account_id,created_at);
ALTER TABLE origen_diagnostic_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY diagnostic_owner_read ON origen_diagnostic_operations FOR SELECT
 USING(account_id=(SELECT origen_current_account_id()) AND expires_at>now());
CREATE POLICY diagnostic_owner_insert ON origen_diagnostic_operations FOR INSERT
 WITH CHECK(account_id=(SELECT origen_current_account_id()));
CREATE POLICY diagnostic_expiry_read ON origen_diagnostic_operations FOR SELECT
 USING(current_setting('origen.purpose',true)='retention' AND expires_at<=now());
CREATE POLICY diagnostic_expiry_delete ON origen_diagnostic_operations FOR DELETE
 USING(current_setting('origen.purpose',true)='retention' AND expires_at<=now());

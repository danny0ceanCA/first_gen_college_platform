-- Additive: no existing user is grandfathered into the new eligibility gate.
CREATE TABLE origen_eligibility (
 subject_hash text PRIMARY KEY CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 age_band text NOT NULL CHECK(age_band IN ('under13','13to17','18plus')),
 audience text NOT NULL CHECK(audience IN ('grade9plus','adult_supporter','other')),
 status text NOT NULL CHECK(status IN ('blocked','adult','pending','approved','denied','revoked')),
 revision integer NOT NULL DEFAULT 1,
 notice_version text NOT NULL,
 request_id uuid,
 guardian_email text,
 approval_hash text UNIQUE,
 withdrawal_hash text UNIQUE,
 approval_expires_at timestamptz,
 permission_expires_at timestamptz,
 decided_at timestamptz,
 requested_at timestamptz,
 window_started_at timestamptz,
 request_count integer NOT NULL DEFAULT 0,
 delivery text NOT NULL DEFAULT 'disabled' CHECK(delivery IN ('disabled','mock','accepted','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE origen_permission_events (
 id uuid PRIMARY KEY,
 subject_hash text NOT NULL REFERENCES origen_eligibility(subject_hash) ON DELETE CASCADE,
 request_id uuid,
 notice_version text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('screened','requested','approved','denied','revoked')),
 occurred_at timestamptz NOT NULL
);
CREATE TABLE origen_permission_calls (
 call_id text PRIMARY KEY,
 subject_hash text NOT NULL,
 revision integer NOT NULL,
 expires_at timestamptz NOT NULL
);
ALTER TABLE origen_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_permission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_permission_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY eligibility_account ON origen_eligibility
 USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''))
 WITH CHECK(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY eligibility_guardian ON origen_eligibility FOR SELECT
 USING(approval_hash=nullif(current_setting('origen.guardian_hash',true),'') OR withdrawal_hash=nullif(current_setting('origen.guardian_hash',true),''));
CREATE POLICY eligibility_guardian_update ON origen_eligibility FOR UPDATE
 USING(approval_hash=nullif(current_setting('origen.guardian_hash',true),'') OR withdrawal_hash=nullif(current_setting('origen.guardian_hash',true),''))
 WITH CHECK(approval_hash=nullif(current_setting('origen.guardian_hash',true),'') OR withdrawal_hash=nullif(current_setting('origen.guardian_hash',true),''));
CREATE POLICY eligibility_job_read ON origen_eligibility FOR SELECT USING(current_setting('origen.purpose',true)='retention');
CREATE POLICY eligibility_job_scrub ON origen_eligibility FOR UPDATE USING(current_setting('origen.purpose',true)='retention') WITH CHECK(current_setting('origen.purpose',true)='retention');
CREATE POLICY permission_events_account ON origen_permission_events FOR SELECT USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY permission_events_insert ON origen_permission_events FOR INSERT WITH CHECK(
 subject_hash=nullif(current_setting('origen.subject_hash',true),'') OR EXISTS(SELECT 1 FROM origen_eligibility e WHERE e.subject_hash=origen_permission_events.subject_hash));
CREATE POLICY permission_events_delete ON origen_permission_events FOR DELETE USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY permission_events_job_expiry ON origen_permission_events FOR DELETE USING(current_setting('origen.purpose',true)='retention' AND occurred_at<now()-interval '365 days');
CREATE POLICY permission_calls_account ON origen_permission_calls
 USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''))
 WITH CHECK(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
CREATE POLICY permission_calls_job ON origen_permission_calls USING(current_setting('origen.purpose',true)='retention') WITH CHECK(false);
-- Guardian decisions serialize with all profile/history writes, even before an
-- account exists. This grants visibility only to the token's subject lock.
CREATE POLICY guardian_subject_lock ON origen_subject_locks FOR SELECT USING(
 EXISTS(SELECT 1 FROM origen_eligibility e WHERE e.subject_hash=origen_subject_locks.subject_hash AND
 (e.approval_hash=nullif(current_setting('origen.guardian_hash',true),'') OR e.withdrawal_hash=nullif(current_setting('origen.guardian_hash',true),''))));
CREATE POLICY guardian_subject_lock_update ON origen_subject_locks FOR UPDATE USING(
 EXISTS(SELECT 1 FROM origen_eligibility e WHERE e.subject_hash=origen_subject_locks.subject_hash AND
 (e.approval_hash=nullif(current_setting('origen.guardian_hash',true),'') OR e.withdrawal_hash=nullif(current_setting('origen.guardian_hash',true),''))));

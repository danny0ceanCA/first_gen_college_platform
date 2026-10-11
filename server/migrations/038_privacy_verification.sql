CREATE TABLE origen_privacy_events (
 id uuid PRIMARY KEY,
 actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('export_requested','export_prepared','access_denied')),
 area text NOT NULL CHECK(area IN ('account','privacy','family','history','voice','workspace','staff','institution')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_privacy_events_time ON origen_privacy_events(occurred_at);
CREATE INDEX origen_privacy_events_actor_time ON origen_privacy_events(actor_hash,occurred_at);
ALTER TABLE origen_privacy_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY privacy_event_insert ON origen_privacy_events FOR INSERT
 WITH CHECK(actor_hash=nullif(current_setting('origen.subject_hash',true),''));
-- No user, analytics or institution read policy. Operational jobs may inspect
-- metadata and remove expired events, but cannot mutate recent evidence.
CREATE POLICY privacy_event_job_read ON origen_privacy_events FOR SELECT
 USING(current_setting('origen.purpose',true)='retention');
CREATE POLICY privacy_event_expiry ON origen_privacy_events FOR DELETE
 USING(current_setting('origen.purpose',true)='retention' AND occurred_at<now()-interval '90 days');

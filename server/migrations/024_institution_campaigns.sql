CREATE TABLE origen_institution_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE, payload_hash text NOT NULL,
 title text NOT NULL, event_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 created_by text NOT NULL, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_campaign_scope ON origen_institution_campaigns(institution_id,created_at DESC);
ALTER TABLE origen_institution_inquiries ADD COLUMN campaign_id uuid REFERENCES origen_institution_campaigns(id) ON DELETE SET NULL;
CREATE TABLE origen_institution_outreach_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 campaign_id uuid NOT NULL REFERENCES origen_institution_campaigns(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE, payload_hash text NOT NULL, actor text NOT NULL,
 english text NOT NULL, spanish text NOT NULL, recipient_count integer NOT NULL CHECK(recipient_count BETWEEN 1 AND 25),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_outreach_budget ON origen_institution_outreach_batches(institution_id,created_at);
ALTER TABLE origen_institution_inquiry_messages ADD COLUMN outreach_batch_id uuid REFERENCES origen_institution_outreach_batches(id) ON DELETE SET NULL;
ALTER TABLE origen_institution_inquiry_messages ADD COLUMN purpose text NOT NULL DEFAULT 'request-reply' CHECK(purpose IN ('request-reply','future-outreach'));
CREATE UNIQUE INDEX origen_outreach_once ON origen_institution_inquiry_messages(outreach_batch_id,inquiry_id);
CREATE TABLE origen_institution_outreach_facts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid UNIQUE REFERENCES origen_institution_inquiries(id) ON DELETE SET NULL,
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 parent_id uuid REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 campaign_id uuid REFERENCES origen_institution_campaigns(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('inquiry','rsvp')), submitted_at timestamptz NOT NULL,
 first_response_at timestamptz
);
CREATE INDEX origen_outreach_cohort ON origen_institution_outreach_facts(institution_id,submitted_at);
CREATE TABLE origen_institution_outreach_states (
 id bigserial PRIMARY KEY, fact_id uuid NOT NULL REFERENCES origen_institution_outreach_facts(id) ON DELETE CASCADE,
 state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_outreach_state_history ON origen_institution_outreach_states(fact_id,created_at);
CREATE TABLE origen_institution_campaign_metrics (
 campaign_id uuid NOT NULL REFERENCES origen_institution_campaigns(id) ON DELETE CASCADE,
 month text NOT NULL, metric text NOT NULL CHECK(metric IN ('page_view','link_click')), count bigint NOT NULL CHECK(count>=0),
 PRIMARY KEY(campaign_id,month,metric)
);
CREATE TABLE origen_institution_outreach_collection (
 singleton integer PRIMARY KEY CHECK(singleton=1), started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO origen_institution_outreach_collection(singleton) VALUES(1);
-- Legacy inquiries deliberately remain outside phase-5 cohorts; their historical states are not known.

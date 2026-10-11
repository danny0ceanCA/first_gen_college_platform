-- Decisions contain technical references only, never conversation content.
CREATE TABLE origen_admin_issue_reviews (
 id bigserial PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 issue_key text NOT NULL CHECK (issue_key ~ '^[a-f0-9]{32}$'),
 evidence_revision text NOT NULL CHECK (evidence_revision ~ '^[a-f0-9]{32}$'),
 status text NOT NULL CHECK (status IN ('open','investigating','resolved')),
 reason text NOT NULL CHECK (reason IN ('reopened','investigating','recovery_observed','fix_verified','review_complete')),
 reviewer_hash text NOT NULL CHECK (reviewer_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_admin_issue_reviews_item ON origen_admin_issue_reviews(account_id,issue_key,id DESC);
CREATE INDEX origen_admin_issue_reviews_date ON origen_admin_issue_reviews(created_at);
CREATE INDEX origen_ai_summary_failures ON origen_ai_executions(finished_at,account_id) WHERE operation='summary' AND status='failed';

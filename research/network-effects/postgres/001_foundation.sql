-- Explicitly applied by the isolated Network Effect Architecture migrator.
-- No operational/voice tables, triggers, functions, or collection settings change.
CREATE SCHEMA IF NOT EXISTS origen_network_effects;
REVOKE ALL ON SCHEMA origen_network_effects FROM PUBLIC;
CREATE TABLE IF NOT EXISTS origen_network_effects.sources (
  id text PRIMARY KEY, version integer NOT NULL CHECK(version>0),
  account_id text NOT NULL, student_id text, body jsonb NOT NULL,
  fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_scope ON origen_network_effects.sources(account_id,student_id);
CREATE TABLE IF NOT EXISTS origen_network_effects.source_versions (
  source_id text NOT NULL REFERENCES origen_network_effects.sources(id) ON DELETE CASCADE,
  version integer NOT NULL, body jsonb NOT NULL, PRIMARY KEY(source_id,version)
);
CREATE TABLE IF NOT EXISTS origen_network_effects.tombstones (
  id text PRIMARY KEY, deleted_at timestamptz NOT NULL
);
-- No source text: unresolved deletion metadata must survive until older records
-- are backfilled. It cannot be coupled to a source FK or an existing episode.
CREATE TABLE IF NOT EXISTS origen_network_effects.processing_gaps (
  source_id text PRIMARY KEY, source_version integer NOT NULL,
  account_id text NOT NULL, student_id text, reporter text NOT NULL, recorded_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS processing_gaps_scope ON origen_network_effects.processing_gaps(account_id,student_id);
CREATE TABLE IF NOT EXISTS origen_network_effects.jobs (
  id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES origen_network_effects.sources(id) ON DELETE CASCADE,
  source_version integer NOT NULL, extractor_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','completed','failed','obsolete')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), error text,
  lease_token uuid, lease_until timestamptz, available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL, completed_at timestamptz, duration_ms integer,
  result_hash text, diagnostic jsonb, sequence bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE(source_id,source_version,extractor_version)
);
CREATE INDEX IF NOT EXISTS jobs_available ON origen_network_effects.jobs(status,available_at,sequence);
ALTER TABLE origen_network_effects.jobs ADD COLUMN IF NOT EXISTS diagnostic jsonb;
-- Every lease has its own evidence trail; retries never rewrite prior attempts.
-- Deleting a source cascades through its jobs and clears candidate/source content.
CREATE TABLE IF NOT EXISTS origen_network_effects.verification_audits (
  job_id uuid NOT NULL REFERENCES origen_network_effects.jobs(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL, attempt integer NOT NULL CHECK(attempt>0),
  audit jsonb NOT NULL, recorded_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY(job_id,lease_token), UNIQUE(job_id,attempt)
);
CREATE TABLE IF NOT EXISTS origen_network_effects.items (
  id text PRIMARY KEY, source_id text NOT NULL REFERENCES origen_network_effects.sources(id) ON DELETE CASCADE,
  source_version integer NOT NULL, episode_id text NOT NULL, body jsonb NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS items_source ON origen_network_effects.items(source_id);
CREATE INDEX IF NOT EXISTS items_episode ON origen_network_effects.items(episode_id);
CREATE TABLE IF NOT EXISTS origen_network_effects.supersessions (
  target_id text PRIMARY KEY, correction_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS origen_network_effects.invalidations (
  source_id text NOT NULL, episode_id text NOT NULL, kind text NOT NULL,
  source_version integer NOT NULL, reported_by text NOT NULL, evidence_at text,
  PRIMARY KEY(source_id,episode_id,kind,reported_by)
);
CREATE INDEX IF NOT EXISTS invalidations_episode ON origen_network_effects.invalidations(episode_id);
CREATE TABLE IF NOT EXISTS origen_network_effects.reviews (
  id uuid PRIMARY KEY, episode_id text NOT NULL, revision text NOT NULL,
  decision text NOT NULL CHECK(decision IN ('reviewed','needs-review')),
  note text NOT NULL CHECK(length(note)<=2000), actor_hash text NOT NULL,
  recorded_at timestamptz NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS reviews_episode ON origen_network_effects.reviews(episode_id,sequence);
-- A derived projection supports paginated admin reads without loading all families.
CREATE TABLE IF NOT EXISTS origen_network_effects.episodes (
  id text PRIMARY KEY, account_id text NOT NULL, student_id text,
  episode_key text NOT NULL, topic text NOT NULL, review_state text NOT NULL,
  languages text[] NOT NULL, pending boolean NOT NULL, body jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS episodes_scope ON origen_network_effects.episodes(account_id,student_id);
CREATE INDEX IF NOT EXISTS episodes_review ON origen_network_effects.episodes(review_state,topic,updated_at);
CREATE TABLE IF NOT EXISTS origen_network_effects.evaluations (
  id uuid PRIMARY KEY, fingerprint text NOT NULL, model text, status text NOT NULL,
  actor_hash text NOT NULL, report jsonb NOT NULL, created_at timestamptz NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS origen_network_effects.budgets (
  id text PRIMARY KEY, limit_micros bigint NOT NULL CHECK(limit_micros>=0), created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS origen_network_effects.budget_reservations (
  id text PRIMARY KEY, budget_id text NOT NULL REFERENCES origen_network_effects.budgets(id),
  reserved_micros bigint NOT NULL CHECK(reserved_micros>=0),
  charged_micros bigint NOT NULL CHECK(charged_micros>=0 AND charged_micros<=reserved_micros),
  settled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS budget_reservations_budget ON origen_network_effects.budget_reservations(budget_id);
REVOKE ALL ON ALL TABLES IN SCHEMA origen_network_effects FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA origen_network_effects FROM PUBLIC;

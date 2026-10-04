-- Minimal closure receipt prevents still-valid tokens or old imports recreating data.
CREATE TABLE origen_closed_accounts (
 subject_hash text PRIMARY KEY CHECK (length(subject_hash)=64),
 closed_at timestamptz NOT NULL DEFAULT now()
);

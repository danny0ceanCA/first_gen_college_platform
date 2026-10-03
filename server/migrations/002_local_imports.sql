-- A one-time receipt prevents old local copies resurrecting deleted profiles.
CREATE TABLE origen_local_imports (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 source text NOT NULL CHECK (source IN ('web', 'mobile')),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, source)
);

CREATE TABLE origen_history_imports (
 account_id uuid PRIMARY KEY REFERENCES origen_accounts(id) ON DELETE CASCADE,
 imported_at timestamptz NOT NULL DEFAULT now()
);

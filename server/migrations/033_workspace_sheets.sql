CREATE TABLE origen_workspace_sheets (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 student_id text,
 content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_workspace_sheets_scope ON origen_workspace_sheets(account_id,student_id,updated_at DESC);
-- Receipts retain only a digest, preventing a delayed create retry after deletion.
CREATE TABLE origen_workspace_sheet_receipts (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id)
);

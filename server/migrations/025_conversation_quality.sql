CREATE TABLE origen_conversation_quality (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 summary_id text NOT NULL,
 saved_summary_id text,
 mode text NOT NULL CHECK (mode IN ('profile','planning','finance','loans','admissions')),
 language text NOT NULL CHECK (language IN ('en','es')),
 conversation_at timestamptz NOT NULL,
 analyzed_at timestamptz NOT NULL DEFAULT now(),
 report jsonb NOT NULL,
 PRIMARY KEY (account_id,summary_id),
 FOREIGN KEY (account_id,saved_summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_conversation_quality_date ON origen_conversation_quality(conversation_at);

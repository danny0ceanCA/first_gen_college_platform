-- Private, user-controlled topic notes. A topic is not evidence of learning.
CREATE TABLE origen_topic_notes (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 student_id text,
 topic text NOT NULL CHECK (topic IN ('options','transfer','costs','applications')),
 kind text NOT NULL CHECK (kind IN ('note','explanation','question')),
 content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
 language text NOT NULL CHECK (language IN ('en','es')),
 status text NOT NULL CHECK (status IN ('suggested','saved')),
 origin text NOT NULL CHECK (origin IN ('user','conversation')),
 source_summary_id text,
 source_quote text NOT NULL DEFAULT '' CHECK (length(source_quote) <= 12000),
 translations jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id,id),
 FOREIGN KEY (account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,source_summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE,
 CHECK ((origin='user' AND source_summary_id IS NULL AND status='saved') OR (origin='conversation' AND source_summary_id IS NOT NULL))
);
CREATE INDEX origen_topic_notes_scope ON origen_topic_notes(account_id,student_id,topic,updated_at DESC);

-- Keep a receipt after a suggestion is dismissed, so it is not regenerated.
CREATE TABLE origen_topic_note_batches (
 account_id uuid NOT NULL,
 summary_id text NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,summary_id),
 FOREIGN KEY(account_id,summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE
);

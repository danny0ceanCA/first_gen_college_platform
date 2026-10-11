-- No conversation text. Reserve IDs before generation so deletion wins over late saves.
CREATE TABLE origen_conversation_lifecycle (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
 student_id text,
 mode text,
 deleted_at timestamptz,
 PRIMARY KEY (account_id,id)
);
CREATE INDEX origen_conversation_lifecycle_scope ON origen_conversation_lifecycle(account_id,student_id,mode);
INSERT INTO origen_conversation_lifecycle(account_id,id,student_id,mode)
 SELECT account_id,id,student_id,mode FROM origen_conversation_summaries;

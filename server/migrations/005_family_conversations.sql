-- NULL student_id is an account-private general family conversation.
ALTER TABLE origen_conversation_summaries ALTER COLUMN student_id DROP NOT NULL;

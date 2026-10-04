ALTER TABLE origen_conversation_summaries DROP CONSTRAINT origen_conversation_summaries_mode_check;
ALTER TABLE origen_conversation_summaries ADD CONSTRAINT origen_conversation_summaries_mode_check CHECK (mode IN ('profile', 'finance', 'admissions', 'planning', 'loans'));

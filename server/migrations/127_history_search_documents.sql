-- Avoid rebuilding three full-text vectors for every matched history row on
-- each voice refresh. Generated values follow edits/deletions transactionally;
-- existing account/student predicates and table RLS remain unchanged.
ALTER TABLE origen_conversation_summaries ADD COLUMN history_search_document tsvector
 GENERATED ALWAYS AS (to_tsvector('english',summary) || to_tsvector('spanish',summary) || to_tsvector('simple',summary)) STORED;
ALTER TABLE origen_student_memories ADD COLUMN history_search_document tsvector
 GENERATED ALWAYS AS (to_tsvector('english',content) || to_tsvector('spanish',content) || to_tsvector('simple',content)) STORED;
ALTER TABLE origen_topic_notes ADD COLUMN history_search_document tsvector
 GENERATED ALWAYS AS (to_tsvector('english',content) || to_tsvector('spanish',content) || to_tsvector('simple',content)) STORED;
CREATE INDEX origen_history_document_search ON origen_conversation_summaries USING gin(history_search_document);
CREATE INDEX origen_memory_document_search ON origen_student_memories USING gin(history_search_document) WHERE status IN ('proposed','confirmed');
CREATE INDEX origen_note_document_search ON origen_topic_notes USING gin(history_search_document) WHERE status='saved';

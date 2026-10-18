-- Native, transactional indexes over existing saved text. No transcript copy,
-- embedding worker, extension, or cross-account search function is introduced.
-- English + Spanish stemming and simple lexemes preserve names/acronyms.
CREATE INDEX origen_history_search ON origen_conversation_summaries USING gin
 ((to_tsvector('english',summary) || to_tsvector('spanish',summary) || to_tsvector('simple',summary)));
CREATE INDEX origen_memory_search ON origen_student_memories USING gin
 ((to_tsvector('english',content) || to_tsvector('spanish',content) || to_tsvector('simple',content)))
 WHERE status IN ('proposed','confirmed');
CREATE INDEX origen_note_search ON origen_topic_notes USING gin
 ((to_tsvector('english',content) || to_tsvector('spanish',content) || to_tsvector('simple',content)))
 WHERE status='saved';

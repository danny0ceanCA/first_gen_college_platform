-- Reuse the existing account revision for prepared voice context. No new
-- content store: changes to bounded question metadata invalidate preparations.
CREATE TRIGGER voice_context_changed AFTER INSERT OR UPDATE OR DELETE ON origen_guidance_questions
 FOR EACH ROW EXECUTE FUNCTION origen_voice_context_changed();

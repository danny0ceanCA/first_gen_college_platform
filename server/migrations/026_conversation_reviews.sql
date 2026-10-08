ALTER TABLE origen_conversation_quality ADD COLUMN review_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE origen_conversation_quality ADD COLUMN reviews jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX origen_conversation_quality_review_id ON origen_conversation_quality(review_id);

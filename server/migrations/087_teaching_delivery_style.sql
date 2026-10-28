-- Existing JSON documents remain valid; style is optional and follows the same
-- draft/review/publish/revision lifecycle as the teaching explanation.
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_draft_delivery_style CHECK (
 NOT (draft ? 'deliveryStyle') OR
 (jsonb_typeof(draft->'deliveryStyle')='string' AND length(draft->>'deliveryStyle')<=1500)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_published_delivery_style CHECK (
 published IS NULL OR NOT (published ? 'deliveryStyle') OR
 (jsonb_typeof(published->'deliveryStyle')='string' AND length(published->>'deliveryStyle')<=1500)
);

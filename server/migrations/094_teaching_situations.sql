-- Optional educator-authored selection guidance. Preserve existing publications and review history.
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_draft_concern CHECK (
 draft IS NULL OR NOT (draft ? 'concern') OR
 (jsonb_typeof(draft->'concern')='string' AND length(draft->>'concern')<=1000)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_published_concern CHECK (
 published IS NULL OR NOT (published ? 'concern') OR
 (jsonb_typeof(published->'concern')='string' AND length(published->>'concern')<=1000)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_draft_usewhen CHECK (
 draft IS NULL OR NOT (draft ? 'useWhen') OR
 (jsonb_typeof(draft->'useWhen')='string' AND length(draft->>'useWhen')<=1000)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_published_usewhen CHECK (
 published IS NULL OR NOT (published ? 'useWhen') OR
 (jsonb_typeof(published->'useWhen')='string' AND length(published->>'useWhen')<=1000)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_draft_skipfollowup CHECK (
 draft IS NULL OR NOT (draft ? 'skipFollowUp') OR
 (jsonb_typeof(draft->'skipFollowUp')='string' AND length(draft->>'skipFollowUp')<=1000)
);
ALTER TABLE origen_teachings ADD CONSTRAINT origen_teaching_published_skipfollowup CHECK (
 published IS NULL OR NOT (published ? 'skipFollowUp') OR
 (jsonb_typeof(published->'skipFollowUp')='string' AND length(published->>'skipFollowUp')<=1000)
);

-- Ranking is a lexical hint, not evidence of a misunderstanding or teaching application.
-- Voice has no new spoken question at session start. Load bounded guide references
-- without treating discovery keywords as a gate. Research retains question matching.
-- Preserve publication, review date, language, campus, year and actor restrictions.
CREATE OR REPLACE FUNCTION origen_read_teachings(input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 IF nullif(current_setting('origen.subject',true),'') IS NULL OR coalesce(current_setting('origen.purpose',true),'') NOT IN ('account','analytics')
 THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.published_revision,'content',t.published)),'[]') INTO result
 FROM (SELECT *, (
   SELECT count(DISTINCT word) FROM regexp_split_to_table(lower(left(coalesce(input->>'query',''),3000)), '[^[:alnum:]]+') word
   WHERE length(word)>=4 AND word NOT IN ('that','this','with','have','what','about','would','could','student','students','para','como','esta','esto','tengo','quiero','sobre','puedo','pero')
   AND strpos(lower(coalesce(published->>'concern','')||' '||coalesce(published->>'useWhen','')||' '||coalesce(published->>'keywords','')),word)>0
  ) AS situation_matches FROM origen_teachings WHERE NOT archived AND published IS NOT NULL
  AND (published->>'reviewBy')::date>=current_date
  AND published->>'language'=input->>'language'
  AND published->>'topic' IN ('general',input->>'topic')
  AND (coalesce(published->>'campus','')='' OR lower(published->>'campus')=lower(input->>'campus'))
  AND (coalesce(published->>'academicYear','')='' OR published->>'academicYear'=input->>'academicYear')
  AND (input->>'retrieval'='guide' OR coalesce(published->>'keywords','')='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(published->>'keywords',',') word WHERE length(trim(word))>1 AND strpos(regexp_replace(lower(coalesce(input->>'query','')),'[''’]','','g'),regexp_replace(lower(trim(word)),'[''’]','','g'))>0))
  ORDER BY situation_matches DESC,(coalesce(published->>'campus','')<>'') DESC,(published->>'topic'=input->>'topic') DESC,published_at DESC,id LIMIT 6) t;
 RETURN result;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_read_teachings(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_read_teachings(jsonb) FROM PUBLIC;

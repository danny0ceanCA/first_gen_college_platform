-- Voice has no new spoken question at session start. Load bounded guide references
-- without treating discovery keywords as a gate. Research retains question matching.
-- Preserve publication, review date, language, campus, year and actor restrictions.
CREATE OR REPLACE FUNCTION origen_read_teachings(input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 IF nullif(current_setting('origen.subject',true),'') IS NULL OR coalesce(current_setting('origen.purpose',true),'') NOT IN ('account','analytics')
 THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.published_revision,'content',t.published)),'[]') INTO result
 FROM (SELECT * FROM origen_teachings WHERE NOT archived AND published IS NOT NULL
  AND (published->>'reviewBy')::date>=current_date
  AND published->>'language'=input->>'language'
  AND published->>'topic' IN ('general',input->>'topic')
  AND (coalesce(published->>'campus','')='' OR lower(published->>'campus')=lower(input->>'campus'))
  AND (coalesce(published->>'academicYear','')='' OR published->>'academicYear'=input->>'academicYear')
  AND (input->>'retrieval'='guide' OR coalesce(published->>'keywords','')='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(published->>'keywords',',') word WHERE length(trim(word))>1 AND strpos(regexp_replace(lower(coalesce(input->>'query','')),'[''’]','','g'),regexp_replace(lower(trim(word)),'[''’]','','g'))>0))
  ORDER BY (coalesce(published->>'campus','')<>'') DESC,(published->>'topic'=input->>'topic') DESC,published_at DESC,id LIMIT 6) t;
 RETURN result;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_read_teachings(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_read_teachings(jsonb) FROM PUBLIC;

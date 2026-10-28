-- Global, admin-reviewed teaching material; never student or family records.
CREATE TABLE origen_teachings (
 id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'),
 published jsonb,
 published_revision integer,
 archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 CHECK((published IS NULL)=(published_revision IS NULL))
);
CREATE TABLE origen_teaching_revisions (
 id uuid NOT NULL REFERENCES origen_teachings(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 action text NOT NULL CHECK(action IN ('save','publish','unpublish','archive','restore')),
 content jsonb NOT NULL,
 actor_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(id,revision)
);
ALTER TABLE origen_teachings ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_teaching_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_teachings,origen_teaching_revisions FROM PUBLIC;

CREATE FUNCTION origen_teaching_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 item origen_teachings; doc jsonb:=input->'content'; result jsonb; expected integer;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'analytics'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND blocked)
 THEN RAISE EXCEPTION 'teaching_access_denied' USING ERRCODE='42501'; END IF;
 IF action='list' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC,t.id),'[]') INTO result
  FROM (SELECT * FROM origen_teachings WHERE archived=coalesce((input->>'archived')::boolean,false)
   AND (coalesce(input->>'search','')='' OR strpos(lower(draft->>'title'),lower(input->>'search'))>0)
   ORDER BY updated_at DESC,id LIMIT 100) t;
  RETURN jsonb_build_object('items',result);
 END IF;
 IF action='history' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',history.revision,'action',history.action,'createdAt',history.created_at) ORDER BY history.revision DESC),'[]') INTO result
  FROM (SELECT r.revision,r.action,r.created_at FROM origen_teaching_revisions r WHERE r.id=(input->>'id')::uuid ORDER BY revision DESC LIMIT 25) history;
  RETURN jsonb_build_object('history',result);
 END IF;
 IF action NOT IN ('save','publish','unpublish','archive','restore') THEN RAISE EXCEPTION 'invalid_teaching_request' USING ERRCODE='22023'; END IF;
 expected:=(input->>'revision')::integer;
 IF expected IS NULL OR expected<0 THEN RAISE EXCEPTION 'invalid_teaching_request' USING ERRCODE='22023'; END IF;
 -- Serialize concurrent creation and changes for this ID, including retries.
 PERFORM pg_advisory_xact_lock(hashtextextended('teaching:'||(input->>'id'),0));
 SELECT * INTO item FROM origen_teachings WHERE id=(input->>'id')::uuid FOR UPDATE;
 IF action='save' THEN
  IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR octet_length(doc::text)>24000
   OR length(trim(coalesce(doc->>'title',''))) NOT BETWEEN 1 AND 120
   OR length(trim(coalesce(doc->>'explanation',''))) NOT BETWEEN 1 AND 6000
   OR coalesce(doc->>'topic','') NOT IN ('general','profile','planning','finance','loans','admissions')
   OR coalesce(doc->>'language','') NOT IN ('en','es')
   OR length(coalesce(doc->>'campus',''))>160 OR length(coalesce(doc->>'keywords',''))>300
   OR length(coalesce(doc->>'example',''))>3000 OR length(coalesce(doc->>'followUp',''))>1000
   OR length(coalesce(doc->>'referral',''))>1000 OR length(coalesce(doc->>'sourceUrl',''))>2000
   OR (coalesce(doc->>'academicYear','')<>'' AND (doc->>'academicYear') !~ '^[0-9]{4}-[0-9]{2}$')
   OR (coalesce(doc->>'reviewBy','')<>'' AND (doc->>'reviewBy') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  THEN RAISE EXCEPTION 'invalid_teaching_request' USING ERRCODE='22023'; END IF;
  IF item.id IS NULL THEN
   IF expected<>0 THEN RAISE EXCEPTION 'teaching_changed' USING ERRCODE='40001'; END IF;
   INSERT INTO origen_teachings(id,draft) VALUES((input->>'id')::uuid,doc) RETURNING * INTO item;
  ELSE
   IF item.archived THEN RAISE EXCEPTION 'teaching_archived' USING ERRCODE='22023'; END IF;
   IF item.draft=doc AND item.revision IN (expected,expected+1) THEN RETURN jsonb_build_object('item',to_jsonb(item)); END IF;
   IF item.revision<>expected THEN RAISE EXCEPTION 'teaching_changed' USING ERRCODE='40001'; END IF;
   UPDATE origen_teachings SET draft=doc,revision=revision+1,updated_at=now() WHERE id=item.id RETURNING * INTO item;
  END IF;
 ELSE
  IF item.id IS NULL OR item.revision<>expected THEN RAISE EXCEPTION 'teaching_changed' USING ERRCODE='40001'; END IF;
  IF action='publish' THEN
   IF item.archived OR coalesce(item.draft->>'reviewBy','')='' OR (item.draft->>'reviewBy')::date<current_date
    OR (coalesce(item.draft->>'campus','')<>'' AND (coalesce(item.draft->>'sourceUrl','')='' OR coalesce(item.draft->>'academicYear','')=''))
   THEN RAISE EXCEPTION 'teaching_publish_requirements' USING ERRCODE='22023'; END IF;
   UPDATE origen_teachings SET published=draft,published_revision=revision+1,revision=revision+1,published_at=now(),updated_at=now() WHERE id=item.id RETURNING * INTO item;
  ELSIF action='unpublish' OR action='archive' THEN
   UPDATE origen_teachings SET published=NULL,published_revision=NULL,archived=(action='archive'),revision=revision+1,updated_at=now() WHERE id=item.id RETURNING * INTO item;
  ELSE
   UPDATE origen_teachings SET archived=false,revision=revision+1,updated_at=now() WHERE id=item.id RETURNING * INTO item;
  END IF;
 END IF;
 INSERT INTO origen_teaching_revisions(id,revision,action,content,actor_hash) VALUES(item.id,item.revision,action,item.draft,encode(sha256(convert_to(actor,'UTF8')),'hex'));
 RETURN jsonb_build_object('item',to_jsonb(item));
END $$;

CREATE FUNCTION origen_read_teachings(input jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
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
  AND (coalesce(published->>'keywords','')='' OR EXISTS(SELECT 1 FROM regexp_split_to_table(published->>'keywords',',') word WHERE length(trim(word))>1 AND strpos(lower(coalesce(input->>'query','')),lower(trim(word)))>0))
  ORDER BY (coalesce(published->>'campus','')<>'') DESC,published_at DESC,id LIMIT 6) t;
 RETURN result;
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_teaching_command(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION origen_read_teachings(jsonb) SET search_path TO pg_catalog,%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_teaching_command(jsonb),origen_read_teachings(jsonb) FROM PUBLIC;

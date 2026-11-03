-- Independently authored public guidance, not copies of student/coordinator cases.
-- Publication authority is operator provisioned and separate from reply access.
CREATE TABLE origen_recommendation_library_capabilities (
 subject_hash text PRIMARY KEY CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 can_author boolean NOT NULL, can_publish boolean NOT NULL,
 processes text[] NOT NULL CHECK(cardinality(processes)>0 AND processes <@ ARRAY['office_contact','aid_documents','insurance_waiver']),
 expires_at timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE origen_recommendation_templates (
 teaching_id uuid PRIMARY KEY REFERENCES origen_teachings(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0), draft jsonb NOT NULL,
 published jsonb, published_revision integer, teaching_revision integer,
 publisher_hash text, publisher_revision integer, published_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE origen_recommendation_template_revisions (
 teaching_id uuid REFERENCES origen_recommendation_templates(teaching_id) ON DELETE CASCADE,
 revision integer NOT NULL, action text NOT NULL CHECK(action IN ('save','publish','revoke','restore')),
 content jsonb NOT NULL, actor_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(teaching_id,revision)
);
ALTER TABLE origen_recommendation_library_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_recommendation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_recommendation_template_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_recommendation_library_capabilities,origen_recommendation_templates,origen_recommendation_template_revisions FROM PUBLIC;

CREATE FUNCTION origen_action_template_date(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN value ~ '^\d{4}-\d{2}-\d{2}$' AND to_char(value::date,'YYYY-MM-DD')=value;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
CREATE FUNCTION origen_action_template_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE pair jsonb; s jsonb; k text; permitted text[]; host text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& ARRAY['version','mode','action','explanation','goal','process','prerequisites','exclusions','campus','term','sources','reviewedOn','reviewBy'])
  OR v-ARRAY['version','mode','action','explanation','goal','process','prerequisites','exclusions','campus','term','sources','reviewedOn','reviewBy']<>'{}'
  OR v->'version' IS DISTINCT FROM '1'::jsonb OR coalesce(v->>'mode','') NOT IN ('general_question','institution_requirement')
  OR coalesce(v->>'goal','') NOT IN ('understand_requirement','prepare_document','submit_document','check_decision')
  OR coalesce(v->>'process','') NOT IN ('office_contact','aid_documents','insurance_waiver') OR octet_length(v::text)>26000 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['action','explanation'] LOOP
  pair:=v->k;
  IF jsonb_typeof(pair) IS DISTINCT FROM 'object' OR NOT(pair ?& ARRAY['en','es']) OR pair-ARRAY['en','es']<>'{}'
   OR EXISTS(SELECT 1 FROM jsonb_each(pair) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR length(e.value#>>'{}') NOT BETWEEN 1 AND CASE k WHEN 'action' THEN 500 ELSE 1000 END
    OR e.value#>>'{}'<>btrim(e.value#>>'{}') OR e.value#>>'{}' ~ '[[:cntrl:]]') THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['prerequisites','exclusions'] LOOP
  permitted:=CASE k WHEN 'prerequisites' THEN ARRAY['campus_confirmed','term_confirmed','current_official_requirement','document_requested','document_prepared','submission_reported','decision_pending']
   ELSE ARRAY['already_completed','declined','deferred','conflicting_evidence','expired_requirement','decision_received'] END;
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'array' OR jsonb_array_length(v->k)>12
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->k) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR NOT(e#>>'{}'=ANY(permitted)))
   OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(v->k) e)<>jsonb_array_length(v->k) THEN RETURN false; END IF;
 END LOOP;
 IF NOT(v->'exclusions' @> '["already_completed","declined","deferred","conflicting_evidence","expired_requirement"]')
  OR jsonb_typeof(v->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'sources')>8 THEN RETURN false; END IF;
 IF v->>'mode'='general_question' THEN
  IF v->'campus' IS DISTINCT FROM 'null'::jsonb OR v->'term' IS DISTINCT FROM 'null'::jsonb OR v->'sources'<>'[]' THEN RETURN false; END IF;
 ELSE
  IF jsonb_typeof(v->'campus') IS DISTINCT FROM 'object' OR NOT(v->'campus' ?& ARRAY['name','officialHost']) OR (v->'campus')-ARRAY['name','officialHost']<>'{}'
   OR jsonb_typeof(v->'campus'->'name') IS DISTINCT FROM 'string' OR length(v->'campus'->>'name') NOT BETWEEN 1 AND 160
   OR v->'campus'->>'name'<>btrim(v->'campus'->>'name') OR v->'campus'->>'name' ~ '[[:cntrl:]]'
   OR jsonb_typeof(v->'campus'->'officialHost') IS DISTINCT FROM 'string' OR length(v->'campus'->>'officialHost')>253
   OR v->'campus'->>'officialHost' !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+(edu|gov)$'
   OR jsonb_typeof(v->'term') IS DISTINCT FROM 'string' OR length(v->>'term') NOT BETWEEN 1 AND 80 OR v->>'term'<>btrim(v->>'term') OR v->>'term' ~ '[[:cntrl:]]'
   OR jsonb_array_length(v->'sources')=0 OR NOT(v->'prerequisites' @> '["campus_confirmed","term_confirmed","current_official_requirement"]') THEN RETURN false; END IF;
 END IF;
 IF jsonb_typeof(v->'reviewedOn') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'reviewBy') IS DISTINCT FROM 'string'
  OR NOT origen_action_template_date(v->>'reviewedOn') OR NOT origen_action_template_date(v->>'reviewBy')
  OR (v->>'reviewBy')::date-(v->>'reviewedOn')::date NOT BETWEEN 0 AND 366 THEN RETURN false; END IF;
 FOR s IN SELECT * FROM jsonb_array_elements(v->'sources') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['id','url','claim','checkedOn','reviewBy']) OR s-ARRAY['id','url','claim','checkedOn','reviewBy']<>'{}'
   OR jsonb_typeof(s->'id') IS DISTINCT FROM 'string' OR s->>'id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   OR jsonb_typeof(s->'url') IS DISTINCT FROM 'string' OR length(s->>'url')>2000 OR s->>'url' ~ '[[:space:][:cntrl:]]'
   OR s->>'url' !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+(edu|gov)([/?#]|$)' THEN RETURN false; END IF;
  host:=split_part(substring(s->>'url' FROM '^https://([^/?#]+)'),':',1);
  IF host<>v->'campus'->>'officialHost' AND right(host,length(v->'campus'->>'officialHost')+1)<>'.'||(v->'campus'->>'officialHost') THEN RETURN false; END IF;
  pair:=s->'claim';
  IF jsonb_typeof(pair) IS DISTINCT FROM 'object' OR NOT(pair ?& ARRAY['en','es']) OR pair-ARRAY['en','es']<>'{}'
   OR EXISTS(SELECT 1 FROM jsonb_each(pair) e WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR length(e.value#>>'{}') NOT BETWEEN 1 AND 1000 OR e.value#>>'{}'<>btrim(e.value#>>'{}') OR e.value#>>'{}' ~ '[[:cntrl:]]')
   OR jsonb_typeof(s->'checkedOn') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'reviewBy') IS DISTINCT FROM 'string'
   OR NOT origen_action_template_date(s->>'checkedOn') OR NOT origen_action_template_date(s->>'reviewBy')
   OR (s->>'checkedOn')::date>(v->>'reviewedOn')::date OR (s->>'reviewBy')::date<(v->>'reviewBy')::date
   OR (s->>'reviewBy')::date-(s->>'checkedOn')::date NOT BETWEEN 0 AND 366 THEN RETURN false; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT source_item->>'id') FROM jsonb_array_elements(v->'sources') source_item)<>jsonb_array_length(v->'sources') THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE origen_recommendation_templates ADD CHECK(origen_action_template_valid(draft)), ADD CHECK(published IS NULL OR origen_action_template_valid(published));

-- Operator-only; each change invalidates publications under the old grant.
CREATE FUNCTION origen_recommendation_library_grant(subject text,author boolean,publisher boolean,processes text[],expiry timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE hash text:=encode(sha256(convert_to(subject,'UTF8')),'hex');
BEGIN
 IF subject IS NULL OR length(subject) NOT BETWEEN 1 AND 255 OR author IS NULL OR publisher IS NULL OR processes IS NULL OR cardinality(processes)=0
  OR NOT(processes <@ ARRAY['office_contact','aid_documents','insurance_waiver']) OR expiry>clock_timestamp()+interval '90 days' THEN RAISE EXCEPTION 'invalid_library_grant'; END IF;
 INSERT INTO origen_recommendation_library_capabilities VALUES(hash,author,publisher,processes,coalesce(expiry,clock_timestamp()-interval '1 second'),1)
 ON CONFLICT(subject_hash) DO UPDATE SET can_author=excluded.can_author,can_publish=excluded.can_publish,processes=excluded.processes,expires_at=excluded.expires_at,revision=origen_recommendation_library_capabilities.revision+1;
END $$;

CREATE FUNCTION origen_recommendation_template_current(id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r origen_recommendation_templates%ROWTYPE; t origen_teachings%ROWTYPE; c origen_recommendation_library_capabilities%ROWTYPE;
BEGIN
 SELECT * INTO r FROM origen_recommendation_templates WHERE teaching_id=id;
 IF r.published IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO t FROM origen_teachings WHERE origen_teachings.id=r.teaching_id;
 SELECT * INTO c FROM origen_recommendation_library_capabilities WHERE subject_hash=r.publisher_hash;
 IF t.published IS NULL OR t.archived OR t.published_revision<>r.teaching_revision OR coalesce(t.published->>'reviewBy','')<((clock_timestamp() AT TIME ZONE 'UTC')::date)::text
  OR NOT coalesce(c.can_publish,false) OR c.expires_at<=clock_timestamp() OR c.revision<>r.publisher_revision OR NOT(r.published->>'process'=ANY(c.processes))
  OR r.published->>'reviewedOn'>((clock_timestamp() AT TIME ZONE 'UTC')::date)::text OR r.published->>'reviewBy'<((clock_timestamp() AT TIME ZONE 'UTC')::date)::text
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=r.publisher_hash AND blocked) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('source',jsonb_build_object('kind','reviewed-template','teachingId',id,'revision',r.published_revision),
  'sourceRevision',encode(sha256(convert_to(jsonb_build_array(r.published_revision,r.teaching_revision,r.publisher_revision,r.published_at)::text,'UTF8')),'hex'),
  'content',r.published,'teachingRevision',r.teaching_revision,'applicability','not_verified','requiresOfficialLookup',r.published->>'mode'='institution_requirement',
  'authority',jsonb_build_object('canRecommend',false,'canAccept',false,'canPublish',false,'canEvaluate',false));
END $$;

CREATE FUNCTION origen_recommendation_library_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); hash text; id uuid; action text:=input->>'action'; keys text[];
 c origen_recommendation_library_capabilities%ROWTYPE; r origen_recommendation_templates%ROWTYPE; t origen_teachings%ROWTYPE;
 digest text; current jsonb; content jsonb:=input->'content';
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'analytics' THEN RETURN '{"error":"action_library_denied"}'; END IF;
 hash:=encode(sha256(convert_to(actor,'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=hash AND blocked) THEN RETURN '{"error":"action_library_denied"}'; END IF;
 SELECT * INTO c FROM origen_recommendation_library_capabilities WHERE subject_hash=hash AND expires_at>clock_timestamp() FOR SHARE;
 keys:=CASE action WHEN 'get' THEN ARRAY['action','id'] WHEN 'history' THEN ARRAY['action','id']
  WHEN 'save' THEN ARRAY['action','id','revision','content'] WHEN 'preview' THEN ARRAY['action','id','revision']
  WHEN 'publish' THEN ARRAY['action','id','revision','preview','review'] WHEN 'revoke' THEN ARRAY['action','id','revision'] END;
 IF keys IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT(input ?& keys) OR input-keys<>'{}'
  OR jsonb_typeof(input->'id') IS DISTINCT FROM 'string' OR input->>'id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 id:=(input->>'id')::uuid;
 IF action NOT IN ('get','history') AND (jsonb_typeof(input->'revision') IS DISTINCT FROM 'number' OR input->>'revision' !~ '^(0|[1-9][0-9]*)$' OR (input->>'revision')::numeric>2147483646) THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 -- Lock in the same order as the original teaching command. Pin publication
 -- to the teaching actually reviewed, including changes during a preview.
 PERFORM pg_advisory_xact_lock(hashtextextended('teaching:'||id,0));
 SELECT * INTO t FROM origen_teachings WHERE origen_teachings.id=(input->>'id')::uuid FOR UPDATE;
 IF t.id IS NULL THEN RETURN '{"error":"action_teaching_required"}'; END IF;
 SELECT * INTO r FROM origen_recommendation_templates WHERE teaching_id=id FOR UPDATE;
 IF action='get' THEN
  RETURN jsonb_build_object('item',CASE WHEN r.teaching_id IS NULL THEN NULL ELSE to_jsonb(r)-ARRAY['publisher_hash','publisher_revision'] END,
   'capabilities',jsonb_build_object('canAuthor',coalesce(c.can_author,false),'canPublish',coalesce(c.can_publish,false),'processes',coalesce(c.processes,ARRAY[]::text[])),
   'current',origen_recommendation_template_current(id) IS NOT NULL);
 END IF;
 IF c.subject_hash IS NULL THEN RETURN '{"error":"action_library_denied"}'; END IF;
 IF action='history' THEN
  IF r.teaching_id IS NOT NULL AND NOT(r.draft->>'process'=ANY(c.processes)) THEN RETURN '{"error":"action_library_denied"}'; END IF;
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(x) FROM (SELECT h.revision,h.action,h.created_at FROM origen_recommendation_template_revisions h WHERE h.teaching_id=id ORDER BY h.revision DESC LIMIT 30) x),'[]'::jsonb));
 END IF;
 IF action='save' AND NOT origen_action_template_valid(content) THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 IF (action='save' AND (NOT c.can_author OR NOT(content->>'process'=ANY(c.processes))))
  OR (r.teaching_id IS NOT NULL AND NOT(r.draft->>'process'=ANY(c.processes)))
  OR (action IN ('publish','revoke') AND r.published IS NOT NULL AND NOT(r.published->>'process'=ANY(c.processes)))
  OR (action IN ('publish','revoke') AND NOT c.can_publish) THEN RETURN '{"error":"action_library_denied"}'; END IF;
 IF t.archived AND action<>'revoke' THEN RETURN '{"error":"action_teaching_required"}'; END IF;
 IF action='save' AND r.draft=content AND (r.revision=(input->>'revision')::integer OR (r.revision=(input->>'revision')::integer+1 AND EXISTS(SELECT 1 FROM origen_recommendation_template_revisions h WHERE h.teaching_id=id AND h.revision=r.revision AND h.action='save'))) THEN
  RETURN origen_recommendation_library_command(jsonb_build_object('action','get','id',id));
 END IF;
 IF coalesce(r.revision,0)<>(input->>'revision')::integer THEN RETURN '{"error":"action_template_changed"}'; END IF;
 IF action<>'save' AND r.teaching_id IS NULL THEN RETURN '{"error":"action_teaching_required"}'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(id,r.revision,r.draft,t.published_revision)::text,'UTF8')),'hex');
 IF action='preview' THEN RETURN jsonb_build_object('preview',digest,'content',r.draft,'teachingRevision',t.published_revision); END IF;
 IF action='publish' THEN
  IF input->'review' IS DISTINCT FROM '{"independentlyAuthored":true,"bilingual":true,"sourcesAndScope":true}'::jsonb THEN RETURN '{"error":"action_review_required"}'; END IF;
  IF input->>'preview' IS DISTINCT FROM digest THEN RETURN '{"error":"action_template_changed"}'; END IF;
  IF t.published IS NULL OR t.archived OR coalesce(t.published->>'reviewBy','')<((clock_timestamp() AT TIME ZONE 'UTC')::date)::text
   OR r.draft->>'reviewedOn'>((clock_timestamp() AT TIME ZONE 'UTC')::date)::text OR r.draft->>'reviewBy'<((clock_timestamp() AT TIME ZONE 'UTC')::date)::text THEN RETURN '{"error":"action_publish_requirements"}'; END IF;
  UPDATE origen_recommendation_templates SET revision=revision+1,published=draft,published_revision=revision+1,teaching_revision=t.published_revision,
   publisher_hash=hash,publisher_revision=c.revision,published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE teaching_id=id RETURNING * INTO r;
 ELSIF action='revoke' THEN
  -- Require scope over the live publication too, not just a replacement draft.
  IF r.published IS NOT NULL AND NOT(r.published->>'process'=ANY(c.processes)) THEN RETURN '{"error":"action_library_denied"}'; END IF;
  UPDATE origen_recommendation_templates SET revision=revision+1,published=NULL,published_revision=NULL,teaching_revision=NULL,publisher_hash=NULL,publisher_revision=NULL,published_at=NULL,updated_at=clock_timestamp() WHERE teaching_id=id RETURNING * INTO r;
 ELSE
  INSERT INTO origen_recommendation_templates(teaching_id,revision,draft) VALUES(id,1,content)
   ON CONFLICT(teaching_id) DO UPDATE SET revision=origen_recommendation_templates.revision+1,draft=excluded.draft,updated_at=clock_timestamp() RETURNING * INTO r;
 END IF;
 INSERT INTO origen_recommendation_template_revisions(teaching_id,revision,action,content,actor_hash) VALUES(id,r.revision,action,r.draft,hash);
 RETURN origen_recommendation_library_command(jsonb_build_object('action','get','id',id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_action_template"}';
END $$;

-- Internal retrieval only: exact campus labels are a search selector, not proof
-- of attendance, eligibility or policy applicability. No student endpoint/tool.
CREATE FUNCTION origen_recommendation_catalog_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; entries jsonb;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"recommendation_denied"}'; END IF;
 IF coalesce(current_setting('origen.recommendations',true),'false')<>'true' THEN RETURN '{"error":"recommendation_paused"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT(input ?& ARRAY['studentId','process','campus','term']) OR input-ARRAY['studentId','process','campus','term']<>'{}'
  OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(input->>'studentId') NOT BETWEEN 1 AND 128 OR input->>'studentId'<>btrim(input->>'studentId') OR input->>'studentId' ~ '[[:cntrl:]]'
  OR coalesce(input->>'process','') NOT IN ('office_contact','aid_documents','insurance_waiver') THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 IF input->'campus'='null'::jsonb THEN
  IF input->'term'<>'null'::jsonb THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 ELSIF jsonb_typeof(input->'campus') IS DISTINCT FROM 'object' OR NOT(input->'campus' ?& ARRAY['name','officialHost']) OR (input->'campus')-ARRAY['name','officialHost']<>'{}'
  OR jsonb_typeof(input->'campus'->'name') IS DISTINCT FROM 'string' OR length(input->'campus'->>'name') NOT BETWEEN 1 AND 160
  OR jsonb_typeof(input->'campus'->'officialHost') IS DISTINCT FROM 'string' OR length(input->'campus'->>'officialHost')>253
  OR input->'campus'->>'officialHost' !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+(edu|gov)$'
  OR jsonb_typeof(input->'term') IS DISTINCT FROM 'string' OR length(input->>'term') NOT BETWEEN 1 AND 80 THEN RETURN '{"error":"invalid_action_template"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor;
 IF owner IS NULL OR NOT origen_coordinator_student_ready(owner,input->>'studentId') THEN RETURN '{"status":"unavailable","entries":[]}'; END IF;
 WITH selected AS MATERIALIZED (
  SELECT origen_recommendation_template_current(teaching_id) AS entry FROM origen_recommendation_templates
  WHERE published->>'process'=input->>'process' AND (published->>'mode'='general_question' OR (published->'campus'=input->'campus' AND published->'term'=input->'term'))
 ), bounded AS (SELECT entry FROM selected WHERE entry IS NOT NULL ORDER BY entry->'source'->>'teachingId' LIMIT 51)
 SELECT coalesce(jsonb_agg(entry),'[]'::jsonb) INTO entries FROM bounded;
 IF jsonb_array_length(entries)>50 THEN RETURN '{"status":"unavailable","reason":"catalog_limit","entries":[]}'; END IF;
 RETURN jsonb_build_object('status','reviewed','eligibility','not_assessed','entries',entries);
END $$;

ALTER FUNCTION origen_recommendation_source_command(jsonb) RENAME TO origen_recommendation_source_v1;
CREATE FUNCTION origen_recommendation_source_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb; entry jsonb; actor text:=nullif(current_setting('origen.subject',true),''); owner uuid;
BEGIN
 result:=origen_recommendation_source_v1(input);
 IF input->'source'->>'kind' IS DISTINCT FROM 'reviewed-template' OR result ? 'error' THEN RETURN result; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor;
 IF owner IS NULL OR NOT origen_coordinator_student_ready(owner,input->>'studentId') THEN RETURN '{"status":"unavailable"}'; END IF;
 entry:=origen_recommendation_template_current((input->'source'->>'teachingId')::uuid);
 -- Scoped policies need verified context plus current official lookup in step 3.
 IF entry IS NULL OR entry->'source' IS DISTINCT FROM input->'source' OR entry->'content'->>'mode'<>'general_question' THEN RETURN '{"status":"unavailable"}'; END IF;
 RETURN jsonb_build_object('contractVersion',1,'policyVersion','evidence-informed-v1','status','current','source',entry->'source','sourceRevision',entry->'sourceRevision',
  'scope',jsonb_build_object('studentId',input->>'studentId','organizationId',NULL,'campus',jsonb_build_object('state','unknown','id',NULL),'term',jsonb_build_object('state','unknown','value',NULL)),
  'authority',entry->'authority');
END $$;

CREATE FUNCTION origen_recommendation_library_after_restore() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 UPDATE origen_recommendation_library_capabilities SET expires_at=clock_timestamp()-interval '1 second',revision=revision+1;
 UPDATE origen_recommendation_templates SET revision=revision+1,published=NULL,published_revision=NULL,teaching_revision=NULL,publisher_hash=NULL,publisher_revision=NULL,published_at=NULL,updated_at=clock_timestamp();
 INSERT INTO origen_recommendation_template_revisions(teaching_id,revision,action,content) SELECT teaching_id,revision,'restore',draft FROM origen_recommendation_templates;
END $$;
DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_action_template_date(text)','origen_action_template_valid(jsonb)','origen_recommendation_library_grant(text,boolean,boolean,text[],timestamptz)','origen_recommendation_template_current(uuid)','origen_recommendation_library_command(jsonb)','origen_recommendation_catalog_command(jsonb)','origen_recommendation_source_command(jsonb)','origen_recommendation_source_v1(jsonb)','origen_recommendation_library_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

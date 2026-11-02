-- Private, student-owned request foundation. Existing publications/help flags
-- are not migrated into requests: they do not prove approval of a new question.
CREATE TABLE origen_review_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 request_key uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 created_by text NOT NULL,
 connection_id uuid NOT NULL,
 coordinator_id uuid NOT NULL,
 institution_id uuid NOT NULL,
 coordinator_name text NOT NULL,
 organization_name text NOT NULL,
 connection_revision integer NOT NULL CHECK(connection_revision>0),
 coordinator_revision integer NOT NULL CHECK(coordinator_revision>0),
 organization_revision integer NOT NULL CHECK(organization_revision>0),
 permission_revision integer NOT NULL CHECK(permission_revision>0),
 origin text NOT NULL CHECK(origin IN ('notebook','voice')),
 language text NOT NULL CHECK(language IN ('en','es')),
 kind text NOT NULL CHECK(kind IN ('question','concern','review')),
 original_question text NOT NULL CHECK(length(btrim(original_question)) BETWEEN 1 AND 2000),
 proposed_clarification text NOT NULL DEFAULT '' CHECK(length(proposed_clarification)<=2000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 cancelled_at timestamptz,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,request_key), UNIQUE(account_id,student_id,id),
 CHECK((status='draft' AND cancelled_at IS NULL AND version=1) OR
       (status='cancelled' AND cancelled_at IS NOT NULL AND cancelled_at>=created_at AND version=2))
);
-- Recipient IDs deliberately are historical references, not cascading FKs:
-- coordinator offboarding must not erase the student's private request history.
-- The only runtime writer validates and locks the real relationship below.
CREATE INDEX origen_review_requests_student ON origen_review_requests(account_id,student_id,created_at,id);
CREATE TABLE origen_review_request_tombstones (
 account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL,
 request_key uuid NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_key), UNIQUE(account_id,student_id,request_id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
-- Content-free deletion receipts prevent a delayed draft retry from restoring
-- a question the student removed. They disappear with the student/account.
CREATE TABLE origen_review_request_entries (
 account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL,
 entry_id uuid NOT NULL, lineage_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0),
 lineage_revision integer NOT NULL CHECK(lineage_revision>0),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 topic text NOT NULL CHECK(topic IN ('options','transfer','costs','applications')),
 kind text NOT NULL CHECK(kind IN ('note','question','explanation','decision')),
 language text NOT NULL CHECK(language IN ('en','es')),
 PRIMARY KEY(request_id,entry_id),
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE
);
-- Store version references, never another copy of a private note or transcript.
-- Missing/changed sources remain explicit references; they cannot silently
-- disappear from a proposed selection or be replaced by newly edited content.
ALTER TABLE origen_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_review_request_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_review_request_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_review_requests,origen_review_request_entries,origen_review_request_tombstones FROM PUBLIC;

CREATE FUNCTION origen_review_request_view(request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('id',r.id,'studentId',r.student_id,'createdBy',r.created_by,
  'origin',r.origin,'language',r.language,'kind',r.kind,
  'originalQuestion',r.original_question,'proposedClarification',r.proposed_clarification,
  'status',r.status,'version',r.version,'createdAt',r.created_at,'cancelledAt',r.cancelled_at,
  'recipient',jsonb_build_object('connectionId',r.connection_id,'coordinatorId',r.coordinator_id,
   'organizationId',r.institution_id,'coordinatorName',r.coordinator_name,'organizationName',r.organization_name,
   'connectionRevision',r.connection_revision,'coordinatorRevision',r.coordinator_revision,'organizationRevision',r.organization_revision),
  'permissionRevision',r.permission_revision,
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.entry_id,'version',e.source_version,
    'lineageId',e.lineage_id,'lineageRevision',e.lineage_revision,'digest',e.source_digest,
    'topic',e.topic,'kind',e.kind,'language',e.language) ORDER BY e.entry_id)
   FROM origen_review_request_entries e WHERE e.request_id=r.id),'[]'::jsonb))
 FROM origen_review_requests r JOIN origen_accounts a ON a.id=r.account_id
 WHERE r.id=request AND a.auth0_subject=nullif(current_setting('origen.subject',true),'')
  AND current_setting('origen.purpose',true)='account'
$$;

CREATE FUNCTION origen_review_request_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 student text:=input->>'studentId'; owner uuid; r origen_review_requests%ROWTYPE;
 c origen_binder_connections%ROWTYPE; p origen_coordinator_profiles%ROWTYPE;
 org origen_institutions%ROWTYPE; access origen_coordinator_organizations%ROWTYPE;
 selected jsonb; refs jsonb; fingerprint text; permission integer; result jsonb;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_request_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('create','get','cancel','remove','export') THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
 IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR NO KEY UPDATE;
 IF action='export' THEN
  IF input-ARRAY['action']<>'{}'::jsonb THEN RETURN '{"error":"invalid_review_request"}'; END IF;
  SELECT coalesce(jsonb_agg(origen_review_request_view(id) ORDER BY created_at,id),'[]'::jsonb) INTO result FROM origen_review_requests WHERE account_id=owner;
  RETURN jsonb_build_object('requests',result,'deletions',coalesce((SELECT jsonb_agg(jsonb_build_object('requestId',request_id,'studentId',student_id,'deletedAt',deleted_at) ORDER BY deleted_at,request_id) FROM origen_review_request_tombstones WHERE account_id=owner),'[]'::jsonb));
 END IF;
 IF jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(student) NOT BETWEEN 1 AND 128 THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"review_request_unavailable"}'; END IF;
 IF action<>'create' THEN
  IF input-ARRAY['action','studentId','id','version']<>'{}'::jsonb OR input->>'id' IS NULL THEN RETURN '{"error":"invalid_review_request"}'; END IF;
  SELECT * INTO r FROM origen_review_requests WHERE id=(input->>'id')::uuid AND account_id=owner AND student_id=student FOR UPDATE;
  IF r.id IS NULL THEN
   IF action='remove' AND EXISTS(SELECT 1 FROM origen_review_request_tombstones WHERE account_id=owner AND student_id=student AND request_id=(input->>'id')::uuid) THEN RETURN '{"removed":true}'; END IF;
   RETURN '{"error":"review_request_unavailable"}';
  END IF;
  IF action<>'get' THEN
   IF (input->>'version')::integer IS DISTINCT FROM r.version THEN RETURN '{"error":"review_request_changed"}'; END IF;
   IF action='remove' THEN
    INSERT INTO origen_review_request_tombstones(account_id,student_id,request_id,request_key) VALUES(owner,student,r.id,r.request_key);
    DELETE FROM origen_review_requests WHERE id=r.id; RETURN '{"removed":true}';
   END IF;
   IF r.status='draft' THEN UPDATE origen_review_requests SET status='cancelled',version=2,cancelled_at=clock_timestamp() WHERE id=r.id; END IF;
  END IF;
  RETURN jsonb_build_object('request',origen_review_request_view(r.id));
 END IF;
 IF input-ARRAY['action','studentId','requestKey','connectionId','origin','language','kind','originalQuestion','proposedClarification','entries']<>'{}'::jsonb
  OR input->>'requestKey' IS NULL OR input->>'connectionId' IS NULL
  OR input->>'origin' IS NULL OR input->>'origin' NOT IN ('notebook','voice')
  OR input->>'language' IS NULL OR input->>'language' NOT IN ('en','es')
  OR input->>'kind' IS NULL OR input->>'kind' NOT IN ('question','concern','review')
  OR jsonb_typeof(input->'originalQuestion') IS DISTINCT FROM 'string' OR length(btrim(input->>'originalQuestion'))<1 OR length(input->>'originalQuestion')>2000
  OR jsonb_typeof(input->'proposedClarification') IS DISTINCT FROM 'string' OR length(input->>'proposedClarification')>2000
  OR (input->>'originalQuestion') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' OR (input->>'proposedClarification') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  OR jsonb_typeof(input->'entries') IS DISTINCT FROM 'array' THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 IF jsonb_array_length(input->'entries')>20 THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 FOR selected IN SELECT value FROM jsonb_array_elements(input->'entries') LOOP
  IF jsonb_typeof(selected) IS DISTINCT FROM 'object' OR selected-ARRAY['id','version']<>'{}'::jsonb
   OR selected->>'id' IS NULL OR jsonb_typeof(selected->'version') IS DISTINCT FROM 'number'
   OR (selected->>'version') !~ '^[1-9][0-9]*$' THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (value->>'id')::uuid) FROM jsonb_array_elements(input->'entries'))<>jsonb_array_length(input->'entries') THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'version',(value->>'version')::integer) ORDER BY (value->>'id')::uuid),'[]'::jsonb) INTO selected FROM jsonb_array_elements(input->'entries');
 fingerprint:=encode(sha256(convert_to(((input-'requestKey')||jsonb_build_object('connectionId',(input->>'connectionId')::uuid,'entries',selected))::text,'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM origen_review_request_tombstones WHERE account_id=owner AND request_key=(input->>'requestKey')::uuid) THEN RETURN '{"error":"review_request_unavailable"}'; END IF;
 SELECT * INTO r FROM origen_review_requests WHERE account_id=owner AND request_key=(input->>'requestKey')::uuid;
 IF r.id IS NOT NULL THEN
  IF r.payload_digest<>fingerprint THEN RETURN '{"error":"review_request_changed"}'; END IF;
  -- Replays return a private receipt, even after cancellation or access loss.
  -- They never create another request or imply that it is shareable now.
  RETURN jsonb_build_object('request',origen_review_request_view(r.id));
 END IF;
 IF NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 IF (SELECT count(*) FROM origen_review_requests WHERE account_id=owner)>=500 THEN RETURN '{"error":"review_request_limit"}'; END IF;
 SELECT * INTO c FROM origen_binder_connections WHERE id=(input->>'connectionId')::uuid AND account_id=owner AND student_id=student;
 IF c.id IS NULL THEN RETURN '{"error":"review_request_denied"}'; END IF;
 -- Match existing publication lock order, including coordinator removal.
 SELECT i.* INTO org FROM origen_institutions i JOIN origen_coordinator_profiles cp ON cp.institution_id=i.id WHERE cp.id=c.coordinator_id FOR UPDATE OF i;
 SELECT * INTO p FROM origen_coordinator_profiles WHERE id=c.coordinator_id FOR SHARE;
 SELECT * INTO access FROM origen_coordinator_organizations WHERE institution_id=org.id FOR SHARE;
 PERFORM 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=p.auth0_subject FOR SHARE;
 IF NOT FOUND OR p.status<>'active' OR access.status IS DISTINCT FROM 'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT * INTO c FROM origen_binder_connections WHERE id=c.id FOR UPDATE;
 IF c.id IS NULL OR c.status<>'accepted' THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT revision INTO permission FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
 -- Use the established manual-note eligibility policy. Derived excerpts and
 -- summaries are deliberately outside this initial record contract.
 PERFORM set_config('origen.derived_sharing','false',true);
 SELECT coalesce(jsonb_agg(to_jsonb(e)-'content'),'[]'::jsonb) INTO refs
 FROM origen_binder_eligible_entries(owner,student) e JOIN jsonb_array_elements(selected) s
 ON e.id=(s.value->>'id')::uuid AND e.source_version=(s.value->>'version')::integer;
 IF jsonb_array_length(refs)<>jsonb_array_length(selected) THEN RETURN '{"error":"review_request_sources_changed"}'; END IF;
 INSERT INTO origen_review_requests(account_id,student_id,request_key,payload_digest,created_by,connection_id,coordinator_id,institution_id,
  coordinator_name,organization_name,connection_revision,coordinator_revision,organization_revision,permission_revision,
  origin,language,kind,original_question,proposed_clarification)
 VALUES(owner,student,(input->>'requestKey')::uuid,fingerprint,actor,c.id,p.id,org.id,p.display_name,coalesce(org.draft->>'name',''),c.revision,p.revision,access.revision,permission,
  input->>'origin',input->>'language',input->>'kind',input->>'originalQuestion',input->>'proposedClarification') RETURNING * INTO r;
 INSERT INTO origen_review_request_entries(account_id,student_id,request_id,entry_id,lineage_id,source_version,lineage_revision,source_digest,topic,kind,language)
 SELECT owner,student,r.id,(value->>'id')::uuid,(value->>'lineage_id')::uuid,(value->>'source_version')::integer,(value->>'lineage_revision')::integer,value->>'source_digest',value->>'topic',value->>'kind',value->>'language' FROM jsonb_array_elements(refs);
 RETURN jsonb_build_object('request',origen_review_request_view(r.id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_review_request"}';
END $$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_review_request_view(uuid) SET search_path=%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION origen_review_request_command(jsonb) SET search_path=%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_review_request_view(uuid),origen_review_request_command(jsonb) FROM PUBLIC;

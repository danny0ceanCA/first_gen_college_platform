-- Explicit review scopes are provisioned by the migration/operator identity.
-- Membership and ordinary response permission do not confer this capability.
CREATE TABLE origen_outcome_review_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 definition_id text NOT NULL, definition_version integer NOT NULL DEFAULT 1,
 bases text[] NOT NULL CHECK(cardinality(bases)>0 AND bases<@ARRAY['student_account','direct_observation','declared_record_review']),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(institution_id,coordinator_id,definition_id,definition_version),
 FOREIGN KEY(definition_id,definition_version) REFERENCES origen_outcome_definitions(id,version)
);
CREATE TABLE origen_outcome_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL,
 publication_id uuid NOT NULL REFERENCES origen_review_request_publications(id) ON DELETE CASCADE,
 coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 author_subject text NOT NULL, author_name text NOT NULL, organization_name text NOT NULL,
 capability_id uuid NOT NULL REFERENCES origen_outcome_review_capabilities(id) ON DELETE CASCADE, capability_version integer NOT NULL,
 version integer NOT NULL CHECK(version>0), payload jsonb, publication_hash text NOT NULL,
 advice_relationship text NOT NULL CHECK(advice_relationship IN ('same_author','different_author','unknown')),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','withdrawn')),
 institution_verified boolean NOT NULL DEFAULT false CHECK(NOT institution_verified),
 independence text NOT NULL DEFAULT 'not_established' CHECK(independence='not_established'),
 evaluation_allowed boolean NOT NULL DEFAULT false CHECK(NOT evaluation_allowed),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE,
 CHECK(status='published' AND payload IS NOT NULL AND jsonb_typeof(payload)='object' OR status='withdrawn' AND payload IS NULL)
);
CREATE UNIQUE INDEX outcome_observation_claim ON origen_outcome_observations(publication_id,(payload->'claim'->>'definitionId'),(payload->'claim'->>'definitionVersion'),(payload->'claim'->'scope')) WHERE status='published';
CREATE TABLE origen_outcome_observation_disputes (
 observation_id uuid PRIMARY KEY REFERENCES origen_outcome_observations(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE, student_id text NOT NULL,
 observation_version integer NOT NULL CHECK(observation_version>0), version integer NOT NULL CHECK(version>0),
 detail text, visibility text NOT NULL CHECK(visibility IN ('private','shared')), deleted_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(deleted_at IS NOT NULL AND detail IS NULL AND visibility='private' OR deleted_at IS NULL AND detail IS NOT NULL AND length(btrim(detail)) BETWEEN 1 AND 800)
);
CREATE TABLE origen_outcome_observation_previews (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL,
 publication_id uuid NOT NULL REFERENCES origen_review_request_publications(id) ON DELETE CASCADE,
 observation_id uuid NOT NULL, actor text NOT NULL, kind text NOT NULL CHECK(kind IN ('observation','dispute')),
 expected_version integer NOT NULL CHECK(expected_version>=0), observation_version integer NOT NULL CHECK(observation_version>=0),
 capability_id uuid REFERENCES origen_outcome_review_capabilities(id) ON DELETE CASCADE, capability_version integer,
 payload jsonb, publication_hash text NOT NULL, input_hash text NOT NULL, digest text NOT NULL, snapshot jsonb,
 result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE
);
CREATE INDEX outcome_observation_request ON origen_outcome_observations(request_id);
CREATE INDEX outcome_observation_preview_owner ON origen_outcome_observation_previews(account_id,request_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_outcome_review_capabilities','origen_outcome_observations','origen_outcome_observation_disputes','origen_outcome_observation_previews'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 END LOOP;
END $$;

CREATE FUNCTION origen_outcome_review_grant(org uuid,coordinator uuid,definition text,allowed_bases text[],valid_until timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM origen_coordinator_profiles WHERE id=coordinator AND institution_id=org AND status='active')
  OR valid_until IS NOT NULL AND (valid_until<=clock_timestamp() OR valid_until>clock_timestamp()+interval '366 days') THEN RAISE EXCEPTION 'invalid_outcome_capability' USING ERRCODE='23514'; END IF;
 IF valid_until IS NULL THEN UPDATE origen_outcome_review_capabilities SET revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE institution_id=org AND coordinator_id=coordinator AND definition_id=definition RETURNING id INTO result;
 ELSE
  INSERT INTO origen_outcome_review_capabilities(institution_id,coordinator_id,definition_id,bases,expires_at) VALUES(org,coordinator,definition,allowed_bases,valid_until)
   ON CONFLICT(institution_id,coordinator_id,definition_id,definition_version) DO UPDATE SET bases=excluded.bases,expires_at=excluded.expires_at,revoked_at=NULL,version=origen_outcome_review_capabilities.version+1,updated_at=clock_timestamp() RETURNING id INTO result;
 END IF;RETURN result;
END $$;

CREATE FUNCTION origen_outcome_observation_validate(body jsonb,publication jsonb) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE claim jsonb:=body->'claim'; selection jsonb:=body->'selection'; source text; value text; tz text:=body->>'timeZone';
BEGIN
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['claim','selection','position','basis','observation','observedOn','eventOn','timeZone','sourceReference','dependsOnStudentStatement']<>'{}'::jsonb
  OR NOT(body ?& ARRAY['claim','selection','position','basis','observation','observedOn','eventOn','timeZone','sourceReference','dependsOnStudentStatement'])
  OR jsonb_typeof(claim) IS DISTINCT FROM 'object' OR claim-ARRAY['definitionId','definitionVersion','scope','claimStatus','decision']<>'{}'::jsonb
  OR NOT(claim ?& ARRAY['definitionId','definitionVersion','scope','claimStatus','decision'])
  OR NOT EXISTS(SELECT 1 FROM origen_outcome_definitions WHERE id=claim->>'definitionId' AND version=(claim->>'definitionVersion')::integer)
  OR jsonb_typeof(claim->'scope') IS DISTINCT FROM 'object' OR (claim->'scope')-ARRAY['institution','term','cycle']<>'{}'::jsonb OR NOT(claim->'scope' ?& ARRAY['institution','term','cycle'])
  OR coalesce(body->>'position','') NOT IN ('supports','contradicts','cannot_establish') OR coalesce(body->>'basis','') NOT IN ('student_account','direct_observation','declared_record_review')
  OR jsonb_typeof(body->'observation') IS DISTINCT FROM 'string' OR coalesce(length(btrim(body->>'observation')),0) NOT BETWEEN 1 AND 1200
  OR coalesce(body->>'dependsOnStudentStatement','') NOT IN ('yes','no','unknown') OR body->>'basis'='student_account' AND body->>'dependsOnStudentStatement'<>'yes'
  OR coalesce(claim->>'claimStatus','') NOT IN ('occurred','not_occurred','pending','unknown','goal_changed') THEN RAISE EXCEPTION 'invalid_outcome_observation' USING ERRCODE='23514'; END IF;
 IF claim->>'definitionId'='decision_received' AND claim->>'claimStatus'='occurred' THEN
  IF coalesce(claim->>'decision','') NOT IN ('approved','denied','other','unknown') THEN RAISE EXCEPTION 'invalid_outcome_decision' USING ERRCODE='23514'; END IF;
 ELSIF claim->'decision'<>'null'::jsonb THEN RAISE EXCEPTION 'invalid_outcome_decision' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection-ARRAY['kind','entryId','quote']<>'{}'::jsonb OR NOT(selection ?& ARRAY['kind','entryId','quote'])
  OR coalesce(length(selection->>'quote'),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_outcome_selection' USING ERRCODE='23514'; END IF;
 IF selection->>'kind'='question' AND selection->'entryId'='null'::jsonb THEN source:=publication->>'question';
 ELSIF selection->>'kind'='note' THEN SELECT e->>'content' INTO source FROM jsonb_array_elements(publication->'entries') e WHERE e->>'id'=selection->>'entryId'; END IF;
 IF source IS NULL OR strpos(source,selection->>'quote')=0 THEN RAISE EXCEPTION 'outcome_selection_changed' USING ERRCODE='23514'; END IF;
 FOR value IN SELECT jsonb_object_keys(claim->'scope') LOOP
  IF claim->'scope'->value<>'null'::jsonb AND (jsonb_typeof(claim->'scope'->value)<>'string' OR length(btrim(claim->'scope'->>value)) NOT BETWEEN 1 AND CASE value WHEN 'institution' THEN 200 WHEN 'term' THEN 100 ELSE 128 END
   OR strpos(lower(source),lower(claim->'scope'->>value))=0) THEN RAISE EXCEPTION 'outcome_scope_changed' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF body->>'position'<>'cannot_establish' AND (claim->>'claimStatus'='unknown' OR claim->'scope'->>'institution' IS NULL OR claim->'scope'->>'term' IS NULL OR claim->'scope'->>'cycle' IS NULL) THEN RAISE EXCEPTION 'invalid_outcome_scope' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz) OR coalesce(body->>'observedOn','') !~ '^\d{4}-\d{2}-\d{2}$'
  OR (body->>'observedOn')::date<'1900-01-01' OR (body->>'observedOn')::date>(clock_timestamp() AT TIME ZONE tz)::date
  OR body->'eventOn'<>'null'::jsonb AND (coalesce(body->>'eventOn','') !~ '^\d{4}-\d{2}-\d{2}$' OR (body->>'eventOn')::date<'1900-01-01' OR (body->>'eventOn')::date>(body->>'observedOn')::date)
  THEN RAISE EXCEPTION 'invalid_outcome_date' USING ERRCODE='23514'; END IF;
 IF body->>'basis'='declared_record_review' THEN
  IF jsonb_typeof(body->'sourceReference') IS DISTINCT FROM 'object' OR (body->'sourceReference')-ARRAY['kind','on']<>'{}'::jsonb OR NOT(body->'sourceReference' ?& ARRAY['kind','on'])
   OR coalesce(body->'sourceReference'->>'kind','') NOT IN ('submission_receipt','decision_notice','office_message','institution_record','other_record')
   OR body->'sourceReference'->'on'<>'null'::jsonb AND (coalesce(body->'sourceReference'->>'on','') !~ '^\d{4}-\d{2}-\d{2}$' OR (body->'sourceReference'->>'on')::date<'1900-01-01' OR (body->'sourceReference'->>'on')::date>(body->>'observedOn')::date)
   THEN RAISE EXCEPTION 'invalid_outcome_reference' USING ERRCODE='23514'; END IF;
 ELSIF body->'sourceReference'<>'null'::jsonb THEN RAISE EXCEPTION 'invalid_outcome_reference' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION origen_outcome_observation_view(oid uuid,student_view boolean) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('id',o.id,'version',o.version,'status',o.status,'payload',o.payload,'createdAt',o.created_at,'updatedAt',o.updated_at,
  'availability',CASE WHEN origen_review_request_live(o.request_id) AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.version=o.capability_version THEN 'current' ELSE 'historical' END,
  'author',jsonb_build_object('name',o.author_name,'organization',o.organization_name),'adviceRelationship',o.advice_relationship,
  'institutionVerified',false,'independence','not_established','dispute',
   CASE WHEN d.observation_id IS NOT NULL AND d.deleted_at IS NULL AND (student_view OR d.visibility='shared') THEN jsonb_build_object('version',d.version,'observationVersion',d.observation_version,'detail',d.detail,'visibility',d.visibility,'updatedAt',d.updated_at) END)
 FROM origen_outcome_observations o JOIN origen_outcome_review_capabilities c ON c.id=o.capability_id LEFT JOIN origen_outcome_observation_disputes d ON d.observation_id=o.id WHERE o.id=oid
$$;

CREATE FUNCTION origen_coordinator_outcome_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE current_actor text:=current_setting('origen.subject',true); action text:=input->>'action'; access jsonb; r origen_review_requests%ROWTYPE; pub origen_review_request_publications%ROWTYPE;
 cap origen_outcome_review_capabilities%ROWTYPE; o origen_outcome_observations%ROWTYPE; p origen_outcome_observation_previews%ROWTYPE;
 body jsonb; snapshot jsonb; fingerprint text; publication_hash text; advice text; next_id uuid;
BEGIN
 IF input-ARRAY['action','organizationId','id','publicationId','operationId','observationId','version','payload','previewId','digest','confirmed','enabled','deliveryEnabled']<>'{}'::jsonb
  OR action NOT IN ('load','prepare','confirm','withdraw') THEN RETURN '{"error":"invalid_outcome_observation"}'; END IF;
 access:=origen_coordinator_review_command(jsonb_build_object('action','read','organizationId',input->'organizationId','id',input->'id','enabled',input->'deliveryEnabled'));
 IF access ? 'error' THEN RETURN access; END IF;
 SELECT * INTO r FROM origen_review_requests WHERE id=(input->>'id')::uuid FOR UPDATE;
 SELECT * INTO pub FROM origen_review_request_publications WHERE id=(access->>'publicationId')::uuid FOR UPDATE;
 publication_hash:=encode(sha256(convert_to(pub.payload::text,'UTF8')),'hex');
 IF action='load' THEN RETURN jsonb_build_object('enabled',input->'enabled','publicationId',pub.id,
  'capabilities',coalesce((SELECT jsonb_agg(jsonb_build_object('definitionId',definition_id,'definitionVersion',definition_version,'bases',bases)) FROM origen_outcome_review_capabilities WHERE coordinator_id=r.coordinator_id AND institution_id=r.institution_id AND revoked_at IS NULL AND expires_at>clock_timestamp()),'[]'::jsonb),
  'observations',coalesce((SELECT jsonb_agg(origen_outcome_observation_view(id,false) ORDER BY created_at,id) FROM origen_outcome_observations WHERE request_id=r.id),'[]'::jsonb)); END IF;
 IF pub.id IS DISTINCT FROM (input->>'publicationId')::uuid THEN RETURN '{"error":"outcome_publication_changed"}'; END IF;
 IF action='withdraw' THEN
  SELECT * INTO o FROM origen_outcome_observations WHERE id=(input->>'observationId')::uuid AND request_id=r.id AND author_subject=current_actor FOR UPDATE;
  IF o.id IS NULL THEN RETURN '{"error":"outcome_observation_unavailable"}'; END IF;
  IF o.status='withdrawn' AND o.version=(input->>'version')::integer+1 THEN RETURN '{"status":"withdrawn"}'; END IF;
  IF o.version IS DISTINCT FROM (input->>'version')::integer OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"outcome_observation_changed"}'; END IF;
  UPDATE origen_outcome_observations SET payload=NULL,status='withdrawn',version=version+1,updated_at=clock_timestamp() WHERE id=o.id;
  DELETE FROM origen_outcome_observation_disputes WHERE observation_id=o.id;RETURN '{"status":"withdrawn"}';
 END IF;
 IF action='confirm' THEN
  SELECT * INTO p FROM origen_outcome_observation_previews WHERE id=(input->>'previewId')::uuid AND actor=current_actor AND kind='observation' AND request_id=r.id FOR UPDATE;
  IF p.id IS NULL OR p.actor<>current_actor OR input->>'digest' IS DISTINCT FROM p.digest OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  IF p.result IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM origen_outcome_observations WHERE id=p.observation_id AND version=(p.result->>'version')::integer AND status='published') THEN RETURN p.result; ELSE RETURN '{"status":"superseded"}'; END IF;
  END IF;
  IF p.expires_at<=clock_timestamp() OR p.publication_hash<>publication_hash OR p.payload IS NULL THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  body:=p.payload;
 ELSE body:=input->'payload'; END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"outcome_observation_paused"}'; END IF;
 PERFORM origen_outcome_observation_validate(body,pub.payload);
 SELECT * INTO cap FROM origen_outcome_review_capabilities WHERE institution_id=r.institution_id AND coordinator_id=r.coordinator_id
  AND definition_id=body->'claim'->>'definitionId' AND definition_version=(body->'claim'->>'definitionVersion')::integer FOR SHARE;
 IF cap.id IS NULL OR cap.revoked_at IS NOT NULL OR cap.expires_at<=clock_timestamp() OR NOT(body->>'basis'=ANY(cap.bases)) THEN RETURN '{"error":"outcome_capability_denied"}'; END IF;
 SELECT CASE WHEN a.author_subject=current_actor THEN 'same_author' ELSE 'different_author' END INTO advice FROM origen_review_request_responses a
  WHERE a.request_id=r.related_request_id AND a.version=r.related_response_version AND a.withdrawn_at IS NULL;
 advice:=coalesce(advice,'unknown');
 IF action='prepare' THEN
  fingerprint:=encode(sha256(convert_to((input-ARRAY['enabled','deliveryEnabled'])::text,'UTF8')),'hex');
  DELETE FROM origen_outcome_observation_previews WHERE expires_at<=clock_timestamp() AND result IS NULL;
  SELECT * INTO p FROM origen_outcome_observation_previews WHERE id=(input->>'operationId')::uuid FOR UPDATE;
  IF p.id IS NOT NULL THEN
   IF p.actor<>current_actor OR p.input_hash<>fingerprint OR p.result IS NOT NULL OR p.payload IS NULL THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  ELSE
   IF (SELECT count(*) FROM origen_outcome_observation_previews WHERE actor=current_actor AND result IS NULL)>=30 THEN RETURN '{"error":"outcome_limit_changed"}'; END IF;
   SELECT * INTO o FROM origen_outcome_observations WHERE id=(input->>'observationId')::uuid AND request_id=r.id AND author_subject=current_actor FOR UPDATE;
   IF input->>'observationId' IS NOT NULL AND o.id IS NULL OR coalesce(o.version,0) IS DISTINCT FROM (input->>'version')::integer OR o.status='withdrawn' THEN RETURN '{"error":"outcome_observation_changed"}'; END IF;
   IF o.id IS NULL AND (SELECT count(*) FROM origen_outcome_observations WHERE request_id=r.id)>=10 THEN RETURN '{"error":"outcome_limit_changed"}'; END IF;
   IF EXISTS(SELECT 1 FROM origen_outcome_observations WHERE request_id=r.id AND status='published' AND id IS DISTINCT FROM o.id AND payload->'claim'->'scope'=body->'claim'->'scope' AND payload->'claim'->>'definitionId'=body->'claim'->>'definitionId') THEN RETURN '{"error":"outcome_duplicate_changed"}'; END IF;
   next_id:=coalesce(o.id,gen_random_uuid());
   snapshot:=jsonb_build_object('studentName',pub.payload->>'studentName','author',jsonb_build_object('name',r.coordinator_name,'organization',r.organization_name),'adviceRelationship',advice,'observationVersion',coalesce(o.version,0)+1);
   INSERT INTO origen_outcome_observation_previews(id,account_id,student_id,request_id,publication_id,observation_id,actor,kind,expected_version,observation_version,capability_id,capability_version,payload,publication_hash,input_hash,digest,snapshot,expires_at)
    VALUES((input->>'operationId')::uuid,r.account_id,r.student_id,r.id,pub.id,next_id,current_actor,'observation',coalesce(o.version,0),coalesce(o.version,0),cap.id,cap.version,body,publication_hash,fingerprint,encode(sha256(convert_to(fingerprint||gen_random_uuid()::text,'UTF8')),'hex'),snapshot,least(clock_timestamp()+interval '10 minutes',pub.expires_at,cap.expires_at)) RETURNING * INTO p;
  END IF;
  RETURN jsonb_build_object('preview',p.snapshot||jsonb_build_object('id',p.id,'kind',p.kind,'digest',p.digest,'expiresAt',p.expires_at,'payload',p.payload));
 END IF;
 IF p.capability_id<>cap.id OR p.capability_version<>cap.version OR p.snapshot->>'adviceRelationship'<>advice THEN RETURN '{"error":"outcome_capability_changed"}'; END IF;
 SELECT * INTO o FROM origen_outcome_observations WHERE id=p.observation_id FOR UPDATE;
 IF coalesce(o.version,0)<>p.expected_version OR o.status='withdrawn' THEN RETURN '{"error":"outcome_observation_changed"}'; END IF;
 IF o.id IS NULL AND (SELECT count(*) FROM origen_outcome_observations WHERE request_id=r.id)>=10 THEN RETURN '{"error":"outcome_limit_changed"}'; END IF;
 INSERT INTO origen_outcome_observations(id,account_id,student_id,request_id,publication_id,coordinator_id,author_subject,author_name,organization_name,capability_id,capability_version,version,payload,publication_hash,advice_relationship)
  VALUES(p.observation_id,r.account_id,r.student_id,r.id,pub.id,r.coordinator_id,current_actor,r.coordinator_name,r.organization_name,cap.id,cap.version,p.expected_version+1,body,publication_hash,advice)
  ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload,capability_id=excluded.capability_id,capability_version=excluded.capability_version,advice_relationship=excluded.advice_relationship,updated_at=clock_timestamp() RETURNING * INTO o;
 UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,result=jsonb_build_object('status','published','id',o.id,'version',o.version) WHERE id=p.id RETURNING * INTO p;RETURN p.result;
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error',SQLERRM);
 WHEN unique_violation THEN RETURN '{"error":"outcome_duplicate_changed"}';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN RETURN '{"error":"invalid_outcome_observation"}';
END $$;

CREATE FUNCTION origen_student_outcome_observation_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE who text:=current_setting('origen.subject',true); action text:=input->>'action'; owner uuid; r origen_review_requests%ROWTYPE;
 o origen_outcome_observations%ROWTYPE; d origen_outcome_observation_disputes%ROWTYPE; p origen_outcome_observation_previews%ROWTYPE;
 pub origen_review_request_publications%ROWTYPE; body jsonb; fingerprint text; publication_hash text;
BEGIN
 IF who IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"outcome_observation_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=who AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(who,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"outcome_observation_denied"}'; END IF;
 IF action='export' AND input-ARRAY['action']='{}'::jsonb THEN RETURN jsonb_build_object('observations',coalesce((SELECT jsonb_agg(origen_outcome_observation_view(id,true)) FROM origen_outcome_observations WHERE account_id=owner),'[]'::jsonb)); END IF;
 IF input-ARRAY['action','studentId','id','observationId','observationVersion','version','operationId','payload','previewId','digest','confirmed','enabled']<>'{}'::jsonb OR action NOT IN ('load','prepare-dispute','confirm-dispute','delete-dispute') THEN RETURN '{"error":"invalid_outcome_observation"}'; END IF;
 SELECT * INTO r FROM origen_review_requests WHERE id=(input->>'id')::uuid AND account_id=owner AND student_id=input->>'studentId' FOR UPDATE;
 IF r.id IS NULL THEN RETURN '{"error":"outcome_observation_unavailable"}'; END IF;
 SELECT * INTO pub FROM origen_review_request_publications WHERE request_id=r.id FOR SHARE;
 publication_hash:=coalesce(encode(sha256(convert_to(pub.payload::text,'UTF8')),'hex'),'');
 IF action='load' THEN RETURN jsonb_build_object('enabled',input->'enabled','canShare',input->'enabled'='true'::jsonb AND origen_review_request_live(r.id),
  'observations',coalesce((SELECT jsonb_agg(origen_outcome_observation_view(id,true) ORDER BY created_at,id) FROM origen_outcome_observations WHERE request_id=r.id),'[]'::jsonb)); END IF;
 IF action='confirm-dispute' THEN
  SELECT * INTO p FROM origen_outcome_observation_previews WHERE id=(input->>'previewId')::uuid AND actor=who AND request_id=r.id AND kind='dispute' FOR UPDATE;
  IF p.id IS NULL OR p.digest IS DISTINCT FROM input->>'digest' OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  IF p.result IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM origen_outcome_observation_disputes WHERE observation_id=p.observation_id AND version=(p.result->>'version')::integer AND deleted_at IS NULL) THEN RETURN p.result; ELSE RETURN '{"status":"superseded"}'; END IF;
  END IF;
  IF p.expires_at<=clock_timestamp() OR p.payload IS NULL THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  SELECT * INTO o FROM origen_outcome_observations WHERE id=p.observation_id AND request_id=r.id FOR UPDATE;body:=p.payload;
 ELSE SELECT * INTO o FROM origen_outcome_observations WHERE id=(input->>'observationId')::uuid AND request_id=r.id FOR UPDATE;body:=input->'payload'; END IF;
 IF o.id IS NULL THEN RETURN '{"error":"outcome_observation_unavailable"}'; END IF;
 SELECT * INTO d FROM origen_outcome_observation_disputes WHERE observation_id=o.id FOR UPDATE;
 IF action='delete-dispute' THEN
  IF d.observation_id IS NULL OR d.deleted_at IS NOT NULL THEN RETURN '{"status":"deleted"}'; END IF;
  IF d.version IS DISTINCT FROM (input->>'version')::integer OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"outcome_dispute_changed"}'; END IF;
  UPDATE origen_outcome_observation_disputes SET detail=NULL,visibility='private',deleted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE observation_id=o.id;RETURN '{"status":"deleted"}';
 END IF;
 IF (SELECT role FROM origen_accounts WHERE id=owner)<>'student' OR o.status<>'published' THEN RETURN '{"error":"outcome_observation_unavailable"}'; END IF;
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['detail','visibility']<>'{}'::jsonb OR NOT(body ?& ARRAY['detail','visibility'])
  OR jsonb_typeof(body->'detail') IS DISTINCT FROM 'string' OR length(btrim(body->>'detail')) NOT BETWEEN 1 AND 800 OR coalesce(body->>'visibility','') NOT IN ('private','shared') THEN RETURN '{"error":"invalid_outcome_dispute"}'; END IF;
 IF body->>'visibility'='shared' AND (input->'enabled' IS DISTINCT FROM 'true'::jsonb OR NOT origen_review_request_live(r.id) OR pub.id IS NULL) THEN RETURN '{"error":"outcome_sharing_unavailable"}'; END IF;
 IF action='prepare-dispute' THEN
  IF o.version IS DISTINCT FROM (input->>'observationVersion')::integer OR (CASE WHEN d.deleted_at IS NULL THEN coalesce(d.version,0) ELSE 0 END) IS DISTINCT FROM (input->>'version')::integer THEN RETURN '{"error":"outcome_dispute_changed"}'; END IF;
  fingerprint:=encode(sha256(convert_to((input-'enabled')::text,'UTF8')),'hex');
  DELETE FROM origen_outcome_observation_previews WHERE expires_at<=clock_timestamp() AND result IS NULL;
  SELECT * INTO p FROM origen_outcome_observation_previews WHERE id=(input->>'operationId')::uuid FOR UPDATE;
  IF p.id IS NOT NULL THEN
   IF p.actor<>who OR p.input_hash<>fingerprint OR p.result IS NOT NULL OR p.payload IS NULL THEN RETURN '{"error":"outcome_preview_changed"}'; END IF;
  ELSE
   IF (SELECT count(*) FROM origen_outcome_observation_previews WHERE actor=who AND result IS NULL)>=30 THEN RETURN '{"error":"outcome_limit_changed"}'; END IF;
   INSERT INTO origen_outcome_observation_previews(id,account_id,student_id,request_id,publication_id,observation_id,actor,kind,expected_version,observation_version,payload,publication_hash,input_hash,digest,snapshot,expires_at)
    VALUES((input->>'operationId')::uuid,owner,r.student_id,r.id,o.publication_id,o.id,who,'dispute',coalesce(d.version,0),o.version,body,publication_hash,fingerprint,encode(sha256(convert_to(fingerprint||gen_random_uuid()::text,'UTF8')),'hex'),
     jsonb_build_object('author',jsonb_build_object('name',o.author_name,'organization',o.organization_name),'observationVersion',o.version,'observation',origen_outcome_observation_view(o.id,true)),
     CASE WHEN body->>'visibility'='shared' THEN least(clock_timestamp()+interval '10 minutes',pub.expires_at) ELSE clock_timestamp()+interval '10 minutes' END) RETURNING * INTO p;
  END IF;
  RETURN jsonb_build_object('preview',p.snapshot||jsonb_build_object('id',p.id,'kind','dispute','digest',p.digest,'expiresAt',p.expires_at,'payload',p.payload));
 END IF;
 IF o.version<>p.observation_version OR coalesce(d.version,0)<>p.expected_version OR body->>'visibility'='shared' AND p.publication_hash<>publication_hash THEN RETURN '{"error":"outcome_dispute_changed"}'; END IF;
 INSERT INTO origen_outcome_observation_disputes(observation_id,account_id,student_id,observation_version,version,detail,visibility)
  VALUES(o.id,owner,r.student_id,o.version,p.expected_version+1,body->>'detail',body->>'visibility')
  ON CONFLICT(observation_id) DO UPDATE SET version=excluded.version,observation_version=excluded.observation_version,detail=excluded.detail,visibility=excluded.visibility,deleted_at=NULL,updated_at=clock_timestamp() RETURNING * INTO d;
 UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,result=jsonb_build_object('status','saved','version',d.version,'visibility',d.visibility) WHERE id=p.id RETURNING * INTO p;RETURN p.result;
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error',SQLERRM);
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_outcome_observation"}';
END $$;

-- Versioned rows preserve attribution; corrections never silently rewrite an author.
CREATE FUNCTION origen_outcome_observation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r origen_review_requests%ROWTYPE; pub origen_review_request_publications%ROWTYPE; cap origen_outcome_review_capabilities%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.account_id,NEW.student_id,NEW.request_id,NEW.publication_id,NEW.coordinator_id,NEW.author_subject,NEW.author_name,NEW.organization_name,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.account_id,OLD.student_id,OLD.request_id,OLD.publication_id,OLD.coordinator_id,OLD.author_subject,OLD.author_name,OLD.organization_name,OLD.created_at)
  OR NEW.version<>OLD.version+1 OR OLD.status='withdrawn') THEN RAISE EXCEPTION 'outcome_observation_changed' USING ERRCODE='23514'; END IF;
 IF NEW.status='withdrawn' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM origen_review_requests WHERE id=NEW.request_id;
 SELECT * INTO pub FROM origen_review_request_publications WHERE id=NEW.publication_id;
 SELECT * INTO cap FROM origen_outcome_review_capabilities WHERE id=NEW.capability_id;
 IF r.account_id IS DISTINCT FROM NEW.account_id OR r.student_id IS DISTINCT FROM NEW.student_id OR r.coordinator_id IS DISTINCT FROM NEW.coordinator_id
  OR pub.request_id IS DISTINCT FROM r.id OR pub.recipient_subject IS DISTINCT FROM NEW.author_subject OR NOT origen_review_request_live(r.id)
  OR cap.coordinator_id IS DISTINCT FROM NEW.coordinator_id OR cap.institution_id IS DISTINCT FROM r.institution_id OR cap.version IS DISTINCT FROM NEW.capability_version OR cap.revoked_at IS NOT NULL OR cap.expires_at<=clock_timestamp()
  OR cap.definition_id IS DISTINCT FROM NEW.payload->'claim'->>'definitionId' OR cap.definition_version IS DISTINCT FROM (NEW.payload->'claim'->>'definitionVersion')::integer OR NOT(NEW.payload->>'basis'=ANY(cap.bases))
  OR NEW.publication_hash IS DISTINCT FROM encode(sha256(convert_to(pub.payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'outcome_observation_changed' USING ERRCODE='23514'; END IF;
 PERFORM origen_outcome_observation_validate(NEW.payload,pub.payload);
 SELECT CASE WHEN a.author_subject=NEW.author_subject THEN 'same_author' ELSE 'different_author' END INTO NEW.advice_relationship FROM origen_review_request_responses a WHERE a.request_id=r.related_request_id AND a.version=r.related_response_version AND a.withdrawn_at IS NULL;
 NEW.advice_relationship:=coalesce(NEW.advice_relationship,'unknown');NEW.author_name:=r.coordinator_name;NEW.organization_name:=r.organization_name;RETURN NEW;
END $$;
CREATE FUNCTION origen_outcome_dispute_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE o origen_outcome_observations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM origen_outcome_observations WHERE id=NEW.observation_id;
 IF o.id IS NULL OR o.account_id IS DISTINCT FROM NEW.account_id OR o.student_id IS DISTINCT FROM NEW.student_id OR NEW.deleted_at IS NULL AND o.version IS DISTINCT FROM NEW.observation_version OR o.status<>'published'
  OR NEW.visibility='shared' AND NOT origen_review_request_live(o.request_id)
  OR TG_OP='INSERT' AND NEW.version<>1 AND NOT EXISTS(SELECT 1 FROM origen_outcome_observation_disputes d WHERE d.observation_id=NEW.observation_id AND d.version+1=NEW.version) THEN RAISE EXCEPTION 'outcome_dispute_changed' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.observation_id,NEW.account_id,NEW.student_id) IS DISTINCT FROM (OLD.observation_id,OLD.account_id,OLD.student_id) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'outcome_dispute_changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_dispute_guard BEFORE INSERT OR UPDATE ON origen_outcome_observation_disputes FOR EACH ROW EXECUTE FUNCTION origen_outcome_dispute_guard();
CREATE TRIGGER outcome_observation_guard BEFORE INSERT OR UPDATE ON origen_outcome_observations FOR EACH ROW EXECUTE FUNCTION origen_outcome_observation_guard();

CREATE FUNCTION origen_outcome_observation_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
 IF TG_TABLE_NAME='origen_outcome_review_capabilities' THEN
  UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,expires_at=clock_timestamp() WHERE capability_id=OLD.id AND result IS NULL;
 ELSIF TG_TABLE_NAME='origen_outcome_observations' THEN
  UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,expires_at=clock_timestamp() WHERE observation_id=(row->>'id')::uuid AND result IS NULL;
 ELSE
  UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,expires_at=clock_timestamp() WHERE observation_id=(row->>'observation_id')::uuid AND kind='dispute' AND result IS NULL;
 END IF;
 IF row->>'student_id' IS NOT NULL AND EXISTS(SELECT 1 FROM origen_students WHERE account_id=(row->>'account_id')::uuid AND id=row->>'student_id') THEN
  INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES((row->>'account_id')::uuid,row->>'student_id',row->>'student_id') ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1;
 END IF;RETURN NULL;
END $$;
CREATE TRIGGER outcome_observation_changed AFTER INSERT OR UPDATE OR DELETE ON origen_outcome_observations FOR EACH ROW EXECUTE FUNCTION origen_outcome_observation_changed();
CREATE TRIGGER outcome_dispute_changed AFTER INSERT OR UPDATE OR DELETE ON origen_outcome_observation_disputes FOR EACH ROW EXECUTE FUNCTION origen_outcome_observation_changed();
CREATE TRIGGER outcome_capability_changed AFTER UPDATE OR DELETE ON origen_outcome_review_capabilities FOR EACH ROW EXECUTE FUNCTION origen_outcome_observation_changed();

-- A publication loses its staged copied text immediately when access is lost.
CREATE FUNCTION origen_outcome_observation_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 UPDATE origen_outcome_observation_previews SET payload=NULL,snapshot=NULL,expires_at=clock_timestamp() WHERE publication_id=OLD.id AND result IS NULL AND (kind='observation' OR payload->>'visibility'='shared');
 RETURN NULL;
END $$;
CREATE TRIGGER outcome_observation_source_changed AFTER UPDATE OF invalidated_at,payload ON origen_review_request_publications FOR EACH ROW WHEN(OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION origen_outcome_observation_source_changed();
CREATE FUNCTION origen_outcome_observation_after_restore() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 DELETE FROM origen_outcome_observation_previews;
 DELETE FROM origen_outcome_observations o WHERE EXISTS(SELECT 1 FROM origen_closed_accounts c WHERE c.subject_hash=encode(sha256(convert_to(o.author_subject,'UTF8')),'hex'));
 UPDATE origen_outcome_review_capabilities SET revoked_at=coalesce(revoked_at,clock_timestamp()),version=version+1;
END $$;
CREATE FUNCTION origen_outcome_observation_author_erased() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 DELETE FROM origen_outcome_observations WHERE encode(sha256(convert_to(author_subject,'UTF8')),'hex')=NEW.subject_hash;
 DELETE FROM origen_outcome_review_capabilities WHERE coordinator_id IN (SELECT id FROM origen_coordinator_profiles WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=NEW.subject_hash);
 RETURN NULL;
END $$;
CREATE TRIGGER outcome_observation_author_erased AFTER INSERT ON origen_closed_accounts FOR EACH ROW EXECUTE FUNCTION origen_outcome_observation_author_erased();

DO $$ DECLARE d text; anchor text:='RETURN result||jsonb_build_object(''coordinatorProfiles'''; BEGIN
 d:=pg_get_functiondef('origen_coordinator_export()'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_export'; END IF;
 d:=replace(d,anchor,$patch$RETURN result||jsonb_build_object('outcomeObservations',coalesce((SELECT jsonb_agg(origen_outcome_observation_view(id,false)) FROM origen_outcome_observations WHERE author_subject=current_setting('origen.subject',true) AND origen_review_request_live(request_id)),'[]'::jsonb))||jsonb_build_object('coordinatorProfiles'$patch$);EXECUTE d;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND (proname LIKE 'origen_outcome_%' OR proname IN ('origen_coordinator_outcome_command','origen_student_outcome_observation_command')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.oid::regprocedure);EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f.oid::regprocedure,current_schema());
 END LOOP;
END $$;
-- The current request cards discover published observations without inspecting
-- private disputes or outcome-report tables.
DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_coordinator_review_command(jsonb)'::regprocedure);
 anchor:='''openedAt'',pub.opened_at,''reviewedAt'',pub.reviewed_at,''response'',';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_coordinator_card'; END IF;
 EXECUTE replace(d,anchor,'''outcomeObservationCount'',(SELECT count(*) FROM origen_outcome_observations WHERE request_id=r.id),'||anchor);
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 anchor:='''coordinatorReview'',jsonb_build_object(';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_student_card'; END IF;
 EXECUTE replace(d,anchor,'''outcomeObservationCount'',(SELECT count(*) FROM origen_outcome_observations WHERE request_id=r.id),'||anchor);
END $$;

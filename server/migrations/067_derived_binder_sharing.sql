-- Student-first Phase 7. No historic eligibility or sharing backfill.
-- This flag is evidence of authenticated student scope, not a content classifier.
ALTER TABLE origen_conversation_summaries ADD COLUMN sharing_student_scope boolean NOT NULL DEFAULT false;
CREATE FUNCTION origen_capture_sharing_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.sharing_student_scope:=NEW.student_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM origen_accounts a WHERE a.id=NEW.account_id AND a.role='student'
   AND a.auth0_subject=current_setting('origen.subject',true) AND current_setting('origen.purpose',true)='account');
 ELSE
  -- Editing or moving a source never certifies its new contents retroactively.
  NEW.sharing_student_scope:=OLD.sharing_student_scope AND NEW.summary=OLD.summary
   AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id AND NEW.account_id=OLD.account_id
   AND NEW.organization_reported_by=OLD.organization_reported_by;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_sharing_scope BEFORE INSERT OR UPDATE ON origen_conversation_summaries FOR EACH ROW EXECUTE FUNCTION origen_capture_sharing_scope();

-- Memories use the existing dependency graph and invalidation cascade. Their
-- lineage remains unknown: a selected derived excerpt is not a certified source.
ALTER TABLE origen_binder_source_lineage DROP CONSTRAINT origen_binder_source_lineage_source_kind_check;
ALTER TABLE origen_binder_source_lineage ADD CHECK(source_kind IN ('summary','note','memory'));
CREATE FUNCTION origen_binder_track_memory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE source uuid; parent_source uuid; label text;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM origen_binder_source_lineage WHERE account_id=OLD.account_id AND source_kind='memory' AND source_id=OLD.id::text;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 SELECT id,classification INTO parent_source,label FROM origen_binder_source_lineage
 WHERE account_id=NEW.account_id AND source_kind='summary' AND source_id=NEW.source_summary_id;
 INSERT INTO origen_binder_source_lineage(account_id,student_id,source_kind,source_id,classification,source_version,source_digest)
 VALUES(NEW.account_id,NEW.student_id,'memory',NEW.id::text,origen_binder_restrict_classification('unknown',coalesce(label,'unknown')),NEW.version,encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'))
 ON CONFLICT(account_id,source_kind,source_id) DO UPDATE SET
 classification=origen_binder_restrict_classification(origen_binder_source_lineage.classification,EXCLUDED.classification),
 complete=false,revision=origen_binder_source_lineage.revision+1,source_version=EXCLUDED.source_version,source_digest=EXCLUDED.source_digest,updated_at=now()
 RETURNING id INTO source;
 IF parent_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges WHERE account_id=NEW.account_id AND derived_id=source AND source_id=parent_source) THEN
  INSERT INTO origen_binder_source_edges VALUES(NEW.account_id,source,parent_source);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_memory_source AFTER INSERT OR UPDATE OR DELETE ON origen_student_memories FOR EACH ROW EXECUTE FUNCTION origen_binder_track_memory();

-- Defense in depth, deliberately conservative English/Spanish screening of the
-- whole source. This is a bounded exclusion policy, not semantic certification.
CREATE FUNCTION origen_derived_sharing_text_allowed(value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT length(value) BETWEEN 8 AND 20000 AND value !~* '(family|parent|mother|father|sibling|brother|sister|guardian|familia|madre|padre|herman[oa]|tutor|diagnos|diagnóst|medical|médic|health|salud|disabil|discapaci|immigra|inmigra|undocumented|indocument|social security|seguro social|income|ingresos|salary|salario|passport|pasaporte|password|contraseña|abuse|abuso|violence|violencia|suicid|sexual|pregnan|embaraz|religio|ethnic|étnic|race|racial|citizenship|ciudadanía|\mSSN\M|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{3}[- .]?[0-9]{2}[- .]?[0-9]{4}|[0-9]{3}[- .]?[0-9]{3}[- .]?[0-9]{4}|[0-9]{4,}|OR-[A-Z0-9-]+)'
$$;

CREATE FUNCTION origen_binder_derived_entries(owner uuid,student text)
RETURNS TABLE(id uuid,topic text,kind text,language text,content text,lineage_id uuid,lineage_revision integer,source_version integer,source_digest text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 WITH items AS (
  SELECT n.id,n.topic,n.kind,n.language,n.content,n.version,n.source_summary_id,n.source_quote,n.organization,'note' AS store,
   encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex') AS digest
  FROM origen_topic_notes n WHERE n.account_id=owner AND n.student_id=student AND n.status IN ('suggested','saved')
   AND n.origin='conversation' AND n.restored_from IS NULL AND NOT n.context_current
  UNION ALL
  SELECT m.id,m.organization->>'topic','note',m.language,m.content,m.version,m.source_summary_id,m.source_quote,m.organization,'memory',
   encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')
  FROM origen_student_memories m WHERE m.account_id=owner AND m.student_id=student AND m.status IN ('proposed','confirmed')
   AND m.reported_by='student' AND m.speaker='student' AND m.last_action IN ('propose','confirm')
 )
 SELECT i.id,i.topic,i.kind,i.language,
  CASE WHEN i.language='es' THEN 'De un resumen de conversación con el estudiante; no es una cita literal. '
   ELSE 'From a student conversation summary; not a verbatim quote. ' END ||
  CASE i.organization->>'certainty'
   WHEN 'tentative' THEN CASE WHEN i.language='es' THEN 'Posibilidad, no una decisión: ' ELSE 'Tentative, not a decision: ' END
   WHEN 'unresolved' THEN CASE WHEN i.language='es' THEN 'Pregunta pendiente: ' ELSE 'Open question: ' END
   ELSE CASE WHEN i.language='es' THEN 'Información reportada, sin verificación independiente: ' ELSE 'Reported, not independently verified: ' END END || i.content,
  l.id,l.revision,i.version,l.source_digest
 FROM items i
 JOIN origen_conversation_summaries s ON s.account_id=owner AND s.student_id=student AND s.id=i.source_summary_id
 JOIN origen_binder_source_lineage root ON root.account_id=owner AND root.student_id=student AND root.source_kind='summary' AND root.source_id=s.id
 JOIN origen_binder_source_lineage l ON l.account_id=owner AND l.student_id=student AND l.source_kind=i.store AND l.source_id=i.id::text
 WHERE current_setting('origen.derived_sharing',true)='true'
 AND s.sharing_student_scope AND s.organization_reported_by='student'
 AND root.active AND root.classification='unknown' AND l.active AND l.classification='unknown'
 AND root.source_digest=encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex')
 AND l.source_version=i.version AND l.source_digest=i.digest
 AND i.organization->>'version'='binder-organization-v1' AND i.organization->>'reportedBy'='student'
 AND i.organization->>'evidenceKind'='saved_summary'
 AND i.organization->>'sourceVersion'=encode(sha256(convert_to(to_jsonb(s.summary)::text,'UTF8')),'hex')
 AND i.organization->>'certainty' IN ('tentative','stated','unresolved')
 AND i.topic IN ('options','transfer','costs','applications') AND i.language IN ('en','es')
 AND length(i.content) BETWEEN 8 AND 1000 AND i.content=i.source_quote AND strpos(s.summary,i.content)>0
 AND origen_derived_sharing_text_allowed(s.summary)
 AND EXISTS(SELECT 1 FROM origen_binder_source_edges e WHERE e.account_id=owner AND e.derived_id=l.id AND e.source_id=root.id)
 AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges e WHERE e.account_id=owner AND (e.derived_id=root.id OR e.derived_id=l.id AND e.source_id<>root.id))
 AND NOT EXISTS(SELECT 1 FROM origen_memory_batches b WHERE b.account_id=owner AND b.summary_id=s.id AND b.suppressed)
 AND NOT EXISTS(SELECT 1 FROM origen_summary_segments x JOIN origen_guidance_segments seg ON seg.account_id=x.account_id AND seg.id=x.segment_id
  JOIN origen_guidance_sessions session ON session.account_id=seg.account_id AND session.id=seg.session_id
  WHERE x.account_id=owner AND x.summary_id=s.id AND (session.actor_role<>'student' OR seg.target_kind<>'student' OR seg.student_id IS DISTINCT FROM student))
$$;

CREATE OR REPLACE FUNCTION origen_binder_eligible_entries(owner uuid, student text)
RETURNS TABLE(id uuid,topic text,kind text,language text,content text,lineage_id uuid,lineage_revision integer,source_version integer,source_digest text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT n.id,n.topic,n.kind,n.language,n.content,l.id,l.revision,n.version,l.source_digest
 FROM origen_topic_notes n JOIN origen_binder_source_lineage l ON l.account_id=n.account_id AND l.source_kind='note' AND l.source_id=n.id::text
 WHERE n.account_id=owner AND n.student_id=student AND n.status='saved' AND n.origin='user' AND n.source_summary_id IS NULL
 AND l.student_id=student AND l.classification='student_only' AND l.complete AND l.active AND l.source_version=n.version
 AND l.source_digest=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex')
 AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges e WHERE e.account_id=owner AND e.derived_id=l.id)
 UNION ALL SELECT * FROM origen_binder_derived_entries(owner,student)
$$;

CREATE OR REPLACE FUNCTION origen_binder_validate_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE source origen_binder_source_lineage%ROWTYPE; n origen_topic_notes%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.withdrawn_at IS NOT NULL AND NEW.content='' THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM origen_binder_derived_entries(NEW.account_id,NEW.student_id) e
  WHERE e.lineage_id=NEW.lineage_id AND e.lineage_revision=NEW.lineage_revision AND e.source_version=NEW.source_version
  AND e.source_digest=NEW.source_digest AND e.topic=NEW.topic AND e.kind=NEW.kind AND e.language=NEW.language AND e.content=NEW.content) THEN RETURN NEW; END IF;
 SELECT * INTO source FROM origen_binder_source_lineage WHERE account_id=NEW.account_id AND student_id=NEW.student_id AND id=NEW.lineage_id FOR SHARE;
 IF NOT FOUND OR source.source_kind<>'note' OR source.classification<>'student_only' OR NOT source.complete OR NOT source.active OR source.revision<>NEW.lineage_revision OR source.source_version<>NEW.source_version OR source.source_digest<>NEW.source_digest THEN RAISE EXCEPTION 'binder_private_source' USING ERRCODE='23514'; END IF;
 IF EXISTS(WITH RECURSIVE ancestors(id) AS (
  SELECT e.source_id FROM origen_binder_source_edges e WHERE e.account_id=NEW.account_id AND e.derived_id=source.id
  UNION SELECT e.source_id FROM origen_binder_source_edges e JOIN ancestors a ON e.derived_id=a.id WHERE e.account_id=NEW.account_id
 ) SELECT 1 FROM ancestors a JOIN origen_binder_source_lineage l ON l.account_id=NEW.account_id AND l.id=a.id
  WHERE l.student_id IS DISTINCT FROM NEW.student_id OR l.classification<>'student_only' OR NOT l.complete OR NOT l.active) THEN RAISE EXCEPTION 'binder_private_source' USING ERRCODE='23514'; END IF;
 SELECT * INTO n FROM origen_topic_notes WHERE account_id=NEW.account_id AND id=source.source_id::uuid;
 IF NOT FOUND OR n.status<>'saved' OR n.student_id IS DISTINCT FROM NEW.student_id OR n.version<>NEW.source_version OR n.content<>NEW.content OR n.topic<>NEW.topic OR n.kind<>NEW.kind OR n.language<>NEW.language OR encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex')<>NEW.source_digest THEN RAISE EXCEPTION 'binder_source_changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION origen_binder_sharing_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action'; student text:=input->>'studentId';
 owner uuid; enabled boolean:=input->>'enabled'='true'; eligible boolean; result jsonb; entries jsonb; refs jsonb; topics text[]; ids uuid[];
 c origen_binder_connections%ROWTYPE; p origen_coordinator_profiles%ROWTYPE; org origen_institutions%ROWTYPE; orgpilot origen_coordinator_organizations%ROWTYPE;
 g origen_binder_share_grants%ROWTYPE; card origen_binder_previews%ROWTYPE; pub origen_binder_publications%ROWTYPE;
 permission integer; student_name text; digest text; item record; version integer;
BEGIN
 PERFORM set_config('origen.derived_sharing',CASE WHEN input->>'derivedEnabled'='true' THEN 'true' ELSE 'false' END,true);
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"sharing_denied"}'; END IF;
 -- Same lock order as account closure and ordinary note edits.
 INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
 IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR UPDATE;
 SELECT name INTO student_name FROM origen_students WHERE account_id=owner AND id=student;
 IF owner IS NULL OR student_name IS NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;
 -- Stop controls are ownership-gated, independent of rollout/pilot/age status.
 IF action='cancel' THEN
  SELECT * INTO card FROM origen_binder_previews WHERE account_id=owner AND student_id=student AND id=(input->>'previewId')::uuid;
  IF card.publication_id IS NOT NULL THEN RETURN jsonb_build_object('status','published','publicationId',card.publication_id); END IF;
  DELETE FROM origen_binder_previews WHERE account_id=owner AND student_id=student AND id=(input->>'previewId')::uuid;
  RETURN '{"status":"cancelled"}';
 END IF;
 IF action='revoke-all' THEN
  DELETE FROM origen_binder_previews WHERE account_id=owner AND student_id=student;
  FOR g IN SELECT * FROM origen_binder_share_grants WHERE account_id=owner AND student_id=student AND status<>'revoked' ORDER BY id FOR UPDATE LOOP
   UPDATE origen_binder_share_grants SET status='revoked',revoked_at=clock_timestamp(),revision=revision+1 WHERE id=g.id;
   INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id) VALUES(owner,g.id,encode(sha256(convert_to(actor,'UTF8')),'hex'),'revoke','completed','coordinator-sharing-v1',g.revision+1,gen_random_uuid());
  END LOOP;
  RETURN '{"status":"revoked"}';
 END IF;
 IF action IN ('revoke','withdraw','remove-topic') THEN
  SELECT * INTO g FROM origen_binder_share_grants WHERE id=(input->>'grantId')::uuid AND account_id=owner AND student_id=student FOR UPDATE;
  IF g.id IS NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;
  IF action='revoke' AND g.status='revoked' OR action='remove-topic' AND NOT (input->>'topic'=ANY(g.topics)) THEN RETURN '{"status":"withdrawn"}'; END IF;
  IF action='withdraw' AND EXISTS(SELECT 1 FROM origen_binder_publication_items WHERE id=(input->>'itemId')::uuid AND grant_id=g.id AND withdrawn_at IS NOT NULL) THEN RETURN '{"status":"withdrawn"}'; END IF;
  IF action='revoke' OR action='remove-topic' AND cardinality(array_remove(g.topics,input->>'topic'))=0 THEN
   UPDATE origen_binder_share_grants SET status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),revision=revision+1 WHERE id=g.id;
  ELSE
   IF action='withdraw' THEN
    IF NOT EXISTS(SELECT 1 FROM origen_binder_publication_items WHERE id=(input->>'itemId')::uuid AND grant_id=g.id) THEN RETURN '{"error":"sharing_denied"}'; END IF;
    UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,clock_timestamp()) WHERE id=(input->>'itemId')::uuid AND grant_id=g.id;
   ELSE
    UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,clock_timestamp()) WHERE grant_id=g.id AND topic=input->>'topic';
   END IF;
   UPDATE origen_binder_share_grants SET revision=revision+1,topics=CASE WHEN action='remove-topic' THEN array_remove(g.topics,input->>'topic') ELSE g.topics END WHERE id=g.id;
   UPDATE origen_binder_publications SET grant_revision=g.revision+1 WHERE id=g.current_publication_id;
  END IF;
  INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id) VALUES(owner,g.id,encode(sha256(convert_to(actor,'UTF8')),'hex'),CASE WHEN action='revoke' THEN 'revoke' ELSE 'withdraw' END,'completed','coordinator-sharing-v1',g.revision+1,gen_random_uuid());
  RETURN '{"status":"withdrawn"}';
 END IF;
 PERFORM 1 FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
 PERFORM 1 FROM origen_coordinator_student_pilots WHERE account_id=owner AND student_id=student FOR SHARE;
 eligible:=origen_coordinator_student_ready(owner,student);
 IF action='status' THEN
  -- No shared text is returned while paused. Revocation metadata stays visible.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',sg.id,'connectionId',sg.connection_id,'coordinatorName',cp.display_name,'organizationName',i.draft->>'name',
   'status',CASE WHEN origen_binder_grant_live(sg.id) THEN 'active' WHEN sg.status='active' THEN 'unavailable' ELSE sg.status END,'topics',sg.topics,'expiresAt',sg.expires_at,
   'items',CASE WHEN enabled AND origen_binder_grant_live(sg.id) THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'topic',x.topic,'content',x.content) ORDER BY x.id),'[]') FROM origen_binder_publication_items x JOIN origen_binder_publications b ON b.id=x.publication_id JOIN origen_binder_eligible_entries(owner,student) e ON e.lineage_id=x.lineage_id AND e.lineage_revision=x.lineage_revision AND e.source_version=x.source_version AND e.source_digest=x.source_digest WHERE x.publication_id=sg.current_publication_id AND b.invalidated_at IS NULL AND b.grant_revision=sg.revision AND x.withdrawn_at IS NULL AND x.topic=ANY(sg.topics)) ELSE '[]'::jsonb END) ORDER BY sg.created_at DESC),'[]') INTO result
   FROM origen_binder_share_grants sg JOIN origen_coordinator_profiles cp ON cp.id=sg.coordinator_id JOIN origen_institutions i ON i.id=cp.institution_id WHERE sg.account_id=owner AND sg.student_id=student;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',cn.id,'coordinatorName',cp.display_name,'organizationName',i.draft->>'name') ORDER BY cn.created_at),'[]') INTO entries
   FROM origen_binder_connections cn JOIN origen_coordinator_profiles cp ON cp.id=cn.coordinator_id JOIN origen_institutions i ON i.id=cp.institution_id JOIN origen_coordinator_organizations o ON o.institution_id=i.id
   WHERE cn.account_id=owner AND cn.student_id=student AND cn.status='accepted' AND cp.status='active' AND o.status='active' AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL AND eligible AND enabled;
  RETURN jsonb_build_object('available',coalesce(eligible AND enabled,false) OR jsonb_array_length(result)>0,'enabled',coalesce(eligible AND enabled,false),'grants',result,'connections',entries);
 END IF;
 IF NOT coalesce(enabled,false) THEN RETURN '{"error":"sharing_paused"}'; END IF;
 IF NOT eligible THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT revision INTO permission FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
 IF action='entries' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'topic',topic,'kind',kind,'language',language,'content',content) ORDER BY topic,id),'[]') INTO entries FROM origen_binder_eligible_entries(owner,student);
  RETURN jsonb_build_object('entries',entries);
 END IF;
 IF action NOT IN ('preview','publish') THEN RETURN '{"error":"sharing_denied"}'; END IF;
 IF action='publish' THEN
  IF input->>'confirmed' IS DISTINCT FROM 'true' THEN RETURN '{"error":"sharing_denied"}'; END IF;
  SELECT * INTO card FROM origen_binder_previews WHERE account_id=owner AND student_id=student AND id=(input->>'previewId')::uuid FOR UPDATE;
  IF card.id IS NULL THEN RETURN '{"error":"sharing_changed"}'; END IF;
 END IF;
 SELECT * INTO c FROM origen_binder_connections WHERE account_id=owner AND student_id=student AND id=CASE WHEN action='preview' THEN (input->>'connectionId')::uuid ELSE card.connection_id END;
 IF c.id IS NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT i.* INTO org FROM origen_institutions i JOIN origen_coordinator_profiles cp ON cp.institution_id=i.id WHERE cp.id=c.coordinator_id FOR UPDATE OF i;
 SELECT * INTO p FROM origen_coordinator_profiles WHERE id=c.coordinator_id FOR SHARE;
 SELECT * INTO orgpilot FROM origen_coordinator_organizations WHERE institution_id=org.id FOR SHARE;
 PERFORM 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=p.auth0_subject FOR SHARE;
 IF NOT FOUND OR c.status<>'accepted' OR p.status<>'active' OR orgpilot.status IS DISTINCT FROM 'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT * INTO c FROM origen_binder_connections WHERE id=c.id FOR UPDATE;
 IF c.status<>'accepted' THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT * INTO g FROM origen_binder_share_grants WHERE connection_id=c.id FOR UPDATE;
 IF action='publish' AND card.publication_id IS NOT NULL THEN
  IF g.current_publication_id=card.publication_id AND origen_binder_grant_live(g.id) AND card.grant_revision=g.revision THEN RETURN jsonb_build_object('status','published','publicationId',card.publication_id); END IF;
  RETURN '{"error":"sharing_changed"}';
 END IF;
 IF action='preview' THEN
  topics:=ARRAY(SELECT DISTINCT jsonb_array_elements_text(input->'topics') ORDER BY 1);
  ids:=ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(input->'entryIds') ORDER BY 1);
  IF cardinality(topics) NOT BETWEEN 1 AND 4 OR NOT topics<@ARRAY['options','transfer','costs','applications']::text[] OR cardinality(ids) NOT BETWEEN 1 AND 50 THEN RETURN '{"error":"sharing_denied"}'; END IF;
 ELSE
  IF card.expires_at<=clock_timestamp() OR card.grant_revision<>coalesce(g.revision,0) OR card.permission_revision<>permission OR card.coordinator_revision<>p.revision OR card.connection_revision<>c.revision OR card.organization_revision<>orgpilot.revision OR card.coordinator_name<>p.display_name OR card.organization_name IS DISTINCT FROM org.draft->>'name' OR card.student_name<>student_name THEN RETURN '{"error":"sharing_changed"}'; END IF;
  topics:=card.topics;ids:=ARRAY(SELECT (value->>'id')::uuid FROM jsonb_array_elements(card.source_refs));
 END IF;
 -- Lock the actual sources before reading versions; normal edits also lock the
 -- account. Lineage locks cover late privacy attribution from other pipelines.
 PERFORM 1 FROM origen_student_memories WHERE account_id=owner AND id=ANY(ids) ORDER BY id,version FOR SHARE;
 PERFORM 1 FROM origen_topic_notes WHERE account_id=owner AND id=ANY(ids) ORDER BY id FOR SHARE;
 PERFORM 1 FROM origen_binder_source_lineage WHERE account_id=owner AND source_kind IN ('note','memory') AND source_id=ANY(ARRAY(SELECT unnest(ids)::text)) ORDER BY id FOR SHARE;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'lineageId',lineage_id,'lineageRevision',lineage_revision,'version',source_version,'digest',source_digest) ORDER BY id),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('id',id,'topic',topic,'kind',kind,'language',language,'content',content) ORDER BY id),'[]') INTO refs,entries
 FROM origen_binder_eligible_entries(owner,student) WHERE id=ANY(ids) AND topic=ANY(topics);
 IF jsonb_array_length(refs)<>cardinality(ids) THEN RETURN '{"error":"sharing_changed"}'; END IF;
 IF action='publish' AND refs<>card.source_refs THEN RETURN '{"error":"sharing_changed"}'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('connection',c.id,'topics',topics,'refs',refs,'policy','coordinator-sharing-v1')::text,'UTF8')),'hex');
 IF action='preview' THEN
  DELETE FROM origen_binder_previews WHERE account_id=owner AND (expires_at<clock_timestamp() OR student_id=student);
  INSERT INTO origen_binder_previews(account_id,student_id,connection_id,grant_revision,permission_revision,coordinator_revision,connection_revision,organization_revision,coordinator_name,organization_name,student_name,topics,source_refs,preview_digest)
  VALUES(owner,student,c.id,coalesce(g.revision,0),permission,p.revision,c.revision,orgpilot.revision,p.display_name,org.draft->>'name',student_name,topics,refs,digest) RETURNING * INTO card;
  RETURN jsonb_build_object('previewId',card.id,'coordinatorName',card.coordinator_name,'organizationName',card.organization_name,'studentName',student_name,'topics',topics,'entries',entries,'expiresAt',card.expires_at,'shareExpiresAt',card.share_expires_at);
 END IF;
 IF digest<>card.preview_digest THEN RETURN '{"error":"sharing_changed"}'; END IF;
 -- Delete the current card only after its trusted data has been copied above.
 -- The grant trigger invalidates every other preview when its revision changes.
 IF g.id IS NULL THEN
  INSERT INTO origen_binder_share_grants(account_id,student_id,coordinator_id,connection_id,grantor_subject,topics,permission_revision,coordinator_revision,connection_revision,notice_version,expires_at)
  VALUES(owner,student,p.id,c.id,actor,topics,permission,p.revision,c.revision,'coordinator-sharing-v1',card.share_expires_at) RETURNING * INTO g;
 ELSE
  UPDATE origen_binder_share_grants SET topics=card.topics,status='active',revoked_at=NULL,revision=revision+1,permission_revision=permission,coordinator_revision=p.revision,connection_revision=c.revision,expires_at=card.share_expires_at WHERE id=g.id RETURNING * INTO g;
 END IF;
 SELECT coalesce(max(b.version),0)+1 INTO version FROM origen_binder_publications b WHERE b.grant_id=g.id;
 INSERT INTO origen_binder_publications(account_id,student_id,grant_id,version,grant_revision,preview_digest,confirmation_id,confirmed_by,policy_version,student_name)
 VALUES(owner,student,g.id,version,g.revision,digest,card.id,actor,'coordinator-sharing-v1',card.student_name) RETURNING * INTO pub;
 FOR item IN SELECT * FROM origen_binder_eligible_entries(owner,student) WHERE id=ANY(ids) LOOP
  INSERT INTO origen_binder_publication_items(account_id,student_id,grant_id,publication_id,lineage_id,lineage_revision,source_version,source_digest,topic,kind,language,content)
  VALUES(owner,student,g.id,pub.id,item.lineage_id,item.lineage_revision,item.source_version,item.source_digest,item.topic,item.kind,item.language,item.content);
 END LOOP;
 UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,now()) WHERE grant_id=g.id AND publication_id<>pub.id AND withdrawn_at IS NULL;
 UPDATE origen_binder_publications SET invalidated_at=coalesce(invalidated_at,now()) WHERE grant_id=g.id AND id<>pub.id;
 UPDATE origen_binder_share_grants SET current_publication_id=pub.id WHERE id=g.id;
 -- Short-lived replay receipt: no new content and no renewal on duplicate calls.
 card.publication_id:=pub.id;card.grant_revision:=g.revision;
 DELETE FROM origen_binder_previews WHERE id=card.id;
 INSERT INTO origen_binder_previews SELECT (card).*;
 INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id) VALUES(owner,g.id,encode(sha256(convert_to(actor,'UTF8')),'hex'),'publish','completed','coordinator-sharing-v1',g.revision,card.id);
 RETURN jsonb_build_object('status','published','publicationId',pub.id);
END $$;

CREATE OR REPLACE FUNCTION origen_coordinator_binder_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 org origen_institutions%ROWTYPE; p origen_coordinator_profiles%ROWTYPE; row record; rows jsonb; counts jsonb; contents jsonb;
 cursor_id uuid:=(input->>'cursor')::uuid; query text:=coalesce(input->>'search',''); view_name text:=coalesce(input->>'view','all'); page_size integer:=10;
BEGIN
 PERFORM set_config('origen.derived_sharing',CASE WHEN input->>'derivedEnabled'='true' THEN 'true' ELSE 'false' END,true);
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR coalesce(current_setting('origen.coordinator_verified',true),'false')<>'true'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after)))
 THEN RETURN '{"error":"binder_access_denied"}'; END IF;
 IF action NOT IN ('list','read','review') OR view_name NOT IN ('all','new','help') OR length(query)>80 THEN RETURN '{"error":"binder_access_denied"}'; END IF;
 -- Shared lock orders this request with organization suspension and staff removal.
 SELECT * INTO org FROM origen_institutions WHERE id=(input->>'organizationId')::uuid FOR SHARE;
 SELECT * INTO p FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor FOR SHARE;
 IF p.id IS NULL OR p.status<>'active' OR org.verification_status<>'verified' OR org.archived_at IS NOT NULL OR org.parent_approval<>'approved'
 OR NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations WHERE institution_id=org.id AND status='active')
 OR NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=actor) THEN RETURN '{"error":"binder_access_denied"}'; END IF;
 -- Revocation and publication cannot complete midway through this response.
 -- Re-evaluate using a fresh statement snapshot after any lock wait.
 PERFORM 1 FROM origen_binder_share_grants WHERE coordinator_id=p.id AND (action='list' OR id=(input->>'grantId')::uuid) ORDER BY id FOR SHARE;
 IF action='list' THEN
  IF cursor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_binder_share_grants WHERE id=cursor_id AND coordinator_id=p.id) THEN RETURN '{"error":"binder_unavailable"}'; END IF;
  WITH visible AS MATERIALIZED (SELECT * FROM origen_coordinator_visible_binders(p.id) v WHERE strpos(lower(v.student_name),lower(query))>0),
  page AS (SELECT * FROM visible WHERE (cursor_id IS NULL OR id>cursor_id) AND (view_name='all' OR view_name='new' AND is_new OR view_name='help' AND help_requested) ORDER BY id LIMIT page_size+1)
  SELECT (SELECT jsonb_build_object('all',count(*),'new',count(*) FILTER(WHERE is_new),'help',count(*) FILTER(WHERE help_requested)) FROM visible),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'studentName',student_name,'publicationId',publication_id,'version',version,'publishedAt',published_at,'expiresAt',expires_at,'topics',topics,'isNew',is_new,'helpRequested',help_requested) ORDER BY id),'[]') FROM page)
  INTO counts,rows;
  RETURN jsonb_build_object('counts',counts,'binders',CASE WHEN jsonb_array_length(rows)>page_size THEN rows-(page_size) ELSE rows END,'nextCursor',CASE WHEN jsonb_array_length(rows)>page_size THEN rows->(page_size-1)->>'id' ELSE NULL END);
 END IF;
 SELECT * INTO row FROM origen_coordinator_visible_binders(p.id) v WHERE v.id=(input->>'grantId')::uuid;
 IF NOT FOUND THEN RETURN '{"error":"binder_unavailable"}'; END IF;
 IF action='review' THEN
  IF row.publication_id IS DISTINCT FROM (input->>'publicationId')::uuid THEN RETURN '{"error":"binder_changed"}'; END IF;
  INSERT INTO origen_binder_reviews(grant_id,publication_id) VALUES(row.id,row.publication_id) ON CONFLICT(grant_id) DO UPDATE SET publication_id=excluded.publication_id,reviewed_at=clock_timestamp();
  RETURN '{"status":"reviewed"}';
 END IF;
 -- Content is read only for the single authorized publication, never for lists.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'topic',x.topic,'kind',x.kind,'language',x.language,'content',x.content) ORDER BY x.topic,x.id),'[]') INTO contents
 FROM origen_binder_share_grants g JOIN origen_binder_publication_items x ON x.grant_id=g.id AND x.publication_id=g.current_publication_id AND x.account_id=g.account_id AND x.student_id=g.student_id
 JOIN origen_binder_eligible_entries(g.account_id,g.student_id) e ON e.lineage_id=x.lineage_id AND e.lineage_revision=x.lineage_revision AND e.source_version=x.source_version AND e.source_digest=x.source_digest
 WHERE g.id=row.id AND x.publication_id=row.publication_id AND x.withdrawn_at IS NULL AND x.topic=ANY(g.topics);
 INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id)
 SELECT account_id,id,encode(sha256(convert_to(actor,'UTF8')),'hex'),'read','completed','coordinator-sharing-v1',revision,gen_random_uuid() FROM origen_binder_share_grants WHERE id=row.id;
 RETURN jsonb_build_object('id',row.id,'studentName',row.student_name,'publicationId',row.publication_id,'version',row.version,'publishedAt',row.published_at,'expiresAt',row.expires_at,'topics',row.topics,'isNew',row.is_new,'helpRequested',row.help_requested,'entries',contents);
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_capture_sharing_scope()','origen_binder_track_memory()','origen_derived_sharing_text_allowed(text)','origen_binder_derived_entries(uuid,text)','origen_binder_eligible_entries(uuid,text)','origen_binder_validate_item()','origen_binder_sharing_command(jsonb)','origen_coordinator_binder_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

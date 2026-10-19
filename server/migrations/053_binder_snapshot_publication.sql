-- Phase 4: student-only preview/publication. No coordinator read capability.
CREATE TABLE origen_binder_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, student_id text NOT NULL,
 connection_id uuid NOT NULL REFERENCES origen_binder_connections(id) ON DELETE CASCADE,
 grant_revision integer NOT NULL, permission_revision integer NOT NULL,
 coordinator_revision integer NOT NULL, connection_revision integer NOT NULL, organization_revision integer NOT NULL,
 coordinator_name text NOT NULL, organization_name text NOT NULL, student_name text NOT NULL,
 topics text[] NOT NULL, source_refs jsonb NOT NULL, preview_digest text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 share_expires_at timestamptz NOT NULL DEFAULT now()+interval '2160 hours',
 publication_id uuid REFERENCES origen_binder_publications(id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_binder_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_binder_previews FROM PUBLIC;
CREATE INDEX origen_binder_previews_owner ON origen_binder_previews(account_id,student_id);

-- Certify only new, explicit manual notes created in an approved student scope.
-- Existing unknown notes and all conversation derivations stay private. Edits
-- preserve evidence only while the previous version was already certified.
CREATE OR REPLACE FUNCTION origen_binder_track_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE k text; label text; actor text; subject text; source uuid; parent_source uuid; note_version integer; digest text; certified boolean:=false;
BEGIN
 k:=CASE WHEN TG_TABLE_NAME='origen_topic_notes' THEN 'note' ELSE 'summary' END;
 IF TG_OP='DELETE' THEN
  DELETE FROM origen_binder_source_lineage WHERE account_id=OLD.account_id AND source_kind=k AND source_id=OLD.id::text;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 SELECT role,auth0_subject INTO actor,subject FROM origen_accounts WHERE id=NEW.account_id;
 label:=CASE WHEN NEW.student_id IS NULL THEN 'family' WHEN actor='parent' THEN 'parent' ELSE 'unknown' END;
 note_version:=CASE WHEN k='note' THEN (to_jsonb(NEW)->>'version')::integer ELSE 1 END;
 digest:=encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex');
 IF k='note' THEN
  IF NEW.source_summary_id IS NOT NULL THEN
   SELECT id,origen_binder_restrict_classification(label,classification) INTO parent_source,label FROM origen_binder_source_lineage
    WHERE account_id=NEW.account_id AND source_kind='summary' AND source_id=NEW.source_summary_id;
   label:=coalesce(label,'unknown');
  ELSIF NEW.origin='user' AND NEW.status='saved' AND coalesce(NEW.source_quote,'')='' AND actor='student'
   AND current_setting('origen.subject',true)=subject AND current_setting('origen.purpose',true)='account'
   AND origen_coordinator_student_ready(NEW.account_id,NEW.student_id) THEN
   certified:=TG_OP='INSERT' OR EXISTS(SELECT 1 FROM origen_binder_source_lineage l WHERE l.account_id=NEW.account_id AND l.student_id=NEW.student_id AND l.source_kind='note' AND l.source_id=NEW.id::text AND l.classification='student_only' AND l.complete AND l.active
    AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges e WHERE e.account_id=l.account_id AND e.derived_id=l.id));
   IF certified THEN label:='student_only'; END IF;
  END IF;
 END IF;
 INSERT INTO origen_binder_source_lineage(account_id,student_id,source_kind,source_id,classification,complete,source_version,source_digest)
 VALUES(NEW.account_id,NEW.student_id,k,NEW.id::text,label,certified,note_version,digest)
 ON CONFLICT(account_id,source_kind,source_id) DO UPDATE SET
  classification=origen_binder_restrict_classification(origen_binder_source_lineage.classification,EXCLUDED.classification),
  complete=certified,revision=origen_binder_source_lineage.revision+1,source_version=EXCLUDED.source_version,source_digest=EXCLUDED.source_digest,updated_at=now()
 RETURNING id INTO source;
 IF parent_source IS NOT NULL THEN INSERT INTO origen_binder_source_edges VALUES(NEW.account_id,source,parent_source) ON CONFLICT DO NOTHING; END IF;
 RETURN NEW;
END $$;

-- A single filter is used for discovery, preview, and publication. Nothing
-- protected (including its text or a text-derived digest) enters the preview.
CREATE FUNCTION origen_binder_eligible_entries(owner uuid, student text)
RETURNS TABLE(id uuid,topic text,kind text,language text,content text,lineage_id uuid,lineage_revision integer,source_version integer,source_digest text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT n.id,n.topic,n.kind,n.language,n.content,l.id,l.revision,n.version,l.source_digest
 FROM origen_topic_notes n JOIN origen_binder_source_lineage l ON l.account_id=n.account_id AND l.source_kind='note' AND l.source_id=n.id::text
 WHERE n.account_id=owner AND n.student_id=student AND n.status='saved' AND n.origin='user' AND n.source_summary_id IS NULL
 AND l.student_id=student AND l.classification='student_only' AND l.complete AND l.active AND l.source_version=n.version
 AND l.source_digest=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex')
 AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges e WHERE e.account_id=owner AND e.derived_id=l.id)
$$;

CREATE FUNCTION origen_binder_grant_live(grant_uuid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM origen_binder_share_grants g
 JOIN origen_accounts a ON a.id=g.account_id
 JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
 JOIN origen_binder_connections c ON c.id=g.connection_id
 JOIN origen_coordinator_profiles p ON p.id=g.coordinator_id
 JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id
 JOIN origen_institutions i ON i.id=p.institution_id
 JOIN origen_institution_members m ON m.institution_id=p.institution_id AND m.auth0_subject=p.auth0_subject
 WHERE g.id=grant_uuid AND g.status='active' AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
 AND g.grantor_subject=a.auth0_subject AND origen_coordinator_student_ready(a.id,g.student_id) AND e.revision=g.permission_revision
 AND c.status='accepted' AND c.revision=g.connection_revision AND p.status='active' AND p.revision=g.coordinator_revision
 AND o.status='active' AND i.verification_status='verified' AND i.archived_at IS NULL AND i.parent_approval='approved'
 AND NOT EXISTS(SELECT 1 FROM origen_staff_access_controls s WHERE s.subject_hash=encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex') AND s.blocked)
 AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts x WHERE x.subject_hash=e.subject_hash))
$$;

-- Clearing/revising a grant also destroys pending confirmations and obsolete
-- content. A disconnected/revoked grant can never be revived by a stale card.
CREATE FUNCTION origen_binder_grant_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.status IS DISTINCT FROM OLD.status THEN
  DELETE FROM origen_binder_previews WHERE connection_id=NEW.connection_id;
 END IF;
 IF NEW.status<>'active' OR NEW.revoked_at IS NOT NULL THEN
  NEW.current_publication_id:=NULL;
  UPDATE origen_binder_publications SET invalidated_at=coalesce(invalidated_at,now()) WHERE grant_id=NEW.id;
  UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,now()) WHERE grant_id=NEW.id AND withdrawn_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_grant_change BEFORE UPDATE ON origen_binder_share_grants FOR EACH ROW EXECUTE FUNCTION origen_binder_grant_change();

CREATE FUNCTION origen_binder_sharing_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action'; student text:=input->>'studentId';
 owner uuid; enabled boolean:=input->>'enabled'='true'; eligible boolean; result jsonb; entries jsonb; refs jsonb; topics text[]; ids uuid[];
 c origen_binder_connections%ROWTYPE; p origen_coordinator_profiles%ROWTYPE; org origen_institutions%ROWTYPE; orgpilot origen_coordinator_organizations%ROWTYPE;
 g origen_binder_share_grants%ROWTYPE; card origen_binder_previews%ROWTYPE; pub origen_binder_publications%ROWTYPE;
 permission integer; student_name text; digest text; item record; version integer;
BEGIN
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
 PERFORM 1 FROM origen_topic_notes WHERE account_id=owner AND id=ANY(ids) ORDER BY id FOR SHARE;
 PERFORM 1 FROM origen_binder_source_lineage WHERE account_id=owner AND source_kind='note' AND source_id=ANY(ARRAY(SELECT unnest(ids)::text)) ORDER BY id FOR SHARE;
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
 INSERT INTO origen_binder_publications(account_id,student_id,grant_id,version,grant_revision,preview_digest,confirmation_id,confirmed_by,policy_version)
 VALUES(owner,student,g.id,version,g.revision,digest,card.id,actor,'coordinator-sharing-v1') RETURNING * INTO pub;
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

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_binder_track_source()','origen_binder_eligible_entries(uuid,text)','origen_binder_grant_live(uuid)','origen_binder_grant_change()','origen_binder_sharing_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

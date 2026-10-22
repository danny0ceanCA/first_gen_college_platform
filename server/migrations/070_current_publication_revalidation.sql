-- Phase 9 regression fixes: revalidate sources before publication replay,
-- and make withdrawn help requests return false rather than SQL NULL.
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
 -- A replay must still revalidate its current source refs below. A receipt is
 -- not permission to claim success after its selected evidence was withdrawn.
 IF action='publish' AND card.publication_id IS NOT NULL AND
  (g.current_publication_id IS DISTINCT FROM card.publication_id OR NOT coalesce(origen_binder_grant_live(g.id),false) OR card.grant_revision IS DISTINCT FROM g.revision) THEN
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
 PERFORM 1 FROM origen_student_memories m WHERE m.account_id=owner AND m.id=ANY(ids) ORDER BY m.id,m.version FOR SHARE;
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
 IF card.publication_id IS NOT NULL THEN RETURN jsonb_build_object('status','published','publicationId',card.publication_id); END IF;
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

CREATE OR REPLACE FUNCTION origen_coordinator_notice_live(owner uuid, student text, recipient text, audience_name text, org uuid, grant_uuid uuid, resource uuid, event_kind text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE g origen_binder_share_grants%ROWTYPE; c origen_binder_connections%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM origen_accounts a JOIN origen_students s ON s.account_id=a.id WHERE a.id=owner AND s.id=student
  AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts x WHERE x.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex'))) THEN RETURN false; END IF;
 IF audience_name='student' THEN
  IF NOT EXISTS(SELECT 1 FROM origen_accounts WHERE id=owner AND auth0_subject=recipient AND role='student') THEN RETURN false; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM origen_coordinator_profiles p JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id
   JOIN origen_institutions i ON i.id=p.institution_id JOIN origen_institution_members m ON m.institution_id=p.institution_id AND m.auth0_subject=p.auth0_subject
   WHERE p.auth0_subject=recipient AND p.institution_id=org AND p.status='active' AND o.status='active' AND i.verification_status='verified' AND i.archived_at IS NULL AND i.parent_approval='approved'
   AND NOT EXISTS(SELECT 1 FROM origen_staff_access_controls x WHERE x.subject_hash=encode(sha256(convert_to(recipient,'UTF8')),'hex') AND x.blocked)) THEN RETURN false; END IF;
 END IF;
 IF event_kind IN ('requested','accepted') THEN
  SELECT * INTO c FROM origen_binder_connections WHERE id=resource AND account_id=owner AND student_id=student;
  RETURN c.id IS NOT NULL AND origen_coordinator_student_ready(owner,student)
   AND (event_kind='requested' AND c.status='requested' AND c.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM origen_coordinator_profiles WHERE id=c.coordinator_id AND auth0_subject=recipient)
    OR event_kind='accepted' AND c.status='accepted' AND audience_name='student');
 END IF;
 SELECT * INTO g FROM origen_binder_share_grants WHERE id=grant_uuid AND account_id=owner AND student_id=student;
 IF event_kind='feedback' AND audience_name='student' THEN
  RETURN EXISTS(SELECT 1 FROM origen_coordinator_feedback WHERE id=resource AND account_id=owner AND student_id=student AND removed_at IS NULL AND withdrawn_at IS NULL AND hidden_at IS NULL);
 END IF;
 IF g.id IS NULL THEN RETURN false; END IF;
 IF event_kind='revoked' THEN RETURN audience_name='student' AND NOT origen_binder_grant_live(g.id); END IF;
 IF NOT origen_binder_grant_live(g.id) THEN RETURN false; END IF;
 IF audience_name='staff' AND NOT EXISTS(SELECT 1 FROM origen_coordinator_profiles WHERE id=g.coordinator_id AND auth0_subject=recipient AND institution_id=org) THEN RETURN false; END IF;
 IF event_kind='expiring' THEN RETURN g.expires_at<clock_timestamp()+interval '7 days'; END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_binder_publications WHERE id=g.current_publication_id AND invalidated_at IS NULL AND grant_revision=g.revision) THEN RETURN false; END IF;
 IF event_kind='help' THEN RETURN coalesce(audience_name='staff' AND g.current_publication_id=resource AND g.help_publication_id=resource,false); END IF;
 IF event_kind='published' THEN RETURN g.current_publication_id=resource; END IF;
 IF event_kind='reply' THEN
  RETURN EXISTS(SELECT 1 FROM origen_coordinator_feedback f WHERE f.id=resource AND f.grant_id=g.id AND f.author_subject=recipient AND f.removed_at IS NULL AND f.withdrawn_at IS NULL
   AND f.topic=ANY(g.topics) AND (f.publication_item_id IS NULL OR EXISTS(SELECT 1 FROM origen_binder_publication_items p JOIN origen_binder_notification_entries(owner,student) e ON e.lineage_id=p.lineage_id
    WHERE p.id=f.publication_item_id AND p.publication_id=g.current_publication_id AND p.withdrawn_at IS NULL AND p.lineage_revision=e.lineage_revision AND p.source_digest=e.source_digest)));
 END IF;
 RETURN false;
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_binder_sharing_command(jsonb)','origen_coordinator_notice_live(uuid,text,text,text,uuid,uuid,uuid,text)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;
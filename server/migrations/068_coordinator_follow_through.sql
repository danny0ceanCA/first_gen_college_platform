-- Student-first Phase 8. No automatic access to plans or private conversations.
-- Generic help events contain identifiers only, at most once per publication.
ALTER TABLE origen_coordinator_notifications DROP CONSTRAINT origen_coordinator_notifications_kind_check;
ALTER TABLE origen_coordinator_notifications ADD CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring','help'));
ALTER TABLE origen_coordinator_outbox DROP CONSTRAINT origen_coordinator_outbox_kind_check;
ALTER TABLE origen_coordinator_outbox ADD CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring','help'));

-- Separate current-source validity from the HTTP rollout gate. Maintenance must
-- not suppress a valid reply merely because it has no HTTP request setting.
-- Only the gated eligibility adapter is used to return binder content to users.
CREATE OR REPLACE FUNCTION origen_binder_derived_entries(owner uuid,student text)
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
 WHERE s.sharing_student_scope AND s.organization_reported_by='student'
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
 UNION ALL SELECT * FROM origen_binder_derived_entries(owner,student) WHERE current_setting('origen.derived_sharing',true)='true'
$$;

-- Internal only: used for metadata-only notification liveness. The caller also
-- checks the exact grant, recipient, current publication and active source digest.
CREATE FUNCTION origen_binder_notification_entries(owner uuid,student text)
RETURNS TABLE(id uuid,topic text,kind text,language text,content text,lineage_id uuid,lineage_revision integer,source_version integer,source_digest text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT * FROM origen_binder_eligible_entries(owner,student)
 UNION SELECT * FROM origen_binder_derived_entries(owner,student)
$$;

-- Preserve tombstones in the existing public wrapper, and keep retry hashes
-- stable across rollout changes. Forward the trusted gate to nested binder reads.
CREATE OR REPLACE FUNCTION origen_coordinator_feedback_v6(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 staff boolean:=left(action,6)='staff-'; owner uuid; g origen_binder_share_grants%ROWTYPE;
 f origen_coordinator_feedback%ROWTYPE; p origen_coordinator_profiles%ROWTYPE;
 receipt origen_coordinator_feedback_requests%ROWTYPE; authorized jsonb; result jsonb; items jsonb; revisions jsonb; replies jsonb;
 fid uuid:=(input->>'feedbackId')::uuid; rid uuid:=(input->>'requestId')::uuid; fingerprint text;
 live boolean:=false; mutation boolean:=action NOT IN ('staff-list','student-list','staff-thread','student-thread','student-source');
BEGIN
 PERFORM set_config('origen.derived_sharing',CASE WHEN input->>'derivedEnabled'='true' THEN 'true' ELSE 'false' END,true);
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR action NOT IN
 ('staff-list','staff-thread','staff-create','staff-edit','staff-withdraw','student-list','student-thread','student-review','student-reply','student-hide','student-unhide','student-remove','student-report','student-source','student-link') THEN RETURN '{"error":"feedback_denied"}'; END IF;
 -- Serialize one author's retries before taking grant locks. Locks live until commit.
 IF staff THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('coordinator-feedback:'||actor,0));
  authorized:=origen_coordinator_binder_command(jsonb_build_object('action','read','organizationId',input->>'organizationId','grantId',input->>'grantId','derivedEnabled',input->>'derivedEnabled'));
  IF authorized ? 'error' THEN RETURN authorized; END IF;
  SELECT * INTO g FROM origen_binder_share_grants WHERE id=(input->>'grantId')::uuid;
  SELECT * INTO p FROM origen_coordinator_profiles WHERE id=g.coordinator_id;
  owner:=g.account_id; live:=true;
 ELSE
  SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR UPDATE;
  IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM origen_students s JOIN origen_accounts pr ON pr.id=s.account_id WHERE s.account_id=owner AND s.id=input->>'studentId' AND pr.role='student') THEN RETURN '{"error":"feedback_denied"}'; END IF;
 END IF;
 IF action IN ('staff-list','student-list') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'topic',x.topic,'kind',x.kind,'body',x.body,'resourceUrl',x.resource_url,'version',x.version,'authorName',x.author_name,'organizationName',x.organization_name,'createdAt',x.created_at,'editedAt',x.edited_at,'withdrawn',x.withdrawn_at IS NOT NULL,'hidden',CASE WHEN staff THEN false ELSE x.hidden_at IS NOT NULL END,'reviewed',CASE WHEN staff THEN false ELSE x.reviewed_version=x.version END,'replyAvailable',origen_coordinator_reply_available(x.id),'connectionEnded',NOT origen_binder_grant_live(x.grant_id),'publicationItemId',x.publication_item_id,'replyCount',(SELECT count(*) FROM origen_coordinator_replies r WHERE r.feedback_id=x.id)) ORDER BY x.created_at,x.id),'[]') INTO items
  FROM origen_coordinator_feedback x WHERE x.account_id=owner AND x.removed_at IS NULL AND
  (staff AND x.grant_id=g.id AND x.author_subject=actor AND x.topic=ANY(g.topics) AND (x.publication_item_id IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(authorized->'entries') e WHERE e->>'id'=x.publication_item_id::text)) OR NOT staff AND x.student_id=input->>'studentId');
  RETURN jsonb_build_object('feedback',items);
 END IF;
 IF action='staff-create' THEN
  IF input->>'enabled' IS DISTINCT FROM 'true' OR NOT (input->>'topic'=ANY(g.topics)) THEN RETURN '{"error":"feedback_denied"}'; END IF;
 ELSE
  SELECT * INTO f FROM origen_coordinator_feedback WHERE id=fid AND account_id=owner AND
   (staff AND grant_id=g.id AND author_subject=actor AND topic=ANY(g.topics) OR NOT staff AND student_id=input->>'studentId') FOR UPDATE;
  IF f.id IS NULL THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
  IF NOT staff THEN
   SELECT * INTO g FROM origen_binder_share_grants WHERE id=f.grant_id FOR SHARE;
   live:=coalesce(origen_binder_grant_live(g.id) AND f.topic=ANY(g.topics),false);
  END IF;
 END IF;
 IF mutation AND action<>'student-link' THEN
  IF rid IS NULL THEN RETURN '{"error":"feedback_denied"}'; END IF;
  fingerprint:=encode(sha256(convert_to((input-ARRAY['enabled','derivedEnabled'])::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM origen_coordinator_feedback_requests WHERE actor_subject=actor AND request_id=rid;
  IF FOUND THEN
   IF receipt.fingerprint<>fingerprint THEN RETURN '{"error":"feedback_changed"}'; END IF;
   RETURN receipt.result;
  END IF;
 END IF;
 IF action<>'staff-create' AND f.removed_at IS NOT NULL THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
 IF action IN ('staff-thread','student-thread') THEN
  IF staff AND f.publication_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(authorized->'entries') e WHERE e->>'id'=f.publication_item_id::text) THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'body',body,'kind',kind,'resourceUrl',resource_url,'createdAt',created_at) ORDER BY version),'[]') INTO revisions FROM origen_coordinator_feedback_revisions WHERE feedback_id=f.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body,'feedbackVersion',feedback_version,'createdAt',created_at) ORDER BY created_at,id),'[]') INTO replies FROM origen_coordinator_replies WHERE feedback_id=f.id;
  RETURN jsonb_build_object('revisions',revisions,'replies',replies);
 END IF;
 IF action<>'staff-create' AND (input->>'version')::integer IS DISTINCT FROM f.version THEN RETURN '{"error":"feedback_changed"}'; END IF;
 IF action IN ('staff-edit','student-reply','student-source','student-link','student-review') AND f.withdrawn_at IS NOT NULL THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
 IF action IN ('staff-create','staff-edit','student-reply') AND input->>'enabled' IS DISTINCT FROM 'true' THEN RETURN '{"error":"feedback_paused"}'; END IF;
 IF action IN ('staff-create','staff-edit') THEN
  IF length(btrim(coalesce(input->>'body',''))) NOT BETWEEN 1 AND 2000 OR input->>'kind' NOT IN ('guidance','resource','suggested-step') OR length(coalesce(input->>'resourceUrl',''))>2000 OR (coalesce(input->>'resourceUrl','')<>'' AND input->>'resourceUrl' !~ '^https://[^/@[:space:]]+') THEN RETURN '{"error":"feedback_denied"}'; END IF;
  IF action='staff-create' AND (input->>'publicationId')::uuid IS DISTINCT FROM g.current_publication_id THEN RETURN '{"error":"feedback_changed"}'; END IF;
  IF coalesce(f.publication_item_id,(input->>'publicationItemId')::uuid) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(authorized->'entries') e WHERE e->>'id'=coalesce(f.publication_item_id,(input->>'publicationItemId')::uuid)::text AND e->>'topic'=coalesce(f.topic,input->>'topic')) THEN RETURN '{"error":"feedback_changed"}'; END IF;
  IF action='staff-create' THEN
   IF (SELECT count(*) FROM origen_coordinator_feedback WHERE account_id=owner AND student_id=g.student_id AND removed_at IS NULL)>=100 THEN RETURN '{"error":"feedback_limit"}'; END IF;
   INSERT INTO origen_coordinator_feedback(account_id,student_id,grant_id,publication_item_id,author_subject,author_name,organization_name,topic,kind,body,resource_url,request_id)
   SELECT owner,g.student_id,g.id,(input->>'publicationItemId')::uuid,actor,p.display_name,i.draft->>'name',input->>'topic',input->>'kind',btrim(input->>'body'),coalesce(input->>'resourceUrl',''),rid FROM origen_institutions i WHERE i.id=p.institution_id RETURNING * INTO f;
  ELSE
   IF f.version>=20 THEN RETURN '{"error":"feedback_limit"}'; END IF;
   UPDATE origen_coordinator_feedback SET body=btrim(input->>'body'),kind=input->>'kind',resource_url=coalesce(input->>'resourceUrl',''),version=version+1,edited_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
  END IF;
  INSERT INTO origen_coordinator_feedback_revisions(account_id,student_id,grant_id,feedback_id,version,author_subject,body,kind,resource_url) VALUES(owner,f.student_id,f.grant_id,f.id,f.version,actor,f.body,f.kind,f.resource_url);
 ELSIF action='staff-withdraw' OR action='student-remove' THEN
  UPDATE origen_coordinator_feedback SET body='',resource_url='',version=version+1,withdrawn_at=CASE WHEN staff THEN clock_timestamp() ELSE withdrawn_at END,removed_at=CASE WHEN NOT staff THEN clock_timestamp() ELSE removed_at END WHERE id=f.id RETURNING * INTO f;
  DELETE FROM origen_coordinator_feedback_revisions WHERE feedback_id=f.id;
  DELETE FROM origen_coordinator_replies WHERE feedback_id=f.id;
 ELSIF action='student-reply' THEN
  IF NOT live THEN RETURN '{"error":"feedback_denied"}'; END IF;
  IF NOT origen_coordinator_reply_available(f.id) THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
  IF length(btrim(coalesce(input->>'body',''))) NOT BETWEEN 1 AND 2000 THEN RETURN '{"error":"feedback_denied"}'; END IF;
  IF (SELECT count(*) FROM origen_coordinator_replies WHERE feedback_id=f.id)>=50 THEN RETURN '{"error":"feedback_limit"}'; END IF;
  INSERT INTO origen_coordinator_replies(account_id,student_id,grant_id,feedback_id,feedback_version,body,request_id) VALUES(owner,f.student_id,f.grant_id,f.id,f.version,btrim(input->>'body'),rid);
 ELSIF action='student-review' THEN UPDATE origen_coordinator_feedback SET reviewed_version=version WHERE id=f.id;
 ELSIF action='student-hide' THEN UPDATE origen_coordinator_feedback SET hidden_at=clock_timestamp() WHERE id=f.id;
 ELSIF action='student-unhide' THEN UPDATE origen_coordinator_feedback SET hidden_at=NULL WHERE id=f.id;
 ELSIF action='student-report' THEN
  IF input->>'reason' NOT IN ('abuse','spam','inaccurate','privacy','other') THEN RETURN '{"error":"feedback_denied"}'; END IF;
  INSERT INTO origen_coordinator_feedback_reports(account_id,feedback_id,reason) VALUES(owner,f.id,input->>'reason') ON CONFLICT DO NOTHING;
 ELSIF action='student-source' THEN
  RETURN jsonb_build_object('id',f.id,'studentId',f.student_id,'topic',f.topic,'kind',f.kind,'body',f.body,'version',f.version,'authorName',f.author_name,'organizationName',f.organization_name,'resourceUrl',f.resource_url,'createdAt',f.created_at,'connectionEnded',NOT live);
 ELSIF action='student-link' THEN
  IF NOT EXISTS(SELECT 1 FROM origen_plans pl JOIN origen_plan_steps s ON s.account_id=pl.account_id AND s.plan_id=pl.id WHERE pl.account_id=owner AND pl.student_id=f.student_id AND pl.id=(input->>'planId')::uuid AND s.id=input->>'stepId') THEN RETURN '{"error":"feedback_denied"}'; END IF;
  INSERT INTO origen_coordinator_feedback_steps VALUES(owner,(input->>'planId')::uuid,input->>'stepId',f.id,f.version) ON CONFLICT DO NOTHING;
  RETURN '{"status":"linked"}';
 END IF;
 result:=jsonb_build_object('status','saved','id',f.id,'version',f.version);
 INSERT INTO origen_coordinator_feedback_requests VALUES(owner,actor,rid,fingerprint,f.id,result);
 INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id) VALUES(owner,f.grant_id,encode(sha256(convert_to(actor,'UTF8')),'hex'),CASE WHEN action='student-reply' THEN 'reply' ELSE 'feedback' END,'completed','coordinator-sharing-v1',f.version,rid);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION origen_binder_help_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid;
 g origen_binder_share_grants%ROWTYPE; result jsonb;
BEGIN
 PERFORM set_config('origen.followthrough',CASE WHEN input->>'followThroughEnabled'='true' THEN 'true' ELSE 'false' END,true);
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR UPDATE;
 IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=input->>'studentId') THEN RETURN '{"error":"sharing_denied"}'; END IF;
 IF input->>'action'='status' THEN
  SELECT coalesce(jsonb_object_agg(id,coalesce(help_publication_id=current_publication_id AND origen_binder_grant_live(id),false)),'{}') INTO result FROM origen_binder_share_grants WHERE account_id=owner AND student_id=input->>'studentId';
  RETURN result;
 END IF;
 IF input->>'action'<>'help' OR jsonb_typeof(input->'requested') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"sharing_denied"}'; END IF;
 SELECT * INTO g FROM origen_binder_share_grants WHERE id=(input->>'grantId')::uuid AND account_id=owner AND student_id=input->>'studentId' FOR UPDATE;
 IF g.id IS NULL THEN RETURN '{"error":"sharing_denied"}'; END IF;
 IF (input->>'requested')::boolean AND (input->>'enabled' IS DISTINCT FROM 'true' OR NOT origen_binder_grant_live(g.id) OR g.current_publication_id IS NULL) THEN RETURN '{"error":"sharing_denied"}'; END IF;
 UPDATE origen_binder_share_grants SET help_publication_id=CASE WHEN (input->>'requested')::boolean THEN current_publication_id ELSE NULL END WHERE id=g.id;
 RETURN '{"status":"updated"}';
END $$;

CREATE OR REPLACE FUNCTION origen_coordinator_notify_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner_subject text; staff_subject text; org uuid; g origen_binder_share_grants%ROWTYPE; f origen_coordinator_feedback%ROWTYPE;
BEGIN
 SELECT auth0_subject INTO owner_subject FROM origen_accounts WHERE id=NEW.account_id;
 IF owner_subject IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='origen_binder_connections' THEN
  SELECT auth0_subject,institution_id INTO staff_subject,org FROM origen_coordinator_profiles WHERE id=NEW.coordinator_id;
  IF TG_OP='INSERT' AND NEW.status='requested' THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,staff_subject,'staff',org,NEW.id,NEW.id,'requested','requested:'||NEW.id);
  ELSIF TG_OP='UPDATE' AND NEW.status='accepted' AND OLD.status IS DISTINCT FROM NEW.status THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,owner_subject,'student',org,NEW.id,NEW.id,'accepted','accepted:'||NEW.id);
  END IF;
 ELSIF TG_TABLE_NAME='origen_binder_share_grants' THEN
  SELECT auth0_subject,institution_id INTO staff_subject,org FROM origen_coordinator_profiles WHERE id=NEW.coordinator_id;
  IF NEW.status<>'active' AND OLD.status='active' THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,owner_subject,'student',org,NEW.id,NEW.id,'revoked','revoked:'||NEW.id||':'||NEW.revision);
  ELSIF current_setting('origen.followthrough',true)='true' AND NEW.help_publication_id IS NOT NULL
   AND NEW.help_publication_id=NEW.current_publication_id AND NEW.help_publication_id IS DISTINCT FROM OLD.help_publication_id THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,staff_subject,'staff',org,NEW.id,NEW.current_publication_id,'help','help:'||NEW.current_publication_id);
  ELSIF NEW.current_publication_id IS NOT NULL AND NEW.current_publication_id IS DISTINCT FROM OLD.current_publication_id THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,staff_subject,'staff',org,NEW.id,NEW.current_publication_id,'published','published:'||NEW.current_publication_id);
  END IF;
 ELSE
  SELECT * INTO g FROM origen_binder_share_grants WHERE id=NEW.grant_id;
  SELECT auth0_subject,institution_id INTO staff_subject,org FROM origen_coordinator_profiles WHERE id=g.coordinator_id;
  IF TG_TABLE_NAME='origen_coordinator_feedback' THEN
   IF NEW.withdrawn_at IS NULL AND NEW.removed_at IS NULL AND (TG_OP='INSERT' OR NEW.version<>OLD.version) THEN
    PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,owner_subject,'student',org,NEW.grant_id,NEW.id,'feedback','feedback:'||NEW.id||':'||NEW.version);
   END IF;
  ELSIF staff_subject IS NOT NULL THEN
   PERFORM origen_coordinator_enqueue(NEW.account_id,NEW.student_id,staff_subject,'staff',org,NEW.grant_id,NEW.feedback_id,'reply','reply:'||NEW.id);
  END IF;
 END IF;
 RETURN NEW;
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
 IF event_kind='help' THEN RETURN audience_name='staff' AND g.current_publication_id=resource AND g.help_publication_id=resource; END IF;
 IF event_kind='published' THEN RETURN g.current_publication_id=resource; END IF;
 IF event_kind='reply' THEN
  RETURN EXISTS(SELECT 1 FROM origen_coordinator_feedback f WHERE f.id=resource AND f.grant_id=g.id AND f.author_subject=recipient AND f.removed_at IS NULL AND f.withdrawn_at IS NULL
   AND f.topic=ANY(g.topics) AND (f.publication_item_id IS NULL OR EXISTS(SELECT 1 FROM origen_binder_publication_items p JOIN origen_binder_notification_entries(owner,student) e ON e.lineage_id=p.lineage_id
    WHERE p.id=f.publication_item_id AND p.publication_id=g.current_publication_id AND p.withdrawn_at IS NULL AND p.lineage_revision=e.lineage_revision AND p.source_digest=e.source_digest)));
 END IF;
 RETURN false;
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_binder_derived_entries(uuid,text)','origen_binder_eligible_entries(uuid,text)','origen_binder_notification_entries(uuid,text)','origen_coordinator_feedback_v6(jsonb)','origen_binder_help_command(jsonb)','origen_coordinator_notify_change()','origen_coordinator_notice_live(uuid,text,text,text,uuid,uuid,uuid,text)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

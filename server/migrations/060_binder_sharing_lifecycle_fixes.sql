-- Preserve explicit publication identity; never disclose a later unshared name edit.
ALTER TABLE origen_binder_publications ADD COLUMN student_name text;
UPDATE origen_binder_publications b SET student_name=p.student_name FROM origen_binder_previews p WHERE p.publication_id=b.id;

-- A reply is deliverable only while the author can still read its topic/item.
-- This helper is private to the migration owner, like the other sharing helpers.
CREATE FUNCTION origen_coordinator_reply_available(feedback uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(
  SELECT 1 FROM origen_coordinator_feedback f JOIN origen_binder_share_grants g ON g.id=f.grant_id AND g.account_id=f.account_id AND g.student_id=f.student_id
  JOIN origen_coordinator_profiles cp ON cp.id=g.coordinator_id AND cp.auth0_subject=f.author_subject
  JOIN origen_binder_publications b ON b.id=g.current_publication_id AND b.grant_id=g.id AND b.invalidated_at IS NULL AND b.grant_revision=g.revision AND b.policy_version='coordinator-sharing-v1'
  WHERE f.id=feedback AND f.removed_at IS NULL AND f.withdrawn_at IS NULL AND origen_binder_grant_live(g.id) AND f.topic=ANY(g.topics)
  AND (f.publication_item_id IS NULL OR EXISTS(
   SELECT 1 FROM origen_binder_publication_items x JOIN origen_binder_eligible_entries(g.account_id,g.student_id) e
    ON e.lineage_id=x.lineage_id AND e.lineage_revision=x.lineage_revision AND e.source_version=x.source_version AND e.source_digest=x.source_digest
   WHERE x.id=f.publication_item_id AND x.publication_id=b.id AND x.grant_id=g.id AND x.account_id=g.account_id AND x.student_id=g.student_id AND x.topic=f.topic AND x.withdrawn_at IS NULL
  ))
 )
$$;


CREATE OR REPLACE FUNCTION origen_coordinator_visible_binders(coordinator uuid)
RETURNS TABLE(id uuid,student_name text,publication_id uuid,version integer,published_at timestamptz,expires_at timestamptz,topics text[],is_new boolean,help_requested boolean)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT g.id,coalesce(b.student_name,c.display_name),b.id,b.version,b.published_at,g.expires_at,g.topics,
 r.publication_id IS DISTINCT FROM b.id,coalesce(g.help_publication_id=b.id,false)
 FROM origen_binder_share_grants g JOIN origen_binder_connections c ON c.id=g.connection_id
 JOIN origen_binder_publications b ON b.id=g.current_publication_id AND b.grant_id=g.id AND b.account_id=g.account_id AND b.student_id=g.student_id
 LEFT JOIN origen_binder_reviews r ON r.grant_id=g.id
 WHERE g.coordinator_id=coordinator AND origen_binder_grant_live(g.id) AND b.invalidated_at IS NULL AND b.grant_revision=g.revision AND b.policy_version='coordinator-sharing-v1'
$$;

CREATE OR REPLACE FUNCTION origen_coordinator_binder_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 org origen_institutions%ROWTYPE; p origen_coordinator_profiles%ROWTYPE; row record; rows jsonb; counts jsonb; contents jsonb;
 cursor_id uuid:=(input->>'cursor')::uuid; query text:=coalesce(input->>'search',''); view_name text:=coalesce(input->>'view','all'); page_size integer:=10;
BEGIN
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

CREATE OR REPLACE FUNCTION origen_coordinator_feedback_v6(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 staff boolean:=left(action,6)='staff-'; owner uuid; g origen_binder_share_grants%ROWTYPE;
 f origen_coordinator_feedback%ROWTYPE; p origen_coordinator_profiles%ROWTYPE;
 receipt origen_coordinator_feedback_requests%ROWTYPE; authorized jsonb; result jsonb; items jsonb; revisions jsonb; replies jsonb;
 fid uuid:=(input->>'feedbackId')::uuid; rid uuid:=(input->>'requestId')::uuid; fingerprint text;
 live boolean:=false; mutation boolean:=action NOT IN ('staff-list','student-list','staff-thread','student-thread','student-source');
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR action NOT IN
 ('staff-list','staff-thread','staff-create','staff-edit','staff-withdraw','student-list','student-thread','student-review','student-reply','student-hide','student-unhide','student-remove','student-report','student-source','student-link') THEN RETURN '{"error":"feedback_denied"}'; END IF;
 -- Serialize one author's retries before taking grant locks. Locks live until commit.
 IF staff THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('coordinator-feedback:'||actor,0));
  authorized:=origen_coordinator_binder_command(jsonb_build_object('action','read','organizationId',input->>'organizationId','grantId',input->>'grantId'));
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
  fingerprint:=encode(sha256(convert_to((input-'enabled')::text,'UTF8')),'hex');
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

CREATE OR REPLACE FUNCTION origen_binder_sharing_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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


DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_coordinator_reply_available(uuid)','origen_coordinator_visible_binders(uuid)','origen_coordinator_binder_command(jsonb)','origen_coordinator_feedback_v6(jsonb)','origen_binder_sharing_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

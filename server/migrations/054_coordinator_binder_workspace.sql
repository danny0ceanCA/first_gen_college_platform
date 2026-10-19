-- Coordinator reads are a separate capability from student publication.
ALTER TABLE origen_binder_share_grants ADD COLUMN help_publication_id uuid;
CREATE TABLE origen_binder_reviews (
 grant_id uuid PRIMARY KEY REFERENCES origen_binder_share_grants(id) ON DELETE CASCADE,
 publication_id uuid NOT NULL REFERENCES origen_binder_publications(id) ON DELETE CASCADE,
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE origen_binder_reviews ENABLE ROW LEVEL SECURITY;
-- Match the other sharing tables: only the migration-owned SECURITY DEFINER
-- command bypasses RLS. The non-owner runtime has no table privileges/policies.
REVOKE ALL ON origen_binder_reviews FROM PUBLIC;

-- Student-owned, explicit request; no private activity is used to infer need.
CREATE FUNCTION origen_binder_help_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid;
 g origen_binder_share_grants%ROWTYPE; result jsonb;
BEGIN
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

-- One allowlisted adapter. It never serializes private notebook/summary rows.
-- Helpers have no runtime EXECUTE; callers must pass the staff identity gate.
CREATE FUNCTION origen_coordinator_visible_binders(coordinator uuid)
RETURNS TABLE(id uuid,student_name text,publication_id uuid,version integer,published_at timestamptz,expires_at timestamptz,topics text[],is_new boolean,help_requested boolean)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT g.id,c.display_name,b.id,b.version,b.published_at,g.expires_at,g.topics,
 r.publication_id IS DISTINCT FROM b.id,coalesce(g.help_publication_id=b.id,false)
 FROM origen_binder_share_grants g JOIN origen_binder_connections c ON c.id=g.connection_id
 JOIN origen_binder_publications b ON b.id=g.current_publication_id AND b.grant_id=g.id AND b.account_id=g.account_id AND b.student_id=g.student_id
 LEFT JOIN origen_binder_reviews r ON r.grant_id=g.id
 WHERE g.coordinator_id=coordinator AND origen_binder_grant_live(g.id) AND b.invalidated_at IS NULL AND b.grant_revision=g.revision AND b.policy_version='coordinator-sharing-v1'
$$;

CREATE FUNCTION origen_coordinator_binder_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  IF cursor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_coordinator_visible_binders(p.id) v WHERE v.id=cursor_id AND strpos(lower(v.student_name),lower(query))>0 AND (view_name='all' OR view_name='new' AND v.is_new OR view_name='help' AND v.help_requested)) THEN RETURN '{"error":"binder_unavailable"}'; END IF;
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
 FOREACH f IN ARRAY ARRAY['origen_binder_help_command(jsonb)','origen_coordinator_visible_binders(uuid)','origen_coordinator_binder_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

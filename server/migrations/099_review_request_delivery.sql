-- A request remains separate from a shared binder. Staff receive only the
-- approved publication, never the student's private draft or original wording.
ALTER TABLE origen_review_request_publications ADD COLUMN opened_at timestamptz, ADD COLUMN reviewed_at timestamptz;
CREATE TABLE origen_review_request_responses (
 request_id uuid PRIMARY KEY, account_id uuid NOT NULL, student_id text NOT NULL,
 publication_id uuid NOT NULL UNIQUE REFERENCES origen_review_request_publications(id) ON DELETE CASCADE,
 author_subject text NOT NULL, version integer NOT NULL CHECK(version>0),
 guidance text NOT NULL, suggested_action text NOT NULL DEFAULT '', resource_url text NOT NULL DEFAULT '', follow_up_on date,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz,
 operation_id uuid NOT NULL, operation_digest text NOT NULL,
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE,
 CHECK(length(guidance)<=2000 AND length(suggested_action)<=1000 AND length(resource_url)<=2000),
 CHECK(withdrawn_at IS NULL AND length(btrim(guidance))>0 OR withdrawn_at IS NOT NULL AND guidance='' AND suggested_action='' AND resource_url='' AND follow_up_on IS NULL)
);
ALTER TABLE origen_review_request_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_review_request_responses FROM PUBLIC;

CREATE FUNCTION origen_review_response_view(rid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('version',version,'status',CASE WHEN withdrawn_at IS NULL THEN 'available' ELSE 'withdrawn' END,
  'guidance',guidance,'suggestedAction',suggested_action,'resourceUrl',resource_url,'followUpOn',follow_up_on,
  'createdAt',created_at,'updatedAt',updated_at,'withdrawnAt',withdrawn_at)
 FROM origen_review_request_responses WHERE request_id=rid
$$;

CREATE FUNCTION origen_coordinator_review_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 org origen_institutions%ROWTYPE; staff origen_coordinator_profiles%ROWTYPE; r origen_review_requests%ROWTYPE;
 pub origen_review_request_publications%ROWTYPE; reply origen_review_request_responses%ROWTYPE;
 rows jsonb; next_id uuid; cursor_time timestamptz; result jsonb; fingerprint text; owner_subject text;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR coalesce(current_setting('origen.coordinator_verified',true),'false')<>'true'
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')
   AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN RETURN '{"error":"review_access_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('list','read','review','respond','withdraw-response')
  OR input-ARRAY['action','organizationId','id','publicationId','before','version','operationId','guidance','suggestedAction','resourceUrl','followUpOn','enabled']<>'{}'::jsonb THEN RETURN '{"error":"invalid_coordinator_review"}'; END IF;
 -- Account deletion takes the account before cascading through connections.
 -- KEY SHARE is compatible with the student's NO KEY UPDATE mutation locks.
 IF action<>'list' THEN
  SELECT * INTO r FROM origen_review_requests WHERE id=(input->>'id')::uuid;
  IF r.id IS NULL THEN RETURN '{"error":"review_unavailable"}'; END IF;
  PERFORM 1 FROM origen_accounts WHERE id=r.account_id FOR KEY SHARE;
 END IF;
 SELECT * INTO org FROM origen_institutions WHERE id=(input->>'organizationId')::uuid FOR SHARE;
 SELECT * INTO staff FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor FOR SHARE;
 IF staff.id IS NULL OR staff.status<>'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM origen_coordinator_organizations WHERE institution_id=org.id AND status='active')
  OR NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=actor) THEN RETURN '{"error":"review_access_denied"}'; END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb AND action<>'withdraw-response' THEN
  IF action='list' THEN RETURN '{"enabled":false,"requests":[],"nextCursor":null}'; END IF;
  RETURN '{"error":"review_delivery_paused"}';
 END IF;
 IF action='list' THEN
  IF input ? 'before' THEN
   SELECT submitted_at INTO cursor_time FROM origen_review_requests WHERE id=(input->>'before')::uuid AND coordinator_id=staff.id AND institution_id=org.id;
   IF cursor_time IS NULL THEN RETURN '{"error":"review_list_changed"}'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.submitted_at DESC,x.id DESC),'[]') INTO rows FROM (
   SELECT q.id,q.submitted_at,jsonb_build_object('id',q.id,'publicationId',p.id,'studentName',p.payload->>'studentName','kind',q.kind,
    'submittedAt',q.submitted_at,'expiresAt',p.expires_at,'openedAt',p.opened_at,'reviewedAt',p.reviewed_at,
    'responseStatus',CASE WHEN a.request_id IS NULL THEN 'none' WHEN a.withdrawn_at IS NULL THEN 'available' ELSE 'withdrawn' END) AS item
   FROM origen_review_requests q JOIN origen_review_request_publications p ON p.request_id=q.id LEFT JOIN origen_review_request_responses a ON a.request_id=q.id
   WHERE q.coordinator_id=staff.id AND q.institution_id=org.id AND p.recipient_subject=actor AND origen_review_request_live(q.id)
    AND EXISTS(SELECT 1 FROM origen_coordinator_outbox o WHERE o.resource_id=p.id AND o.kind='review-request' AND o.status='delivered')
    AND (cursor_time IS NULL OR (q.submitted_at,q.id)<(cursor_time,(input->>'before')::uuid))
   ORDER BY q.submitted_at DESC,q.id DESC LIMIT 31) x;
  IF jsonb_array_length(rows)>30 THEN next_id:=(rows->29->>'id')::uuid;rows:=rows-30; END IF;
  RETURN jsonb_build_object('enabled',true,'requests',rows,'nextCursor',next_id);
 END IF;
 IF r.coordinator_id<>staff.id OR r.institution_id<>org.id THEN RETURN '{"error":"review_unavailable"}'; END IF;
 -- Follow source/institution invalidation order before locking publication.
 PERFORM 1 FROM origen_binder_connections WHERE id=r.connection_id FOR SHARE;
 PERFORM 1 FROM origen_topic_notes n WHERE n.account_id=r.account_id AND EXISTS(SELECT 1 FROM origen_review_request_entries e WHERE e.request_id=r.id AND e.entry_id=n.id) ORDER BY n.id FOR SHARE;
 PERFORM 1 FROM origen_binder_source_lineage l WHERE EXISTS(SELECT 1 FROM origen_review_request_entries e WHERE e.request_id=r.id AND e.lineage_id=l.id) ORDER BY l.id FOR SHARE;
 SELECT * INTO r FROM origen_review_requests WHERE id=r.id FOR UPDATE;
 SELECT * INTO pub FROM origen_review_request_publications WHERE request_id=r.id AND recipient_subject=actor FOR UPDATE;
 IF pub.id IS NULL THEN RETURN '{"error":"review_unavailable"}'; END IF;
 IF action<>'withdraw-response' AND (NOT origen_review_request_live(r.id)
  OR NOT EXISTS(SELECT 1 FROM origen_coordinator_outbox WHERE resource_id=pub.id AND kind='review-request' AND status='delivered')) THEN RETURN '{"error":"review_unavailable"}'; END IF;
 IF action<>'read' AND pub.id IS DISTINCT FROM (input->>'publicationId')::uuid THEN RETURN '{"error":"review_changed"}'; END IF;
 IF action='read' THEN UPDATE origen_review_request_publications SET opened_at=coalesce(opened_at,clock_timestamp()) WHERE id=pub.id RETURNING * INTO pub; END IF;
 IF action='review' THEN UPDATE origen_review_request_publications SET reviewed_at=coalesce(reviewed_at,clock_timestamp()) WHERE id=pub.id RETURNING * INTO pub; END IF;
 IF action IN ('respond','withdraw-response') THEN
  IF input->>'operationId' IS NULL OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR input->>'version' !~ '^(0|[1-9][0-9]*)$' THEN RETURN '{"error":"invalid_coordinator_review"}'; END IF;
  fingerprint:=encode(sha256(convert_to((input-ARRAY['enabled','operationId'])::text,'UTF8')),'hex');
  SELECT * INTO reply FROM origen_review_request_responses WHERE request_id=r.id FOR UPDATE;
  IF reply.operation_id=(input->>'operationId')::uuid THEN
   IF reply.operation_digest<>fingerprint THEN RETURN '{"error":"review_changed"}'; END IF;
   RETURN jsonb_build_object('status',CASE WHEN reply.withdrawn_at IS NULL THEN 'responded' ELSE 'withdrawn' END,'response',origen_review_response_view(r.id));
  END IF;
  IF coalesce(reply.version,0)<>(input->>'version')::integer OR reply.withdrawn_at IS NOT NULL THEN RETURN '{"error":"review_changed"}'; END IF;
  IF action='respond' THEN
   IF jsonb_typeof(input->'guidance') IS DISTINCT FROM 'string' OR length(btrim(input->>'guidance')) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(input->'suggestedAction') IS DISTINCT FROM 'string' OR length(input->>'suggestedAction')>1000
    OR jsonb_typeof(input->'resourceUrl') IS DISTINCT FROM 'string' OR length(input->>'resourceUrl')>2000
    OR input->>'resourceUrl'<>'' AND input->>'resourceUrl' !~ '^https://' THEN RETURN '{"error":"invalid_coordinator_review"}'; END IF;
   INSERT INTO origen_review_request_responses(request_id,account_id,student_id,publication_id,author_subject,version,guidance,suggested_action,resource_url,follow_up_on,operation_id,operation_digest)
    VALUES(r.id,r.account_id,r.student_id,pub.id,actor,1,input->>'guidance',input->>'suggestedAction',input->>'resourceUrl',nullif(input->>'followUpOn','')::date,(input->>'operationId')::uuid,fingerprint)
    ON CONFLICT(request_id) DO UPDATE SET version=origen_review_request_responses.version+1,guidance=excluded.guidance,suggested_action=excluded.suggested_action,
     resource_url=excluded.resource_url,follow_up_on=excluded.follow_up_on,updated_at=clock_timestamp(),operation_id=excluded.operation_id,operation_digest=excluded.operation_digest
    RETURNING * INTO reply;
   SELECT auth0_subject INTO owner_subject FROM origen_accounts WHERE id=r.account_id;
   -- Keep only the newest response notice. Its content is loaded separately.
   UPDATE origen_coordinator_outbox SET status='suppressed',finished_at=clock_timestamp() WHERE grant_id=r.id AND kind='review-response' AND status IN ('pending','failed');
   DELETE FROM origen_coordinator_notifications WHERE grant_id=r.id AND kind='review-response';
   PERFORM origen_coordinator_enqueue(r.account_id,r.student_id,owner_subject,'student',org.id,r.id,pub.id,'review-response','review-response:'||r.id||':'||reply.version);
  ELSE
   IF reply.request_id IS NULL THEN RETURN '{"error":"review_changed"}'; END IF;
   UPDATE origen_review_request_responses SET version=version+1,guidance='',suggested_action='',resource_url='',follow_up_on=NULL,withdrawn_at=clock_timestamp(),updated_at=clock_timestamp(),operation_id=(input->>'operationId')::uuid,operation_digest=fingerprint WHERE request_id=r.id;
   UPDATE origen_coordinator_outbox SET status='suppressed',finished_at=clock_timestamp() WHERE grant_id=r.id AND kind='review-response' AND status IN ('pending','failed');
   DELETE FROM origen_coordinator_notifications WHERE grant_id=r.id AND kind='review-response';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN action='respond' THEN 'responded' ELSE 'withdrawn' END,'response',origen_review_response_view(r.id));
 END IF;
 -- Explicit allowlist: no drafts, unselected notes, source lineage, account IDs,
 -- unapproved wording, transcript, or permission internals are returned.
 RETURN jsonb_build_object('id',r.id,'publicationId',pub.id,'studentName',pub.payload->>'studentName','kind',pub.payload->>'kind','language',pub.payload->>'language',
  'question',pub.payload->>'question','entries',pub.payload->'entries','submittedAt',pub.published_at,'expiresAt',pub.expires_at,
  'openedAt',pub.opened_at,'reviewedAt',pub.reviewed_at,'response',origen_review_response_view(r.id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN RETURN '{"error":"invalid_coordinator_review"}';
END $$;

-- Extend the student-owned receipt, including existing account export.
DO $$ DECLARE d text; anchor text:='''publication'',CASE WHEN p.id IS NULL'; BEGIN
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_view'; END IF;
 EXECUTE replace(d,anchor,'''coordinatorReview'',jsonb_build_object(''openedAt'',p.opened_at,''reviewedAt'',p.reviewed_at,''response'',origen_review_response_view(r.id)),'||anchor);
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 anchor:='''notification'',coalesce';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_metadata'; END IF;
 EXECUTE replace(d,anchor,'''openedAt'',p.opened_at,''reviewedAt'',p.reviewed_at,''responded'',EXISTS(SELECT 1 FROM origen_review_request_responses a WHERE a.request_id=r.id AND a.withdrawn_at IS NULL),'||anchor);
END $$;

-- Delivery is a server-side capability, passed separately from model/user input.
DO $$ DECLARE d text; anchor text:='''deliveryEnabled'',false'; BEGIN
 d:=pg_get_functiondef('origen_review_request_command(jsonb)'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_list'; END IF;
 EXECUTE replace(d,anchor,'''deliveryEnabled'',coalesce(current_setting(''origen.review_delivery'',true),''false'')=''true''');
END $$;

ALTER TABLE origen_coordinator_outbox DROP CONSTRAINT origen_coordinator_outbox_kind_check;
ALTER TABLE origen_coordinator_outbox ADD CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring','help','review-request','review-response'));
ALTER TABLE origen_coordinator_notifications DROP CONSTRAINT origen_coordinator_notifications_kind_check;
ALTER TABLE origen_coordinator_notifications ADD CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring','help','review-request','review-response'));
DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_coordinator_notice_live(uuid,text,text,text,uuid,uuid,uuid,text)'::regprocedure);
 anchor:='IF event_kind IN (''requested'',''accepted'') THEN';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_notice_live'; END IF;
 EXECUTE replace(d,anchor,$insert$
 IF event_kind IN ('review-request','review-response') THEN
  RETURN EXISTS(SELECT 1 FROM origen_review_requests r JOIN origen_review_request_publications p ON p.request_id=r.id
   WHERE r.id=grant_uuid AND p.id=resource AND r.account_id=owner AND r.student_id=student AND r.institution_id=org AND origen_review_request_live(r.id)
    AND (event_kind='review-request' AND audience_name='staff' AND p.recipient_subject=recipient
     OR event_kind='review-response' AND audience_name='student' AND EXISTS(SELECT 1 FROM origen_review_request_responses a WHERE a.request_id=r.id AND a.withdrawn_at IS NULL)));
 END IF;
 $insert$||anchor);
 d:=pg_get_functiondef('origen_coordinator_maintain()'::regprocedure);
 anchor:='WHERE kind<>''review-request'' AND status=''pending'' AND available_at<=clock_timestamp()';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_queue'; END IF;
 EXECUTE replace(d,anchor,'WHERE (kind NOT IN (''review-request'',''review-response'') OR coalesce(current_setting(''origen.review_delivery'',true),''false'')=''true'') AND status=''pending'' AND available_at<=clock_timestamp()');
 d:=pg_get_functiondef('origen_coordinator_notification_command(jsonb)'::regprocedure);
 anchor:='CASE WHEN item.kind IN (''requested'',''accepted'')';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_notice_destination'; END IF;
 EXECUTE replace(d,anchor,'CASE WHEN item.kind IN (''review-request'',''review-response'') THEN ''review-request'' WHEN item.kind IN (''requested'',''accepted'')');
 -- Revocation removes both request and response notification links.
 d:=pg_get_functiondef('origen_review_request_invalidate(uuid,text)'::regprocedure);
 EXECUTE replace(d,'kind=''review-request''','kind IN (''review-request'',''review-response'')');
END $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_coordinator_review_command(jsonb)','origen_review_response_view(uuid)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

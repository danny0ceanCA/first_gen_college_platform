-- Each review request publishes independently. Never replace a binder grant's
-- current publication, copy unrelated notes, or infer approval from a draft.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='origen_review_requests'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
  EXECUTE format('ALTER TABLE origen_review_requests DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE origen_review_requests ADD COLUMN submitted_at timestamptz, ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE origen_review_requests ADD CONSTRAINT review_request_lifecycle CHECK(
 (status='draft' AND version=1 AND cancelled_at IS NULL AND submitted_at IS NULL AND withdrawn_at IS NULL) OR
 (status='cancelled' AND version=2 AND cancelled_at>=created_at AND cancelled_at IS NOT NULL AND submitted_at IS NULL AND withdrawn_at IS NULL) OR
 (status='submitted' AND version=2 AND submitted_at>=created_at AND submitted_at IS NOT NULL AND cancelled_at IS NULL AND withdrawn_at IS NULL) OR
 (status='withdrawn' AND version=3 AND submitted_at>=created_at AND submitted_at IS NOT NULL AND withdrawn_at>=submitted_at AND withdrawn_at IS NOT NULL AND cancelled_at IS NULL));

CREATE TABLE origen_review_request_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL UNIQUE,
 request_version integer NOT NULL CHECK(request_version=1), wording text NOT NULL CHECK(wording IN ('original','clarification')),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 access_expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE,
 CHECK(expires_at>created_at AND access_expires_at>expires_at)
);
CREATE TABLE origen_review_request_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, student_id text NOT NULL, request_id uuid NOT NULL UNIQUE,
 preview_id uuid NOT NULL UNIQUE, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 wording text NOT NULL CHECK(wording IN ('original','clarification')), confirmed_by text NOT NULL, recipient_subject text NOT NULL,
 policy_version text NOT NULL DEFAULT 'review-request-v1' CHECK(policy_version='review-request-v1'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), published_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, invalidated_at timestamptz, invalidation_reason text,
 FOREIGN KEY(account_id,student_id,request_id) REFERENCES origen_review_requests(account_id,student_id,id) ON DELETE CASCADE,
 CHECK(expires_at>published_at),
 CHECK((invalidated_at IS NULL AND invalidation_reason IS NULL AND payload ? 'question' AND payload ? 'entries') OR
  (invalidated_at IS NOT NULL AND invalidation_reason IN ('withdrawn','source_changed','access_changed','expired','restored') AND payload='{}'::jsonb))
);
ALTER TABLE origen_review_request_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_review_request_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_review_request_previews,origen_review_request_publications FROM PUBLIC;
CREATE INDEX review_request_source ON origen_review_request_entries(lineage_id,request_id);
CREATE INDEX review_request_recipient ON origen_review_requests(connection_id,institution_id,coordinator_id);

-- Private historical records remain readable, but never imply current access.
CREATE FUNCTION origen_review_request_live(rid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM origen_review_requests r
 JOIN origen_review_request_publications pub ON pub.request_id=r.id
 JOIN origen_accounts a ON a.id=r.account_id
 JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
 JOIN origen_binder_connections c ON c.id=r.connection_id AND c.account_id=r.account_id AND c.student_id=r.student_id AND c.coordinator_id=r.coordinator_id
 JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id AND p.institution_id=r.institution_id
 JOIN origen_coordinator_organizations o ON o.institution_id=p.institution_id
 JOIN origen_institutions i ON i.id=o.institution_id
 JOIN origen_institution_members m ON m.institution_id=i.id AND m.auth0_subject=p.auth0_subject
 WHERE r.id=rid AND r.status='submitted' AND pub.invalidated_at IS NULL AND pub.expires_at>clock_timestamp()
 AND origen_coordinator_student_ready(r.account_id,r.student_id)
 AND c.status='accepted' AND c.revision=r.connection_revision AND p.status='active' AND p.revision=r.coordinator_revision
 AND o.status='active' AND o.revision=r.organization_revision AND e.revision=r.permission_revision
 AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL
 AND p.auth0_subject=pub.recipient_subject AND p.display_name=r.coordinator_name AND i.draft->>'name'=r.organization_name
 AND NOT EXISTS(SELECT 1 FROM origen_staff_access_controls s WHERE s.subject_hash=encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex') AND s.blocked)
 AND NOT EXISTS(SELECT 1 FROM origen_review_request_entries re WHERE re.request_id=r.id AND NOT EXISTS(
  SELECT 1 FROM origen_topic_notes n JOIN origen_binder_source_lineage l ON l.account_id=n.account_id AND l.id=re.lineage_id
  WHERE n.account_id=r.account_id AND n.student_id=r.student_id AND n.id=re.entry_id AND n.version=re.source_version
  AND n.status='saved' AND n.origin='user' AND n.source_summary_id IS NULL
  AND l.student_id=r.student_id AND l.source_kind='note' AND l.source_id=n.id::text
  AND l.active AND l.complete AND l.classification='student_only' AND l.revision=re.lineage_revision
  AND l.source_version=re.source_version AND l.source_digest=re.source_digest
  AND l.source_digest=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex')
  AND NOT EXISTS(SELECT 1 FROM origen_binder_source_edges se WHERE se.account_id=n.account_id AND se.derived_id=l.id))))
$$;

CREATE FUNCTION origen_review_request_invalidate(rid uuid,reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 DELETE FROM origen_review_request_previews WHERE request_id=rid;
 UPDATE origen_review_request_publications SET payload='{}',invalidated_at=clock_timestamp(),invalidation_reason=reason WHERE request_id=rid AND invalidated_at IS NULL;
 UPDATE origen_coordinator_outbox SET status='suppressed',finished_at=clock_timestamp() WHERE kind='review-request' AND grant_id=rid AND status IN ('pending','failed');
 DELETE FROM origen_coordinator_notifications WHERE kind='review-request' AND grant_id=rid;
END $$;

-- Erase duplicate shared text promptly when its source or permission changes.
CREATE FUNCTION origen_review_request_boundary() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE rid uuid; BEGIN
 FOR rid IN SELECT r.id FROM origen_review_requests r WHERE
  CASE TG_TABLE_NAME
   WHEN 'origen_binder_source_lineage' THEN EXISTS(SELECT 1 FROM origen_review_request_entries re WHERE re.request_id=r.id AND re.lineage_id=(to_jsonb(OLD)->>'id')::uuid)
   WHEN 'origen_binder_connections' THEN r.connection_id=(to_jsonb(OLD)->>'id')::uuid
   WHEN 'origen_coordinator_profiles' THEN r.coordinator_id=(to_jsonb(OLD)->>'id')::uuid
   WHEN 'origen_coordinator_organizations' THEN r.institution_id=(to_jsonb(OLD)->>'institution_id')::uuid
   WHEN 'origen_institutions' THEN r.institution_id=(to_jsonb(OLD)->>'id')::uuid
   WHEN 'origen_staff_access_controls' THEN EXISTS(SELECT 1 FROM origen_coordinator_profiles p WHERE p.id=r.coordinator_id AND encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex')=coalesce(to_jsonb(NEW)->>'subject_hash',to_jsonb(OLD)->>'subject_hash'))
   ELSE false END
 ORDER BY r.id LOOP
  PERFORM origen_review_request_invalidate(rid,CASE WHEN TG_TABLE_NAME='origen_binder_source_lineage' THEN 'source_changed' ELSE 'access_changed' END);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER review_request_source_changed AFTER UPDATE OR DELETE ON origen_binder_source_lineage FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();
CREATE TRIGGER review_request_connection_changed AFTER UPDATE OF status,revision OR DELETE ON origen_binder_connections FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();
CREATE TRIGGER review_request_coordinator_changed AFTER UPDATE OF status,revision,display_name OR DELETE ON origen_coordinator_profiles FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();
CREATE TRIGGER review_request_organization_changed AFTER UPDATE OF status,revision OR DELETE ON origen_coordinator_organizations FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();
CREATE TRIGGER review_request_institution_changed AFTER UPDATE OF verification_status,parent_approval,archived_at,draft OR DELETE ON origen_institutions FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();
CREATE TRIGGER review_request_staff_changed AFTER INSERT OR UPDATE OF blocked,token_valid_after ON origen_staff_access_controls FOR EACH ROW EXECUTE FUNCTION origen_review_request_boundary();

-- Keep step 1's private command internal; the public signature keeps its ACL.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('origen_review_request_command(jsonb)'::regprocedure);
 EXECUTE replace(d,'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_command(', 'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_base_command(');
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 EXECUTE replace(d,'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_view(', 'FUNCTION '||quote_ident(current_schema())||'.origen_review_request_base_view(');
END $$;
CREATE OR REPLACE FUNCTION origen_review_request_view(request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT origen_review_request_base_view(request)||jsonb_build_object('submittedAt',r.submitted_at,'withdrawnAt',r.withdrawn_at,
  'publication',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'previewId',p.preview_id,'digest',p.digest,'wording',p.wording,
   'submittedAt',p.published_at,'expiresAt',p.expires_at,'access',CASE WHEN origen_review_request_live(r.id) THEN 'active' ELSE 'unavailable' END,
   'notification',coalesce((SELECT status FROM origen_coordinator_outbox WHERE event_key='review-request:'||p.id),'unavailable')) END)
 FROM origen_review_requests r JOIN origen_accounts a ON a.id=r.account_id LEFT JOIN origen_review_request_publications p ON p.request_id=r.id
 WHERE r.id=request AND a.auth0_subject=nullif(current_setting('origen.subject',true),'') AND current_setting('origen.purpose',true)='account'
$$;

CREATE OR REPLACE FUNCTION origen_review_request_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action';
 owner uuid; r origen_review_requests%ROWTYPE; c origen_binder_connections%ROWTYPE; p origen_coordinator_profiles%ROWTYPE;
 org origen_institutions%ROWTYPE; orgaccess origen_coordinator_organizations%ROWTYPE; permission integer; student_name text;
 card origen_review_request_previews%ROWTYPE; pub origen_review_request_publications%ROWTYPE;
 entries jsonb; payload jsonb; digest text; wording text; question text; rid uuid;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_request_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('create','get','cancel','remove','export','preview','submit','withdraw') THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 IF action='create' THEN
  IF input-ARRAY['action','studentId','requestKey','connectionId','origin','language','kind','originalQuestion','proposedClarification','entries','enabled']<>'{}'::jsonb THEN RETURN '{"error":"invalid_review_request"}'; END IF;
  IF input->>'enabled' IS DISTINCT FROM 'true' THEN RETURN '{"error":"review_requests_paused"}'; END IF;
  RETURN origen_review_request_base_command(input-'enabled');
 END IF;
 IF action IN ('get','export') THEN RETURN origen_review_request_base_command(input-'enabled'); END IF;
 IF action IN ('cancel','remove','withdraw') AND input-ARRAY['action','studentId','id','version','enabled']<>'{}'::jsonb
  OR action='preview' AND input-ARRAY['action','studentId','id','version','wording','enabled']<>'{}'::jsonb
  OR action='submit' AND input-ARRAY['action','studentId','id','version','previewId','digest','confirmed','enabled']<>'{}'::jsonb THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 IF input-ARRAY['action','studentId','id','version','wording','previewId','digest','confirmed','enabled']<>'{}'::jsonb
  OR input->>'studentId' IS NULL OR input->>'id' IS NULL OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number'
  OR (input->>'version') !~ '^[1-9][0-9]*$' THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 rid:=(input->>'id')::uuid;
 INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
 IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR NO KEY UPDATE;
 SELECT * INTO r FROM origen_review_requests WHERE id=rid AND account_id=owner AND student_id=input->>'studentId';
 IF r.id IS NULL THEN
  IF action='remove' THEN RETURN origen_review_request_base_command(input-'enabled'); END IF;
  RETURN '{"error":"review_request_unavailable"}';
 END IF;
 IF action IN ('cancel','remove','withdraw') THEN
  SELECT * INTO r FROM origen_review_requests WHERE id=rid FOR UPDATE;
  IF r.version IS DISTINCT FROM (input->>'version')::integer THEN RETURN '{"error":"review_request_changed"}'; END IF;
  IF action='cancel' AND r.status NOT IN ('draft','cancelled') OR action='withdraw' AND r.status NOT IN ('submitted','withdrawn') THEN RETURN '{"error":"review_request_changed"}'; END IF;
  PERFORM origen_review_request_invalidate(r.id,'withdrawn');
  IF action='withdraw' THEN
   IF r.status='submitted' THEN UPDATE origen_review_requests SET status='withdrawn',version=3,withdrawn_at=clock_timestamp() WHERE id=r.id; END IF;
   RETURN jsonb_build_object('request',origen_review_request_view(r.id));
  END IF;
  RETURN origen_review_request_base_command(input-'enabled');
 END IF;
 IF input->>'enabled' IS DISTINCT FROM 'true' THEN RETURN '{"error":"review_requests_paused"}'; END IF;
 IF action='submit' THEN
  IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'previewId' IS NULL OR input->>'digest' IS NULL OR input->>'digest' !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"invalid_review_request"}'; END IF;
  SELECT * INTO pub FROM origen_review_request_publications WHERE request_id=r.id;
  IF pub.id IS NOT NULL THEN
   IF pub.preview_id<>(input->>'previewId')::uuid OR pub.digest<>input->>'digest' OR input->>'version'<>'1' THEN RETURN '{"error":"review_request_changed"}'; END IF;
   RETURN jsonb_build_object('request',origen_review_request_view(r.id));
  END IF;
 END IF;
 IF r.status<>'draft' OR r.version IS DISTINCT FROM (input->>'version')::integer THEN RETURN '{"error":"review_request_changed"}'; END IF;
 PERFORM 1 FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
 IF NOT origen_coordinator_student_ready(owner,r.student_id) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT revision INTO permission FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
 SELECT name INTO student_name FROM origen_students WHERE account_id=owner AND id=r.student_id;
 SELECT * INTO org FROM origen_institutions WHERE id=r.institution_id FOR UPDATE;
 SELECT * INTO p FROM origen_coordinator_profiles WHERE id=r.coordinator_id AND institution_id=org.id FOR SHARE;
 SELECT * INTO orgaccess FROM origen_coordinator_organizations WHERE institution_id=org.id FOR SHARE;
 PERFORM 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=p.auth0_subject FOR SHARE;
 IF NOT FOUND OR p.status<>'active' OR orgaccess.status IS DISTINCT FROM 'active' OR org.verification_status<>'verified' OR org.parent_approval<>'approved' OR org.archived_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex') AND blocked) THEN RETURN '{"error":"review_request_denied"}'; END IF;
 SELECT * INTO c FROM origen_binder_connections WHERE id=r.connection_id AND account_id=owner AND student_id=r.student_id AND coordinator_id=p.id FOR UPDATE;
 IF c.id IS NULL OR c.status<>'accepted' THEN RETURN '{"error":"review_request_denied"}'; END IF;
 IF c.revision<>r.connection_revision OR p.revision<>r.coordinator_revision OR orgaccess.revision<>r.organization_revision OR permission<>r.permission_revision
  OR p.display_name<>r.coordinator_name OR org.draft->>'name' IS DISTINCT FROM r.organization_name THEN RETURN '{"error":"review_request_changed"}'; END IF;
 -- Lock sources before request/preview/publication rows to match invalidation.
 PERFORM 1 FROM origen_topic_notes n WHERE n.account_id=owner AND EXISTS(SELECT 1 FROM origen_review_request_entries re WHERE re.request_id=r.id AND re.entry_id=n.id) ORDER BY n.id FOR SHARE;
 PERFORM 1 FROM origen_binder_source_lineage l WHERE EXISTS(SELECT 1 FROM origen_review_request_entries re WHERE re.request_id=r.id AND re.lineage_id=l.id) ORDER BY l.id FOR SHARE;
 SELECT * INTO r FROM origen_review_requests WHERE id=rid FOR UPDATE;
 PERFORM set_config('origen.derived_sharing','false',true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'version',e.source_version,'topic',e.topic,'kind',e.kind,'language',e.language,'content',e.content) ORDER BY e.id),'[]'::jsonb) INTO entries
 FROM origen_review_request_entries re JOIN origen_binder_eligible_entries(owner,r.student_id) e ON e.id=re.entry_id AND e.source_version=re.source_version
  AND e.lineage_id=re.lineage_id AND e.lineage_revision=re.lineage_revision AND e.source_digest=re.source_digest WHERE re.request_id=r.id;
 IF jsonb_array_length(entries)<>(SELECT count(*) FROM origen_review_request_entries WHERE request_id=r.id) THEN RETURN '{"error":"review_request_sources_changed"}'; END IF;
 IF action='preview' THEN wording:=input->>'wording'; ELSE
  SELECT * INTO card FROM origen_review_request_previews WHERE id=(input->>'previewId')::uuid AND request_id=r.id FOR UPDATE;
  IF card.id IS NULL OR card.expires_at<=clock_timestamp() OR card.request_version<>r.version OR card.digest<>input->>'digest' THEN RETURN '{"error":"review_request_preview_changed"}'; END IF;
  wording:=card.wording;
 END IF;
 IF wording IS NULL OR wording NOT IN ('original','clarification') THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 question:=CASE WHEN wording='original' THEN r.original_question ELSE r.proposed_clarification END;
 IF length(btrim(question))=0 THEN RETURN '{"error":"invalid_review_request"}'; END IF;
 payload:=jsonb_build_object('requestId',r.id,'requestVersion',r.version,'studentName',student_name,'question',question,'wording',wording,'kind',r.kind,'language',r.language,
  'coordinatorId',p.id,'coordinatorName',p.display_name,'organizationId',org.id,'organizationName',org.draft->>'name',
  'connectionId',c.id,'connectionRevision',c.revision,'coordinatorRevision',p.revision,'organizationRevision',orgaccess.revision,'permissionRevision',permission,
  'policyVersion','review-request-v1','entries',entries);
 IF action='preview' THEN
  DELETE FROM origen_review_request_previews WHERE request_id=r.id OR account_id=owner AND expires_at<=clock_timestamp();
  card.id:=gen_random_uuid();card.expires_at:=clock_timestamp()+interval '10 minutes';card.access_expires_at:=clock_timestamp()+interval '30 days';
  digest:=encode(sha256(convert_to(jsonb_build_object('payload',payload,'previewId',card.id,'expiresAt',card.expires_at,'accessExpiresAt',card.access_expires_at)::text,'UTF8')),'hex');
  INSERT INTO origen_review_request_previews(id,account_id,student_id,request_id,request_version,wording,digest,payload,expires_at,access_expires_at)
   VALUES(card.id,owner,r.student_id,r.id,r.version,wording,digest,payload,card.expires_at,card.access_expires_at);
  RETURN jsonb_build_object('preview',jsonb_build_object('id',card.id,'digest',digest,'expiresAt',card.expires_at,'accessExpiresAt',card.access_expires_at,'selection',payload));
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('payload',payload,'previewId',card.id,'expiresAt',card.expires_at,'accessExpiresAt',card.access_expires_at)::text,'UTF8')),'hex');
 IF payload<>card.payload OR digest<>card.digest THEN RETURN '{"error":"review_request_preview_changed"}'; END IF;
 INSERT INTO origen_review_request_publications(account_id,student_id,request_id,preview_id,digest,wording,confirmed_by,recipient_subject,payload,expires_at)
 VALUES(owner,r.student_id,r.id,card.id,card.digest,wording,actor,p.auth0_subject,payload,card.access_expires_at) RETURNING * INTO pub;
 UPDATE origen_review_requests SET status='submitted',version=2,submitted_at=pub.published_at WHERE id=r.id;
 DELETE FROM origen_review_request_previews WHERE request_id=r.id;
 PERFORM origen_coordinator_enqueue(owner,r.student_id,p.auth0_subject,'staff',org.id,r.id,pub.id,'review-request','review-request:'||pub.id);
 RETURN jsonb_build_object('request',origen_review_request_view(r.id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_review_request"}';
END $$;

-- Reuse the transactional metadata-only queue. Delivery is deliberately held
-- until step 5 adds the coordinator request destination. No broken UI links.
ALTER TABLE origen_coordinator_outbox DROP CONSTRAINT origen_coordinator_outbox_kind_check;
ALTER TABLE origen_coordinator_outbox ADD CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring','help','review-request'));
DO $$ DECLARE d text; anchor text:='WHERE status=''pending'' AND available_at<=clock_timestamp()'; BEGIN
 d:=pg_get_functiondef('origen_coordinator_maintain()'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_coordinator_delivery_anchor'; END IF;
 EXECUTE replace(d,anchor,'WHERE kind<>''review-request'' AND status=''pending'' AND available_at<=clock_timestamp()');
END $$;
CREATE FUNCTION origen_review_requests_expire() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE rid uuid; BEGIN
 DELETE FROM origen_review_request_previews WHERE expires_at<=clock_timestamp();
 FOR rid IN SELECT request_id FROM origen_review_request_publications WHERE invalidated_at IS NULL AND expires_at<=clock_timestamp() ORDER BY request_id LIMIT 250 LOOP
  PERFORM origen_review_request_invalidate(rid,'expired');
 END LOOP;
END $$;
DO $$ DECLARE d text; anchor text:='v_delivered integer:=0; v_suppressed integer:=0; expired integer:=0;'; BEGIN
 d:=pg_get_functiondef('origen_coordinator_maintain()'::regprocedure);
 IF strpos(d,anchor||E'\nBEGIN')=0 THEN RAISE EXCEPTION 'unexpected_coordinator_maintenance_anchor'; END IF;
 -- Function body has one outer BEGIN immediately after these declarations.
 EXECUTE replace(d,anchor||E'\nBEGIN',anchor||E'\nBEGIN\n PERFORM origen_review_requests_expire();');
END $$;
-- Existing stop-all-sharing also stops request-specific access and previews.
DO $$ DECLARE d text; anchor text:='IF action=''revoke-all'' THEN'; BEGIN
 d:=pg_get_functiondef('origen_binder_sharing_command(jsonb)'::regprocedure);
 IF length(d)-length(replace(d,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'unexpected_stop_sharing_anchor'; END IF;
 EXECUTE replace(d,anchor,anchor||E'\n PERFORM origen_review_request_invalidate(rr.id,''withdrawn'') FROM origen_review_requests rr WHERE rr.account_id=owner AND rr.student_id=student ORDER BY rr.id;');
END $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_review_request_live(uuid)','origen_review_request_invalidate(uuid,text)','origen_review_request_boundary()',
  'origen_review_request_base_command(jsonb)','origen_review_request_base_view(uuid)','origen_review_request_view(uuid)',
  'origen_review_request_command(jsonb)','origen_review_requests_expire()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

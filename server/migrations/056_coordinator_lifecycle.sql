-- Generic notifications are transactional, recipient-scoped, and contain no prose.
ALTER TABLE origen_coordinator_notifications ADD COLUMN audience text NOT NULL DEFAULT 'student' CHECK(audience IN ('student','staff'));
ALTER TABLE origen_coordinator_notifications ADD COLUMN student_id text;
ALTER TABLE origen_coordinator_notifications ADD COLUMN organization_id uuid;
ALTER TABLE origen_coordinator_notifications ADD COLUMN event_key text UNIQUE;
CREATE TABLE origen_coordinator_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 recipient_subject text NOT NULL, audience text NOT NULL CHECK(audience IN ('student','staff')),
 student_id text NOT NULL, organization_id uuid, grant_id uuid NOT NULL, resource_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring')),
 event_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','suppressed','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX origen_coordinator_outbox_pending ON origen_coordinator_outbox(available_at) WHERE status='pending';
-- Content-free creation tombstones prevent an old staff retry from recreating
-- a physically removed receipt with a newly generated feedback UUID.
CREATE TABLE origen_coordinator_feedback_tombstones (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 author_hash text NOT NULL, request_id uuid NOT NULL, feedback_id uuid NOT NULL, deleted boolean NOT NULL DEFAULT false, PRIMARY KEY(author_hash,request_id)
);
INSERT INTO origen_coordinator_feedback_tombstones SELECT account_id,encode(sha256(convert_to(author_subject,'UTF8')),'hex'),request_id,id,false FROM origen_coordinator_feedback;
CREATE FUNCTION origen_coordinator_feedback_creation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 INSERT INTO origen_coordinator_feedback_tombstones VALUES(NEW.account_id,encode(sha256(convert_to(NEW.author_subject,'UTF8')),'hex'),NEW.request_id,NEW.id,false) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM origen_coordinator_feedback_tombstones WHERE author_hash=encode(sha256(convert_to(NEW.author_subject,'UTF8')),'hex') AND request_id=NEW.request_id AND feedback_id=NEW.id AND NOT deleted) THEN RAISE EXCEPTION 'feedback_creation_retired' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_feedback_creation BEFORE INSERT ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_coordinator_feedback_creation();
CREATE FUNCTION origen_coordinator_feedback_tombstone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM origen_accounts WHERE id=OLD.account_id) THEN
  INSERT INTO origen_coordinator_feedback_tombstones VALUES(OLD.account_id,encode(sha256(convert_to(OLD.author_subject,'UTF8')),'hex'),OLD.request_id,OLD.id,true) ON CONFLICT(author_hash,request_id) DO UPDATE SET deleted=true;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER coordinator_feedback_tombstone BEFORE DELETE ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_coordinator_feedback_tombstone();
ALTER FUNCTION origen_coordinator_feedback_command(jsonb) RENAME TO origen_coordinator_feedback_v6;
CREATE FUNCTION origen_coordinator_feedback_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF input->>'action'='staff-create' AND EXISTS(SELECT 1 FROM origen_coordinator_feedback_tombstones WHERE author_hash=current_setting('origen.subject_hash',true) AND request_id=(input->>'requestId')::uuid AND deleted) THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
 RETURN origen_coordinator_feedback_v6(input);
END $$;
CREATE TABLE origen_coordinator_operations (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), last_success_at timestamptz,
 expired_grants integer NOT NULL DEFAULT 0, delivered integer NOT NULL DEFAULT 0, suppressed integer NOT NULL DEFAULT 0
);
INSERT INTO origen_coordinator_operations(id) VALUES(true);
CREATE TABLE origen_coordinator_operation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('authorization_denied','publication_conflict','delivery_failed','report_resolved')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE origen_coordinator_feedback_reports ADD COLUMN resolved_at timestamptz;
ALTER TABLE origen_coordinator_feedback_reports ADD COLUMN resolution text CHECK(resolution IN ('reviewed','coordinator-disabled'));

CREATE FUNCTION origen_coordinator_enqueue(owner uuid, student text, recipient text, audience_name text, org uuid, grant_uuid uuid, resource uuid, event_kind text, dedupe text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 INSERT INTO origen_coordinator_outbox(account_id,student_id,recipient_subject,audience,organization_id,grant_id,resource_id,kind,event_key)
 VALUES(owner,student,recipient,audience_name,org,grant_uuid,resource,event_kind,dedupe) ON CONFLICT(event_key) DO NOTHING
$$;

CREATE FUNCTION origen_coordinator_notify_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
CREATE TRIGGER coordinator_notify_connection AFTER INSERT OR UPDATE ON origen_binder_connections FOR EACH ROW EXECUTE FUNCTION origen_coordinator_notify_change();
CREATE TRIGGER coordinator_notify_publication AFTER UPDATE ON origen_binder_share_grants FOR EACH ROW EXECUTE FUNCTION origen_coordinator_notify_change();
CREATE TRIGGER coordinator_notify_feedback AFTER INSERT OR UPDATE ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_coordinator_notify_change();
CREATE TRIGGER coordinator_notify_reply AFTER INSERT ON origen_coordinator_replies FOR EACH ROW EXECUTE FUNCTION origen_coordinator_notify_change();

-- This helper is internal only; the HTTP command supplies the authenticated actor.
CREATE FUNCTION origen_coordinator_notice_live(owner uuid, student text, recipient text, audience_name text, org uuid, grant_uuid uuid, resource uuid, event_kind text)
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
 IF event_kind='published' THEN RETURN g.current_publication_id=resource; END IF;
 IF event_kind='reply' THEN
  RETURN EXISTS(SELECT 1 FROM origen_coordinator_feedback f WHERE f.id=resource AND f.grant_id=g.id AND f.author_subject=recipient AND f.removed_at IS NULL AND f.withdrawn_at IS NULL
   AND f.topic=ANY(g.topics) AND (f.publication_item_id IS NULL OR EXISTS(SELECT 1 FROM origen_binder_publication_items p JOIN origen_binder_eligible_entries(owner,student) e ON e.lineage_id=p.lineage_id
    WHERE p.id=f.publication_item_id AND p.publication_id=g.current_publication_id AND p.withdrawn_at IS NULL AND p.lineage_revision=e.lineage_revision AND p.source_digest=e.source_digest)));
 END IF;
 RETURN false;
END $$;

-- Narrow maintenance function: no raw table grants, no account content returned.
CREATE FUNCTION origen_coordinator_maintain() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row record; v_delivered integer:=0; v_suppressed integer:=0; expired integer:=0;
BEGIN
 IF coalesce(current_setting('origen.purpose',true),'')<>'retention' THEN RAISE EXCEPTION 'maintenance_required' USING ERRCODE='42501'; END IF;
 UPDATE origen_binder_connections SET status='expired',revision=revision+1 WHERE id IN (SELECT id FROM origen_binder_connections WHERE status='requested' AND expires_at<=clock_timestamp() ORDER BY id LIMIT 250 FOR UPDATE SKIP LOCKED);
 UPDATE origen_coordinator_codes SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at<=clock_timestamp();
 FOR row IN SELECT * FROM origen_binder_share_grants g WHERE status='active' AND (NOT origen_binder_grant_live(id) OR expires_at<clock_timestamp()+interval '7 days' AND NOT EXISTS(SELECT 1 FROM origen_coordinator_outbox o WHERE o.event_key='expiring:'||g.id||':'||g.expires_at::text)) ORDER BY id LIMIT 250 FOR UPDATE SKIP LOCKED LOOP
  IF NOT origen_binder_grant_live(row.id) THEN
   UPDATE origen_binder_share_grants SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,revoked_at=now(),revision=revision+1 WHERE id=row.id;
   INSERT INTO origen_binder_share_events(account_id,grant_id,actor_hash,action,outcome,policy_version,revision,request_id)
    VALUES(row.account_id,row.id,encode(sha256(convert_to('lifecycle','UTF8')),'hex'),'expire','completed','coordinator-sharing-v1',row.revision+1,gen_random_uuid());
   expired:=expired+1;
  ELSIF row.expires_at<clock_timestamp()+interval '7 days' THEN
   PERFORM origen_coordinator_enqueue(row.account_id,row.student_id,row.grantor_subject,'student',NULL,row.id,row.id,'expiring','expiring:'||row.id||':'||row.expires_at::text);
  END IF;
 END LOOP;
 FOR row IN SELECT * FROM origen_coordinator_outbox WHERE status='pending' AND available_at<=clock_timestamp() ORDER BY created_at,id LIMIT 250 FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   IF row.expires_at<=clock_timestamp() OR NOT origen_coordinator_notice_live(row.account_id,row.student_id,row.recipient_subject,row.audience,row.organization_id,row.grant_id,row.resource_id,row.kind) THEN
    UPDATE origen_coordinator_outbox SET status='suppressed',finished_at=now() WHERE id=row.id; v_suppressed:=v_suppressed+1;
   ELSE
    INSERT INTO origen_coordinator_notifications(account_id,student_id,recipient_subject,audience,organization_id,grant_id,resource_id,kind,event_key,expires_at)
     VALUES(row.account_id,row.student_id,row.recipient_subject,row.audience,row.organization_id,row.grant_id,row.resource_id,row.kind,row.event_key,row.expires_at) ON CONFLICT(event_key) DO NOTHING;
    UPDATE origen_coordinator_outbox SET status='delivered',finished_at=now() WHERE id=row.id;v_delivered:=v_delivered+1;
   END IF;
  EXCEPTION WHEN OTHERS THEN
   UPDATE origen_coordinator_outbox SET attempts=attempts+1,available_at=now()+interval '5 minutes',status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE id=row.id;
   INSERT INTO origen_coordinator_operation_events(kind) VALUES('delivery_failed');
  END;
 END LOOP;
 DELETE FROM origen_binder_previews WHERE expires_at<now()-interval '13 minutes';
 DELETE FROM origen_coordinator_link_contexts WHERE expires_at<now()-interval '15 minutes';
 DELETE FROM origen_coordinator_lookup_budgets WHERE window_start<now()-interval '1 day';
 -- Defensive sweep: normal publication/revocation/source triggers already erase bodies immediately.
 UPDATE origen_binder_publication_items p SET content='',withdrawn_at=coalesce(withdrawn_at,now()) WHERE content<>'' AND EXISTS(SELECT 1 FROM origen_binder_publications b WHERE b.id=p.publication_id AND b.invalidated_at IS NOT NULL);
 DELETE FROM origen_coordinator_notifications WHERE expires_at<=now() OR NOT origen_coordinator_notice_live(account_id,student_id,recipient_subject,audience,organization_id,grant_id,resource_id,kind);
 DELETE FROM origen_coordinator_outbox WHERE expires_at<=now();
 DELETE FROM origen_binder_share_events WHERE occurred_at<now()-interval '180 days';
 DELETE FROM origen_coordinator_operation_events WHERE occurred_at<now()-interval '180 days';
 DELETE FROM origen_coordinator_feedback WHERE removed_at IS NOT NULL OR withdrawn_at IS NOT NULL;
 UPDATE origen_coordinator_operations SET last_success_at=now(),expired_grants=expired,delivered=v_delivered,suppressed=v_suppressed WHERE id;
 RETURN jsonb_build_object('expiredGrants',expired,'delivered',v_delivered,'suppressed',v_suppressed);
END $$;

CREATE FUNCTION origen_coordinator_notification_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); audience_name text:=input->>'audience'; action text:=input->>'action'; rows jsonb; item origen_coordinator_notifications%ROWTYPE;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' OR audience_name NOT IN ('student','staff') OR action NOT IN ('list','read','open') THEN RETURN '{"error":"notification_denied"}'; END IF;
 IF audience_name='staff' AND (coalesce(current_setting('origen.coordinator_verified',true),'false')<>'true' OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after)))) THEN RETURN '{"error":"notification_denied"}'; END IF;
 -- Locks order opening a link with staff removal and student revocation. Follow
 -- the same org/profile/grant order as coordinator publication reads.
 IF audience_name='staff' THEN
  PERFORM 1 FROM origen_institutions i WHERE i.id=(input->>'organizationId')::uuid FOR SHARE;
  PERFORM 1 FROM origen_coordinator_profiles p WHERE p.institution_id=(input->>'organizationId')::uuid AND p.auth0_subject=actor FOR SHARE;
 ELSE
  PERFORM 1 FROM origen_accounts WHERE auth0_subject=actor FOR SHARE;
 END IF;
 PERFORM 1 FROM origen_binder_share_grants g WHERE EXISTS(SELECT 1 FROM origen_coordinator_notifications n WHERE n.grant_id=g.id AND n.recipient_subject=actor AND n.audience=audience_name) ORDER BY g.id FOR SHARE;
 IF action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'createdAt',x.created_at,'read',x.read_at IS NOT NULL) ORDER BY x.created_at DESC,x.id),'[]') INTO rows FROM
   (SELECT * FROM origen_coordinator_notifications n WHERE n.recipient_subject=actor AND n.audience=audience_name AND n.expires_at>clock_timestamp()
    AND (audience_name='staff' AND n.organization_id=(input->>'organizationId')::uuid OR audience_name='student' AND n.student_id=input->>'studentId')
    AND origen_coordinator_notice_live(n.account_id,n.student_id,n.recipient_subject,n.audience,n.organization_id,n.grant_id,n.resource_id,n.kind) ORDER BY created_at DESC,id LIMIT 50) x;
  RETURN jsonb_build_object('notifications',rows);
 END IF;
 SELECT * INTO item FROM origen_coordinator_notifications n WHERE n.id=(input->>'id')::uuid AND n.recipient_subject=actor AND n.audience=audience_name
  AND (audience_name='staff' AND n.organization_id=(input->>'organizationId')::uuid OR audience_name='student' AND n.student_id=input->>'studentId') AND n.expires_at>clock_timestamp() FOR UPDATE;
 IF item.id IS NULL OR NOT origen_coordinator_notice_live(item.account_id,item.student_id,item.recipient_subject,item.audience,item.organization_id,item.grant_id,item.resource_id,item.kind) THEN RETURN '{"error":"notification_unavailable"}'; END IF;
 UPDATE origen_coordinator_notifications SET read_at=coalesce(read_at,now()) WHERE id=item.id;
 IF action='read' THEN RETURN '{"status":"read"}'; END IF;
 -- No contents are delivered here. The destination always authorizes again.
 RETURN jsonb_build_object('destination',CASE WHEN item.kind IN ('requested','accepted') THEN 'connections' WHEN item.kind IN ('feedback','reply') THEN 'guidance' WHEN item.kind IN ('revoked','expiring') THEN 'sharing' ELSE 'binder' END,'grantId',item.grant_id,'studentId',item.student_id,'organizationId',item.organization_id);
END $$;

-- Student account export is deliberately separate from coordinator reads.
CREATE FUNCTION origen_coordinator_export() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid; result jsonb;
BEGIN
 IF coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RAISE EXCEPTION 'account_required' USING ERRCODE='42501'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=current_setting('origen.subject',true);
 SELECT jsonb_build_object('connections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'studentId',student_id,'status',status,'createdAt',created_at,'expiresAt',expires_at)) FROM origen_binder_connections WHERE account_id=owner),'[]'),
  'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'studentId',student_id,'topics',topics,'status',status,'expiresAt',expires_at)) FROM origen_binder_share_grants WHERE account_id=owner),'[]'),
  'guidance',coalesce((SELECT jsonb_agg(to_jsonb(f)-ARRAY['author_subject','request_id']) FROM origen_coordinator_feedback f WHERE account_id=owner AND removed_at IS NULL),'[]'),
  'guidanceRevisions',coalesce((SELECT jsonb_agg(to_jsonb(r)-'author_subject') FROM origen_coordinator_feedback_revisions r WHERE account_id=owner),'[]'),
  'replies',coalesce((SELECT jsonb_agg(to_jsonb(r)-'request_id') FROM origen_coordinator_replies r WHERE account_id=owner),'[]')) INTO result;
 RETURN result||jsonb_build_object('coordinatorProfiles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'organizationId',institution_id,'displayName',display_name,'status',status,'createdAt',created_at)) FROM origen_coordinator_profiles WHERE auth0_subject=current_setting('origen.subject',true)),'[]'));
END $$;

-- Removal and author withdrawal are deletion evidence, not merely UI states.
ALTER TABLE origen_deletion_journal DROP CONSTRAINT origen_deletion_journal_kind_check;
ALTER TABLE origen_deletion_journal ADD CHECK(kind IN ('account','student','summary','note','plan','sheet','memory','coordinator-feedback'));
CREATE TRIGGER coordinator_feedback_delete BEFORE DELETE ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_record_deletion('coordinator-feedback');
CREATE TRIGGER coordinator_feedback_no_resurrection BEFORE INSERT ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_prevent_resurrection('coordinator-feedback');
CREATE FUNCTION origen_coordinator_feedback_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.removed_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN
  INSERT INTO origen_deletion_journal(subject_hash,account_id,kind,record_id)
   SELECT encode(sha256(convert_to(auth0_subject,'UTF8')),'hex'),NEW.account_id,'coordinator-feedback',NEW.id::text FROM origen_accounts WHERE id=NEW.account_id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_feedback_erasure AFTER UPDATE ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_coordinator_feedback_erasure();

-- Operator dashboard returns aggregate counters and content-free abuse receipts.
CREATE FUNCTION origen_coordinator_operations_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE rows jsonb; r origen_coordinator_feedback_reports%ROWTYPE; f origen_coordinator_feedback%ROWTYPE;
BEGIN
 IF coalesce(current_setting('origen.purpose',true),'')<>'account' OR coalesce(current_setting('origen.coordinator_verified',true),'false')<>'true' OR coalesce(current_setting('origen.coordinator_admin',true),'false')<>'true'
  OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=current_setting('origen.subject_hash',true) AND (blocked OR coalesce(nullif(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN RETURN '{"error":"notification_denied"}'; END IF;
 IF input->>'action'='retry-deliveries' THEN
  UPDATE origen_coordinator_outbox SET status='pending',attempts=0,available_at=now() WHERE status='failed' AND expires_at>now();
  RETURN '{"status":"queued"}';
 END IF;
 IF input->>'action'='resolve-report' THEN
  SELECT * INTO r FROM origen_coordinator_feedback_reports WHERE feedback_id=(input->>'id')::uuid FOR UPDATE;
  IF r.feedback_id IS NULL THEN RETURN '{"error":"notification_unavailable"}'; END IF;
  IF r.resolved_at IS NOT NULL THEN
   IF r.resolution<>input->>'resolution' THEN RETURN '{"error":"report_conflict"}'; END IF;
   RETURN '{"status":"resolved"}';
  END IF;
  IF input->>'resolution' NOT IN ('reviewed','coordinator-disabled') THEN RETURN '{"error":"notification_denied"}'; END IF;
  IF input->>'resolution'='coordinator-disabled' THEN
   SELECT * INTO f FROM origen_coordinator_feedback WHERE id=r.feedback_id;
   UPDATE origen_coordinator_profiles SET status='disabled',revision=revision+1 WHERE auth0_subject=f.author_subject AND status='active';
  END IF;
  UPDATE origen_coordinator_feedback_reports SET resolved_at=now(),resolution=input->>'resolution' WHERE feedback_id=r.feedback_id;
  INSERT INTO origen_coordinator_operation_events(kind) VALUES('report_resolved');
  RETURN '{"status":"resolved"}';
 END IF;
 IF input->>'action'<>'operations' THEN RETURN '{"error":"notification_denied"}'; END IF;
 SELECT jsonb_build_object('lastSuccessAt',last_success_at,'expiredGrants',expired_grants,'delivered',delivered,'suppressed',suppressed,
  'pending',(SELECT count(*) FROM origen_coordinator_outbox WHERE status='pending'),
  'failed',(SELECT count(*) FROM origen_coordinator_outbox WHERE status='failed'),
  'oldestPendingSeconds',coalesce((SELECT greatest(0,extract(epoch FROM now()-min(created_at))) FROM origen_coordinator_outbox WHERE status='pending'),0),
  'events24h',(SELECT coalesce(jsonb_object_agg(kind,n),'{}') FROM (SELECT kind,count(*) n FROM origen_coordinator_operation_events WHERE occurred_at>now()-interval '24 hours' GROUP BY kind) e),
  'reports',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',feedback_id,'reason',reason,'createdAt',created_at) ORDER BY created_at),'[]') FROM (SELECT * FROM origen_coordinator_feedback_reports WHERE resolved_at IS NULL ORDER BY created_at LIMIT 50) r)) INTO rows FROM origen_coordinator_operations;
 RETURN rows;
END $$;
CREATE FUNCTION origen_coordinator_record_operation(event_kind text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 INSERT INTO origen_coordinator_operation_events(kind) SELECT event_kind WHERE current_setting('origen.purpose',true)='account' AND nullif(current_setting('origen.subject',true),'') IS NOT NULL AND event_kind IN ('authorization_denied','publication_conflict')
$$;

DO $$ DECLARE tab text; fn text; BEGIN
 FOREACH tab IN ARRAY ARRAY['origen_coordinator_outbox','origen_coordinator_operations','origen_coordinator_operation_events','origen_coordinator_feedback_tombstones'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab); EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tab);
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['origen_coordinator_feedback_creation()','origen_coordinator_feedback_command(jsonb)','origen_coordinator_feedback_tombstone()','origen_coordinator_enqueue(uuid,text,text,text,uuid,uuid,uuid,text,text)','origen_coordinator_notify_change()','origen_coordinator_notice_live(uuid,text,text,text,uuid,uuid,uuid,text)','origen_coordinator_maintain()','origen_coordinator_notification_command(jsonb)','origen_coordinator_export()','origen_coordinator_feedback_erasure()','origen_coordinator_operations_command(jsonb)','origen_coordinator_record_operation(text)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn,current_schema()); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

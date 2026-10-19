-- Phase 1 stores private lineage and prepares sharing records. There are NO
-- coordinator policies or application write grants on the sharing tables yet.
CREATE TABLE origen_coordinator_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL,
 auth0_subject text NOT NULL,
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','active','revoked')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,auth0_subject) REFERENCES origen_institution_members(institution_id,auth0_subject) ON DELETE CASCADE,
 UNIQUE(institution_id,auth0_subject)
);
CREATE TABLE origen_coordinator_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 revoked_at timestamptz
);
CREATE INDEX origen_coordinator_codes_owner ON origen_coordinator_codes(coordinator_id,expires_at);
CREATE TABLE origen_binder_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','declined','expired','revoked')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 accepted_at timestamptz,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,request_id), UNIQUE(account_id,student_id,coordinator_id,id),
 CHECK(status<>'accepted' OR accepted_at IS NOT NULL)
);
CREATE UNIQUE INDEX origen_binder_connection_live ON origen_binder_connections(account_id,student_id,coordinator_id) WHERE status IN ('requested','accepted');
CREATE INDEX origen_binder_connections_recipient ON origen_binder_connections(coordinator_id,status);
CREATE TABLE origen_binder_share_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 coordinator_id uuid NOT NULL,
 connection_id uuid NOT NULL,
 grantor_subject text NOT NULL,
 topics text[] NOT NULL CHECK(cardinality(topics)>0 AND array_position(topics,NULL) IS NULL AND topics<@ARRAY['options','transfer','costs','applications']::text[]),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 permission_revision integer NOT NULL CHECK(permission_revision>0),
 coordinator_revision integer NOT NULL CHECK(coordinator_revision>0),
 connection_revision integer NOT NULL CHECK(connection_revision>0),
 notice_version text NOT NULL CHECK(length(notice_version) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 revoked_at timestamptz,
 current_publication_id uuid,
 FOREIGN KEY(account_id,student_id,coordinator_id,connection_id) REFERENCES origen_binder_connections(account_id,student_id,coordinator_id,id) ON DELETE CASCADE,
 UNIQUE(connection_id), UNIQUE(account_id,student_id,id),
 CHECK(status<>'revoked' OR revoked_at IS NOT NULL)
);
CREATE INDEX origen_binder_grants_recipient ON origen_binder_share_grants(coordinator_id,status,expires_at);
CREATE TABLE origen_binder_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 grant_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 grant_revision integer NOT NULL CHECK(grant_revision>0),
 preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),
 confirmation_id uuid NOT NULL UNIQUE,
 confirmed_by text NOT NULL,
 policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100),
 published_at timestamptz NOT NULL DEFAULT now(),
 invalidated_at timestamptz,
 FOREIGN KEY(account_id,student_id,grant_id) REFERENCES origen_binder_share_grants(account_id,student_id,id) ON DELETE CASCADE,
 UNIQUE(grant_id,version), UNIQUE(account_id,student_id,grant_id,id)
);
ALTER TABLE origen_binder_share_grants ADD CONSTRAINT origen_binder_current_publication
 FOREIGN KEY(account_id,student_id,id,current_publication_id) REFERENCES origen_binder_publications(account_id,student_id,grant_id,id) DEFERRABLE INITIALLY DEFERRED;

-- Content-free, current source evidence. No existing source is certified safe.
CREATE TABLE origen_binder_source_lineage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 student_id text,
 source_kind text NOT NULL CHECK(source_kind IN ('summary','note')),
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 classification text NOT NULL DEFAULT 'unknown' CHECK(classification IN ('unknown','student_only','family','parent','mixed')),
 complete boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 source_version integer NOT NULL DEFAULT 1 CHECK(source_version>0),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,source_kind,source_id), UNIQUE(account_id,id), UNIQUE(account_id,student_id,id),
 CHECK(classification<>'student_only' OR student_id IS NOT NULL AND complete)
);
CREATE TABLE origen_binder_source_edges (
 account_id uuid NOT NULL,
 derived_id uuid NOT NULL,
 source_id uuid NOT NULL,
 PRIMARY KEY(account_id,derived_id,source_id),
 FOREIGN KEY(account_id,derived_id) REFERENCES origen_binder_source_lineage(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,source_id) REFERENCES origen_binder_source_lineage(account_id,id) ON DELETE CASCADE,
 CHECK(derived_id<>source_id)
);
CREATE INDEX origen_binder_source_parent ON origen_binder_source_edges(account_id,source_id);
CREATE TABLE origen_binder_publication_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 grant_id uuid NOT NULL,
 publication_id uuid NOT NULL,
 lineage_id uuid NOT NULL,
 lineage_revision integer NOT NULL CHECK(lineage_revision>0),
 source_version integer NOT NULL CHECK(source_version>0),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 topic text NOT NULL CHECK(topic IN ('options','transfer','costs','applications')),
 kind text NOT NULL CHECK(kind IN ('note','question','explanation','decision')),
 language text NOT NULL CHECK(language IN ('en','es')),
 content text NOT NULL CHECK(length(content)<=2000),
 withdrawn_at timestamptz,
 FOREIGN KEY(account_id,student_id,grant_id,publication_id) REFERENCES origen_binder_publications(account_id,student_id,grant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,student_id,lineage_id) REFERENCES origen_binder_source_lineage(account_id,student_id,id) ON DELETE CASCADE,
 UNIQUE(publication_id,lineage_id), UNIQUE(account_id,student_id,grant_id,id),
 CHECK((withdrawn_at IS NULL AND length(btrim(content))>0) OR (withdrawn_at IS NOT NULL AND content=''))
);
CREATE INDEX origen_binder_publication_source ON origen_binder_publication_items(account_id,lineage_id);
CREATE TABLE origen_coordinator_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 grant_id uuid NOT NULL,
 publication_item_id uuid,
 author_subject text NOT NULL,
 author_name text NOT NULL CHECK(length(btrim(author_name)) BETWEEN 1 AND 100),
 organization_name text NOT NULL CHECK(length(btrim(organization_name)) BETWEEN 1 AND 200),
 topic text NOT NULL CHECK(topic IN ('options','transfer','costs','applications')),
 kind text NOT NULL CHECK(kind IN ('guidance','resource','suggested-step')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz,
 withdrawn_at timestamptz,
 -- Feedback survives grant/membership removal as a student-owned receipt.
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,student_id,grant_id,id), UNIQUE(author_subject,request_id)
);
CREATE TABLE origen_coordinator_feedback_revisions (
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 grant_id uuid NOT NULL,
 feedback_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 author_subject text NOT NULL,
 body text NOT NULL CHECK(length(body)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(feedback_id,version),
 FOREIGN KEY(account_id,student_id,grant_id,feedback_id) REFERENCES origen_coordinator_feedback(account_id,student_id,grant_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_coordinator_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 student_id text NOT NULL,
 grant_id uuid NOT NULL,
 feedback_id uuid NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,student_id,grant_id,feedback_id) REFERENCES origen_coordinator_feedback(account_id,student_id,grant_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,request_id)
);
CREATE TABLE origen_binder_share_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 grant_id uuid NOT NULL,
 actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('request','accept','decline','publish','withdraw','revoke','read','feedback','reply','expire')),
 outcome text NOT NULL CHECK(outcome IN ('allowed','denied','completed')),
 policy_version text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_binder_share_events_expiry ON origen_binder_share_events(occurred_at);
CREATE TABLE origen_coordinator_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 recipient_subject text NOT NULL,
 grant_id uuid NOT NULL,
 resource_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('requested','accepted','published','feedback','reply','revoked','expiring')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 read_at timestamptz
);
CREATE INDEX origen_coordinator_notifications_recipient ON origen_coordinator_notifications(recipient_subject,expires_at);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_coordinator_profiles','origen_coordinator_codes','origen_binder_connections','origen_binder_share_grants','origen_binder_publications','origen_binder_publication_items','origen_binder_source_lineage','origen_binder_source_edges','origen_coordinator_feedback','origen_coordinator_feedback_revisions','origen_coordinator_replies','origen_binder_share_events','origen_coordinator_notifications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 END LOOP;
END $$;
CREATE POLICY own_lineage ON origen_binder_source_lineage FOR SELECT USING(account_id=(SELECT origen_current_account_id()));
CREATE POLICY own_lineage_edges ON origen_binder_source_edges FOR SELECT USING(account_id=(SELECT origen_current_account_id()));
-- All other new tables intentionally have zero runtime policies in Phase 1.

CREATE FUNCTION origen_binder_restrict_classification(a text,b text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN a='mixed' OR b='mixed' OR a='parent' AND b='family' OR a='family' AND b='parent' THEN 'mixed'
  WHEN a='parent' OR b='parent' THEN 'parent' WHEN a='family' OR b='family' THEN 'family'
  WHEN a='student_only' AND b='student_only' THEN 'student_only' ELSE 'unknown' END
$$;

-- Invalidation is synchronous with edits, deletions, and protection changes.
CREATE FUNCTION origen_binder_invalidate_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  WITH RECURSIVE affected(id) AS (
   SELECT OLD.id UNION SELECT e.derived_id FROM origen_binder_source_edges e JOIN affected a ON a.id=e.source_id WHERE e.account_id=OLD.account_id
  ) DELETE FROM origen_binder_publication_items WHERE account_id=OLD.account_id AND lineage_id IN (SELECT id FROM affected);
 ELSE
  WITH RECURSIVE affected(id) AS (
   SELECT OLD.id UNION SELECT e.derived_id FROM origen_binder_source_edges e JOIN affected a ON a.id=e.source_id WHERE e.account_id=OLD.account_id
  ) UPDATE origen_binder_publication_items SET content='',withdrawn_at=coalesce(withdrawn_at,now())
    WHERE account_id=OLD.account_id AND lineage_id IN (SELECT id FROM affected);
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.classification IS DISTINCT FROM OLD.classification OR NEW.complete IS DISTINCT FROM OLD.complete OR NEW.active IS DISTINCT FROM OLD.active OR NEW.source_digest IS DISTINCT FROM OLD.source_digest THEN
   UPDATE origen_binder_source_lineage l SET classification=origen_binder_restrict_classification(origen_binder_restrict_classification(l.classification,NEW.classification),'unknown'),complete=false,revision=revision+1,updated_at=now()
    WHERE l.account_id=NEW.account_id AND l.id IN (SELECT derived_id FROM origen_binder_source_edges WHERE account_id=NEW.account_id AND source_id=NEW.id);
  END IF;
  RETURN NEW;
 END IF;
 -- Descendants that outlive a source remain private, even after an edge cascades.
 IF NOT EXISTS(SELECT 1 FROM origen_accounts WHERE id=OLD.account_id) THEN RETURN OLD; END IF;
 UPDATE origen_binder_source_lineage l SET classification=origen_binder_restrict_classification(origen_binder_restrict_classification(l.classification,OLD.classification),'unknown'),complete=false,active=false,revision=revision+1,updated_at=now()
  WHERE l.account_id=OLD.account_id AND (l.student_id IS NULL OR EXISTS(SELECT 1 FROM origen_students WHERE account_id=l.account_id AND id=l.student_id)) AND l.id IN (SELECT derived_id FROM origen_binder_source_edges WHERE account_id=OLD.account_id AND source_id=OLD.id);
 RETURN OLD;
END $$;
CREATE TRIGGER binder_lineage_change AFTER UPDATE ON origen_binder_source_lineage FOR EACH ROW EXECUTE FUNCTION origen_binder_invalidate_source();
CREATE TRIGGER binder_lineage_delete BEFORE DELETE ON origen_binder_source_lineage FOR EACH ROW EXECUTE FUNCTION origen_binder_invalidate_source();

CREATE FUNCTION origen_binder_track_edge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner_id uuid; derived uuid; parent_id uuid; label text;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'binder_lineage_edge_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  owner_id:=NEW.account_id;derived:=NEW.derived_id;parent_id:=NEW.source_id;
  -- Serialize graph changes per account so concurrent edges cannot form a cycle.
  PERFORM 1 FROM origen_accounts WHERE id=owner_id FOR UPDATE;
  IF EXISTS(WITH RECURSIVE ancestors(id) AS (
   SELECT parent_id UNION SELECT e.source_id FROM origen_binder_source_edges e JOIN ancestors a ON a.id=e.derived_id WHERE e.account_id=owner_id
  ) SELECT 1 FROM ancestors WHERE id=derived) THEN RAISE EXCEPTION 'binder_lineage_cycle' USING ERRCODE='23514'; END IF;
  SELECT classification INTO label FROM origen_binder_source_lineage WHERE account_id=owner_id AND id=parent_id;
 ELSE owner_id:=OLD.account_id;derived:=OLD.derived_id;label:='unknown'; END IF;
 IF EXISTS(SELECT 1 FROM origen_accounts WHERE id=owner_id) THEN
  UPDATE origen_binder_source_lineage l SET classification=origen_binder_restrict_classification(origen_binder_restrict_classification(l.classification,coalesce(label,'unknown')),'unknown'),complete=false,revision=revision+1,updated_at=now()
   WHERE l.account_id=owner_id AND l.id=derived AND (l.student_id IS NULL OR EXISTS(SELECT 1 FROM origen_students WHERE account_id=l.account_id AND id=l.student_id));
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_edge_protection BEFORE INSERT OR UPDATE OR DELETE ON origen_binder_source_edges FOR EACH ROW EXECUTE FUNCTION origen_binder_track_edge();

CREATE FUNCTION origen_binder_track_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE k text; label text; actor text; source uuid; parent_source uuid; note_version integer; digest text;
BEGIN
 k:=CASE WHEN TG_TABLE_NAME='origen_topic_notes' THEN 'note' ELSE 'summary' END;
 IF TG_OP='DELETE' THEN
  DELETE FROM origen_binder_source_lineage WHERE account_id=OLD.account_id AND source_kind=k AND source_id=OLD.id::text;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
 SELECT role INTO actor FROM origen_accounts WHERE id=NEW.account_id;
 label:=CASE WHEN NEW.student_id IS NULL THEN 'family' WHEN actor='parent' THEN 'parent' ELSE 'unknown' END;
 note_version:=CASE WHEN k='note' THEN (to_jsonb(NEW)->>'version')::integer ELSE 1 END;
 digest:=encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex');
 IF k='note' THEN
  IF NEW.source_summary_id IS NOT NULL THEN
   SELECT id,origen_binder_restrict_classification(label,classification) INTO parent_source,label FROM origen_binder_source_lineage
    WHERE account_id=NEW.account_id AND source_kind='summary' AND source_id=NEW.source_summary_id;
   label:=coalesce(label,'unknown');
  END IF;
 END IF;
 INSERT INTO origen_binder_source_lineage(account_id,student_id,source_kind,source_id,classification,source_version,source_digest)
  VALUES(NEW.account_id,NEW.student_id,k,NEW.id::text,label,note_version,digest)
  ON CONFLICT(account_id,source_kind,source_id) DO UPDATE SET
   classification=origen_binder_restrict_classification(origen_binder_source_lineage.classification,EXCLUDED.classification),
   complete=false,revision=origen_binder_source_lineage.revision+1,source_version=EXCLUDED.source_version,source_digest=EXCLUDED.source_digest,updated_at=now()
  RETURNING id INTO source;
 IF parent_source IS NOT NULL THEN INSERT INTO origen_binder_source_edges VALUES(NEW.account_id,source,parent_source) ON CONFLICT DO NOTHING; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_summary_source AFTER INSERT OR UPDATE OR DELETE ON origen_conversation_summaries FOR EACH ROW EXECUTE FUNCTION origen_binder_track_source();
CREATE TRIGGER binder_note_source AFTER INSERT OR UPDATE OR DELETE ON origen_topic_notes FOR EACH ROW EXECUTE FUNCTION origen_binder_track_source();

-- Late session attribution can only add protection. A new student segment does
-- not erase family context from the same live conversation.
CREATE FUNCTION origen_binder_protect_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE who uuid; session uuid;
BEGIN
 who:=NEW.account_id;
 IF TG_TABLE_NAME='origen_summary_segments' THEN SELECT session_id INTO session FROM origen_guidance_segments WHERE account_id=who AND id=NEW.segment_id;
 ELSIF TG_TABLE_NAME='origen_guidance_sessions' THEN session:=NEW.id;
 ELSE session:=NEW.session_id; END IF;
 IF EXISTS(SELECT 1 FROM origen_guidance_sessions WHERE account_id=who AND id=session AND actor_role='parent') OR
    EXISTS(SELECT 1 FROM origen_guidance_segments WHERE account_id=who AND session_id=session AND target_kind IN ('family','unresolved')) THEN
  UPDATE origen_binder_source_lineage SET classification='mixed',complete=false,revision=revision+1,updated_at=now()
   WHERE account_id=who AND source_kind='summary' AND source_id IN (SELECT x.summary_id FROM origen_summary_segments x JOIN origen_guidance_segments g ON g.account_id=x.account_id AND g.id=x.segment_id WHERE x.account_id=who AND g.session_id=session) AND classification<>'mixed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_session_protection AFTER INSERT OR UPDATE ON origen_guidance_sessions FOR EACH ROW EXECUTE FUNCTION origen_binder_protect_session();
CREATE TRIGGER binder_segment_protection AFTER INSERT OR UPDATE ON origen_guidance_segments FOR EACH ROW EXECUTE FUNCTION origen_binder_protect_session();
CREATE TRIGGER binder_summary_attribution AFTER INSERT OR UPDATE ON origen_summary_segments FOR EACH ROW EXECUTE FUNCTION origen_binder_protect_session();

CREATE FUNCTION origen_binder_account_protection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.role IS DISTINCT FROM OLD.role THEN
  UPDATE origen_binder_source_lineage SET classification=origen_binder_restrict_classification(classification,CASE WHEN NEW.role='parent' THEN 'parent' ELSE 'unknown' END),complete=false,revision=revision+1,updated_at=now() WHERE account_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_account_role AFTER UPDATE OF role ON origen_accounts FOR EACH ROW EXECUTE FUNCTION origen_binder_account_protection();

CREATE FUNCTION origen_binder_suppress_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NEW.suppressed THEN
  UPDATE origen_binder_source_lineage SET classification=origen_binder_restrict_classification(classification,'unknown'),complete=false,active=false,revision=revision+1,updated_at=now()
   WHERE account_id=NEW.account_id AND source_kind='summary' AND source_id=NEW.summary_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_memory_suppression AFTER INSERT OR UPDATE ON origen_memory_batches FOR EACH ROW EXECUTE FUNCTION origen_binder_suppress_source();

-- Even privileged fixtures cannot publish a protected, stale, or wrong-scope
-- source. The future publication service must additionally enforce the full
-- consent/membership policy. Application writes are unavailable in Phase 1.
CREATE FUNCTION origen_binder_validate_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE source origen_binder_source_lineage%ROWTYPE; n origen_topic_notes%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.withdrawn_at IS NOT NULL AND NEW.content='' THEN RETURN NEW; END IF;
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
CREATE TRIGGER binder_item_guard BEFORE INSERT OR UPDATE ON origen_binder_publication_items FOR EACH ROW EXECUTE FUNCTION origen_binder_validate_item();

CREATE FUNCTION origen_binder_feedback_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM origen_binder_share_grants g JOIN origen_coordinator_profiles p ON p.id=g.coordinator_id
  WHERE g.account_id=NEW.account_id AND g.student_id=NEW.student_id AND g.id=NEW.grant_id AND g.status='active' AND g.revoked_at IS NULL AND g.expires_at>now() AND NEW.topic=ANY(g.topics) AND p.auth0_subject=NEW.author_subject AND p.status='active') THEN RAISE EXCEPTION 'binder_grant_unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.publication_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_binder_publication_items WHERE account_id=NEW.account_id AND student_id=NEW.student_id AND grant_id=NEW.grant_id AND id=NEW.publication_item_id AND topic=NEW.topic AND withdrawn_at IS NULL) THEN RAISE EXCEPTION 'binder_item_unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER binder_feedback_scope BEFORE INSERT OR UPDATE ON origen_coordinator_feedback FOR EACH ROW EXECUTE FUNCTION origen_binder_feedback_parent();

-- Lock all helper search paths to this migration's schema; no callable
-- SECURITY DEFINER capability is handed to HTTP or maintenance roles.
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_binder_restrict_classification(text,text)','origen_binder_invalidate_source()','origen_binder_track_edge()','origen_binder_track_source()','origen_binder_protect_session()','origen_binder_account_protection()','origen_binder_suppress_source()','origen_binder_validate_item()','origen_binder_feedback_parent()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

-- Conservative metadata backfill; no content, consent, or sharing is inferred.
INSERT INTO origen_binder_source_lineage(account_id,student_id,source_kind,source_id,classification,source_digest)
 SELECT s.account_id,s.student_id,'summary',s.id,CASE WHEN s.student_id IS NULL THEN 'family' WHEN a.role='parent' THEN 'parent' ELSE 'unknown' END,
 encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM origen_conversation_summaries s JOIN origen_accounts a ON a.id=s.account_id;
INSERT INTO origen_binder_source_lineage(account_id,student_id,source_kind,source_id,classification,source_version,source_digest)
 SELECT n.account_id,n.student_id,'note',n.id::text,origen_binder_restrict_classification(CASE WHEN n.student_id IS NULL THEN 'family' WHEN a.role='parent' THEN 'parent' ELSE 'unknown' END,coalesce(s.classification,'unknown')),n.version,
 encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex') FROM origen_topic_notes n JOIN origen_accounts a ON a.id=n.account_id
 LEFT JOIN origen_binder_source_lineage s ON s.account_id=n.account_id AND s.source_kind='summary' AND s.source_id=n.source_summary_id;
INSERT INTO origen_binder_source_edges(account_id,derived_id,source_id)
 SELECT n.account_id,l.id,s.id FROM origen_topic_notes n JOIN origen_binder_source_lineage l ON l.account_id=n.account_id AND l.source_kind='note' AND l.source_id=n.id::text
 JOIN origen_binder_source_lineage s ON s.account_id=n.account_id AND s.source_kind='summary' AND s.source_id=n.source_summary_id;
UPDATE origen_binder_source_lineage l SET classification='mixed',revision=revision+1 WHERE l.source_kind='summary' AND EXISTS(
 SELECT 1 FROM origen_summary_segments x JOIN origen_guidance_segments seg ON seg.account_id=x.account_id AND seg.id=x.segment_id JOIN origen_guidance_sessions s ON s.account_id=seg.account_id AND s.id=seg.session_id
 WHERE x.account_id=l.account_id AND x.summary_id=l.source_id AND (s.actor_role='parent' OR EXISTS(SELECT 1 FROM origen_guidance_segments g WHERE g.account_id=s.account_id AND g.session_id=s.id AND g.target_kind IN ('family','unresolved')))
);
UPDATE origen_binder_source_lineage l SET active=false,revision=revision+1 WHERE l.source_kind='summary' AND EXISTS(SELECT 1 FROM origen_memory_batches b WHERE b.account_id=l.account_id AND b.summary_id=l.source_id AND b.suppressed);

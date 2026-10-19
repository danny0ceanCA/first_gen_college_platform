-- Connection metadata only. No binder, summary, transcript or family content.
CREATE TABLE origen_coordinator_student_pilots (
 account_id uuid NOT NULL, student_id text NOT NULL,
 permission_revision integer NOT NULL CHECK(permission_revision>0),
 approved_by text NOT NULL CHECK(length(btrim(approved_by))>0),
 approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,student_id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_coordinator_link_contexts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 student_id text NOT NULL, channel text NOT NULL CHECK(channel IN ('screen','voice')),
 sequence integer NOT NULL DEFAULT 0 CHECK(sequence>=0), turn_id text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour', closed boolean NOT NULL DEFAULT false,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_coordinator_link_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), context_id uuid NOT NULL REFERENCES origen_coordinator_link_contexts(id) ON DELETE CASCADE,
 sequence integer NOT NULL, code_id uuid NOT NULL REFERENCES origen_coordinator_codes(id) ON DELETE CASCADE,
 coordinator_revision integer NOT NULL, organization_revision integer NOT NULL,
 coordinator_name text NOT NULL, organization_name text NOT NULL, student_name text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes', prepared boolean NOT NULL DEFAULT false,
 connection_id uuid REFERENCES origen_binder_connections(id) ON DELETE CASCADE
);
CREATE TABLE origen_coordinator_lookup_budgets (
 key text PRIMARY KEY CHECK(key ~ '^[an]:[a-f0-9]{64}$'),
 window_start timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0
);
CREATE FUNCTION origen_coordinator_revoke_student_pilot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 DELETE FROM origen_coordinator_link_contexts WHERE account_id=OLD.account_id AND student_id=OLD.student_id;
 UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE account_id=OLD.account_id AND student_id=OLD.student_id AND status IN ('requested','accepted');
 UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),revision=revision+1,current_publication_id=NULL WHERE account_id=OLD.account_id AND student_id=OLD.student_id AND status<>'revoked';
 RETURN OLD;
END $$;
CREATE TRIGGER coordinator_revoke_student_pilot AFTER DELETE ON origen_coordinator_student_pilots FOR EACH ROW EXECUTE FUNCTION origen_coordinator_revoke_student_pilot();
CREATE FUNCTION origen_coordinator_student_boundary_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_TABLE_NAME='origen_accounts' THEN
  IF NEW.role IS DISTINCT FROM OLD.role THEN DELETE FROM origen_coordinator_student_pilots WHERE account_id=NEW.id; END IF;
 ELSIF TG_TABLE_NAME='origen_eligibility' THEN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.revision IS DISTINCT FROM OLD.revision THEN
   DELETE FROM origen_coordinator_student_pilots WHERE account_id IN (SELECT id FROM origen_accounts WHERE encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')=NEW.subject_hash);
  END IF;
 ELSE
  DELETE FROM origen_coordinator_student_pilots WHERE (account_id=NEW.owner_account_id AND student_id=NEW.owner_student_id) OR (account_id=NEW.member_account_id AND student_id=NEW.member_student_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinator_student_role_change AFTER UPDATE OF role ON origen_accounts FOR EACH ROW EXECUTE FUNCTION origen_coordinator_student_boundary_change();
CREATE TRIGGER coordinator_student_permission_change AFTER UPDATE OF status,revision ON origen_eligibility FOR EACH ROW EXECUTE FUNCTION origen_coordinator_student_boundary_change();
CREATE TRIGGER coordinator_student_family_link AFTER INSERT OR UPDATE ON origen_student_links FOR EACH ROW EXECUTE FUNCTION origen_coordinator_student_boundary_change();
ALTER TABLE origen_binder_connections ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK(length(display_name)<=100);
ALTER TABLE origen_binder_connections ADD COLUMN intended_topics text[] NOT NULL DEFAULT '{}' CHECK(intended_topics<@ARRAY['options','transfer','costs','applications']::text[] AND array_position(intended_topics,NULL) IS NULL);

CREATE FUNCTION origen_coordinator_student_ready(owner uuid, student text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM origen_accounts a JOIN origen_coordinator_student_pilots p ON p.account_id=a.id
 JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
 WHERE a.id=owner AND a.role='student' AND p.student_id=student AND e.status='adult' AND e.revision=p.permission_revision
 AND NOT EXISTS(SELECT 1 FROM origen_student_links l WHERE (l.member_account_id=owner AND l.member_student_id=student) OR (l.owner_account_id=owner AND l.owner_student_id=student)))
$$;

CREATE FUNCTION origen_coordinator_connection_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 actor text:=NULLIF(current_setting('origen.subject',true),''); action text:=input->>'action';
 owner uuid; student text; ctx origen_coordinator_link_contexts%ROWTYPE; challenge origen_coordinator_link_challenges%ROWTYPE;
 code origen_coordinator_codes%ROWTYPE; profile origen_coordinator_profiles%ROWTYPE;
 org origen_institutions%ROWTYPE; pilot origen_coordinator_organizations%ROWTYPE; connection origen_binder_connections%ROWTYPE;
 result jsonb; n integer; budget text; topics text[];
BEGIN
 IF actor IS NULL OR COALESCE(current_setting('origen.purpose',true),'')<>'account' THEN RAISE EXCEPTION 'connection_denied' USING ERRCODE='42501'; END IF;
 IF action IN ('inbox','accept','decline') THEN
  IF COALESCE(current_setting('origen.coordinator_verified',true),'false')<>'true' OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND (blocked OR COALESCE(NULLIF(current_setting('origen.coordinator_issued_at',true),''),'0')::bigint<=extract(epoch FROM token_valid_after))) THEN RAISE EXCEPTION 'connection_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO org FROM origen_institutions WHERE id=(input->>'organizationId')::uuid FOR UPDATE;
  SELECT * INTO profile FROM origen_coordinator_profiles WHERE institution_id=org.id AND auth0_subject=actor;
 ELSE
  SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR UPDATE;
  IF owner IS NULL THEN RETURN '{"error":"connection_denied"}'; END IF;
  IF action IN ('open','list','withdraw','available') THEN student:=input->>'studentId';
  ELSE SELECT * INTO ctx FROM origen_coordinator_link_contexts WHERE id=(input->>'contextId')::uuid AND account_id=owner FOR UPDATE; student:=ctx.student_id; END IF;
  IF action='close' THEN
   UPDATE origen_coordinator_link_contexts SET closed=true WHERE id=ctx.id;
   RETURN '{"status":"closed"}';
  END IF;
  IF ctx.channel='voice' AND input->>'voiceEnabled' IS DISTINCT FROM 'true' THEN RETURN '{"error":"connection_denied"}'; END IF;
  IF NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"error":"connection_denied"}'; END IF;
  IF action='available' THEN RETURN '{"available":true}'; END IF;
  IF action='open' THEN
   DELETE FROM origen_coordinator_link_contexts WHERE account_id=owner;
   INSERT INTO origen_coordinator_link_contexts(account_id,student_id,channel) VALUES(owner,student,input->>'channel') RETURNING * INTO ctx;
   RETURN jsonb_build_object('contextId',ctx.id,'expiresAt',ctx.expires_at);
  END IF;
  IF action='list' THEN
   SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'status',CASE WHEN c.status='requested' AND c.expires_at<=now() THEN 'expired' ELSE c.status END,'coordinatorName',p.display_name,'organizationName',i.draft->>'name','topics',c.intended_topics,'expiresAt',c.expires_at) ORDER BY c.created_at DESC),'[]') INTO result
   FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id JOIN origen_institutions i ON i.id=p.institution_id WHERE c.account_id=owner AND c.student_id=student;
   RETURN jsonb_build_object('connections',result,'sharingEnabled',false);
  END IF;
  IF action='withdraw' THEN
   SELECT p.* INTO profile FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id WHERE c.id=(input->>'connectionId')::uuid AND c.account_id=owner AND c.student_id=student;
  ELSE
   IF ctx.id IS NULL OR ctx.closed OR ctx.expires_at<=now() THEN RETURN '{"error":"connection_changed"}'; END IF;
   IF action='turn' THEN
    IF (input->>'sequence')::integer<ctx.sequence OR ((input->>'sequence')::integer=ctx.sequence AND ctx.turn_id IS DISTINCT FROM input->>'turnId') THEN RETURN '{"error":"connection_changed"}'; END IF;
    UPDATE origen_coordinator_link_contexts SET sequence=(input->>'sequence')::integer,turn_id=input->>'turnId' WHERE id=ctx.id;
    RETURN '{"status":"registered"}';
   END IF;
   IF (input->>'sequence')::integer IS DISTINCT FROM ctx.sequence THEN RETURN '{"error":"connection_changed"}'; END IF;
   IF action='cancel' THEN
    DELETE FROM origen_coordinator_link_challenges WHERE context_id=ctx.id AND id=(input->>'challengeId')::uuid AND connection_id IS NULL;
    RETURN '{"status":"cancelled"}';
   END IF;
   IF action='lookup' THEN
    -- Atomic shared budgets across app instances. Only one-way hashes are kept.
    DELETE FROM origen_coordinator_lookup_budgets WHERE window_start<now()-interval '1 day';
    FOREACH budget IN ARRAY ARRAY['a:'||encode(sha256(convert_to(actor,'UTF8')),'hex'),'n:'||(input->>'networkHash')] LOOP
     INSERT INTO origen_coordinator_lookup_budgets(key,attempts) VALUES(budget,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN origen_coordinator_lookup_budgets.window_start<=now()-interval '10 minutes' THEN 1 ELSE origen_coordinator_lookup_budgets.attempts+1 END, window_start=CASE WHEN origen_coordinator_lookup_budgets.window_start<=now()-interval '10 minutes' THEN now() ELSE origen_coordinator_lookup_budgets.window_start END RETURNING attempts INTO n;
     IF n>(CASE WHEN left(budget,1)='a' THEN 10 ELSE 100 END) THEN RETURN '{"error":"connection_rate_limited"}'; END IF;
    END LOOP;
    SELECT * INTO code FROM origen_coordinator_codes WHERE code_hash=input->>'codeHash';
    SELECT * INTO profile FROM origen_coordinator_profiles WHERE id=code.coordinator_id;
   ELSE
    SELECT * INTO challenge FROM origen_coordinator_link_challenges WHERE id=(input->>'challengeId')::uuid AND context_id=ctx.id;
    IF challenge.id IS NULL OR challenge.sequence<>ctx.sequence OR challenge.expires_at<=now() THEN RETURN '{"error":"connection_changed"}'; END IF;
    SELECT * INTO code FROM origen_coordinator_codes WHERE id=challenge.code_id;
    SELECT * INTO profile FROM origen_coordinator_profiles WHERE id=code.coordinator_id;
   END IF;
  END IF;
  SELECT * INTO org FROM origen_institutions WHERE id=profile.institution_id FOR UPDATE;
 END IF;
 -- Same institution lock order as membership/code revocation; reread after lock.
 SELECT * INTO profile FROM origen_coordinator_profiles WHERE id=profile.id;
 SELECT * INTO pilot FROM origen_coordinator_organizations WHERE institution_id=org.id;
 IF profile.status IS DISTINCT FROM 'active' OR pilot.status IS DISTINCT FROM 'active' OR org.verification_status IS DISTINCT FROM 'verified' OR org.parent_approval IS DISTINCT FROM 'approved' OR org.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM origen_institution_members WHERE institution_id=org.id AND auth0_subject=profile.auth0_subject) THEN RETURN '{"error":"coordinator_unavailable"}'; END IF;
 IF action='inbox' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'displayName',c.display_name,'topics',c.intended_topics,'status',c.status,'expiresAt',c.expires_at) ORDER BY c.created_at DESC),'[]') INTO result FROM origen_binder_connections c
   WHERE c.coordinator_id=profile.id AND c.status IN ('requested','accepted') AND (c.status='accepted' OR c.expires_at>now()) AND origen_coordinator_student_ready(c.account_id,c.student_id);
  RETURN jsonb_build_object('connections',result,'sharingEnabled',false);
 END IF;
 IF action IN ('accept','decline','withdraw') THEN
  SELECT * INTO connection FROM origen_binder_connections WHERE id=(input->>'connectionId')::uuid AND coordinator_id=profile.id FOR UPDATE;
  IF connection.id IS NULL OR (action='withdraw' AND (connection.account_id<>owner OR connection.student_id<>student)) OR NOT origen_coordinator_student_ready(connection.account_id,connection.student_id) THEN RETURN '{"error":"connection_denied"}'; END IF;
  IF action='withdraw' THEN
   UPDATE origen_binder_connections SET status='revoked',revision=revision+1 WHERE id=connection.id AND status IN ('requested','accepted');
   UPDATE origen_binder_share_grants SET status='revoked',revoked_at=now(),current_publication_id=NULL,revision=revision+1 WHERE connection_id=connection.id AND status<>'revoked';
  ELSIF connection.status='requested' AND connection.expires_at>now() THEN
   UPDATE origen_binder_connections SET status=CASE WHEN action='accept' THEN 'accepted' ELSE 'declined' END,accepted_at=CASE WHEN action='accept' THEN now() ELSE NULL END,revision=revision+1 WHERE id=connection.id;
  ELSIF NOT (action='accept' AND connection.status='accepted' OR action='decline' AND connection.status='declined') THEN RETURN '{"error":"connection_changed"}'; END IF;
  RETURN jsonb_build_object('status',(SELECT status FROM origen_binder_connections WHERE id=connection.id),'sharingEnabled',false);
 END IF;
 SELECT * INTO code FROM origen_coordinator_codes WHERE id=code.id;
 IF code.id IS NULL OR code.revoked_at IS NOT NULL OR code.expires_at<=now() THEN RETURN '{"error":"coordinator_unavailable"}'; END IF;
 IF action='lookup' THEN
  DELETE FROM origen_coordinator_link_challenges WHERE context_id=ctx.id AND connection_id IS NULL;
  INSERT INTO origen_coordinator_link_challenges(context_id,sequence,code_id,coordinator_revision,organization_revision,coordinator_name,organization_name,student_name) VALUES(ctx.id,ctx.sequence,code.id,profile.revision,pilot.revision,profile.display_name,org.draft->>'name',(SELECT name FROM origen_students WHERE account_id=owner AND id=student)) RETURNING * INTO challenge;
 ELSE
  IF challenge.coordinator_revision<>profile.revision OR challenge.organization_revision<>pilot.revision OR challenge.coordinator_name<>profile.display_name OR challenge.organization_name IS DISTINCT FROM org.draft->>'name' OR challenge.student_name IS DISTINCT FROM (SELECT name FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"connection_changed"}'; END IF;
 END IF;
 IF action IN ('lookup','prepare') THEN
  IF action='prepare' THEN UPDATE origen_coordinator_link_challenges SET prepared=true WHERE id=challenge.id; END IF;
  RETURN jsonb_build_object('challengeId',challenge.id,'expiresAt',challenge.expires_at,'coordinator',jsonb_build_object('id',profile.id,'name',profile.display_name,'organization',org.draft->>'name','role','Coordinator'),'studentName',(SELECT name FROM origen_students WHERE account_id=owner AND id=student),'status',CASE WHEN action='prepare' THEN 'confirmation_required' ELSE 'found' END);
 END IF;
 IF action<>'confirm' OR NOT challenge.prepared OR input->>'confirmed' IS DISTINCT FROM 'true' THEN RETURN '{"error":"connection_denied"}'; END IF;
 IF challenge.connection_id IS NOT NULL THEN SELECT * INTO connection FROM origen_binder_connections WHERE id=challenge.connection_id;
 ELSE
  SELECT ARRAY(SELECT jsonb_array_elements_text(input->'topics')) INTO topics;
  UPDATE origen_binder_connections SET status='expired',revision=revision+1 WHERE account_id=owner AND student_id=student AND status='requested' AND expires_at<=now();
  SELECT * INTO connection FROM origen_binder_connections WHERE account_id=owner AND student_id=student AND coordinator_id=profile.id AND status IN ('requested','accepted');
  IF connection.id IS NULL THEN
   INSERT INTO origen_binder_connections(account_id,student_id,coordinator_id,request_id,expires_at,display_name,intended_topics) VALUES(owner,student,profile.id,challenge.id,now()+interval '168 hours',(SELECT name FROM origen_students WHERE account_id=owner AND id=student),topics) RETURNING * INTO connection;
  END IF;
  UPDATE origen_coordinator_link_challenges SET connection_id=connection.id WHERE id=challenge.id;
 END IF;
 RETURN jsonb_build_object('connectionId',connection.id,'status',connection.status,'sharingEnabled',false);
END $$;

DO $$ DECLARE t text; fn text; BEGIN
 FOREACH t IN ARRAY ARRAY['origen_coordinator_student_pilots','origen_coordinator_link_contexts','origen_coordinator_link_challenges','origen_coordinator_lookup_budgets'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['origen_coordinator_revoke_student_pilot()','origen_coordinator_student_boundary_change()','origen_coordinator_student_ready(uuid,text)','origen_coordinator_connection_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO %I, pg_temp',fn,current_schema()); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

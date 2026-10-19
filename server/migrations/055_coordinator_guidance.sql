-- Student receipts survive the sharing grant. No private staff notes are stored.
ALTER TABLE origen_coordinator_feedback ADD COLUMN resource_url text NOT NULL DEFAULT '' CHECK(length(resource_url)<=2000 AND (resource_url='' OR resource_url ~ '^https://[^/@[:space:]]+'));
ALTER TABLE origen_coordinator_feedback ADD COLUMN reviewed_version integer;
ALTER TABLE origen_coordinator_feedback ADD COLUMN hidden_at timestamptz;
ALTER TABLE origen_coordinator_feedback ADD COLUMN removed_at timestamptz;
ALTER TABLE origen_coordinator_feedback DROP CONSTRAINT origen_coordinator_feedback_body_check;
ALTER TABLE origen_coordinator_feedback ADD CHECK(length(body)<=2000 AND (length(btrim(body))>0 OR withdrawn_at IS NOT NULL OR removed_at IS NOT NULL));
ALTER TABLE origen_coordinator_feedback_revisions ADD COLUMN kind text NOT NULL DEFAULT 'guidance';
ALTER TABLE origen_coordinator_feedback_revisions ADD COLUMN resource_url text NOT NULL DEFAULT '';
ALTER TABLE origen_coordinator_replies ADD COLUMN feedback_version integer NOT NULL DEFAULT 1;

CREATE TABLE origen_coordinator_feedback_requests (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 actor_subject text NOT NULL, request_id uuid NOT NULL, fingerprint text NOT NULL,
 feedback_id uuid NOT NULL REFERENCES origen_coordinator_feedback(id) ON DELETE CASCADE,
 result jsonb NOT NULL, PRIMARY KEY(actor_subject,request_id)
);
CREATE TABLE origen_coordinator_feedback_reports (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 feedback_id uuid NOT NULL REFERENCES origen_coordinator_feedback(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(reason IN ('abuse','spam','inaccurate','privacy','other')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,feedback_id)
);
CREATE TABLE origen_coordinator_feedback_steps (
 account_id uuid NOT NULL, plan_id uuid NOT NULL, step_id text NOT NULL,
 feedback_id uuid NOT NULL REFERENCES origen_coordinator_feedback(id) ON DELETE CASCADE,
 feedback_version integer NOT NULL, PRIMARY KEY(account_id,plan_id,step_id),
 FOREIGN KEY(account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_feedback_student ON origen_coordinator_feedback(account_id,student_id,created_at);
CREATE INDEX origen_feedback_grant ON origen_coordinator_feedback(grant_id,created_at);
-- Student receipt controls are available after grant expiry/revocation or item
-- withdrawal. The exception permits only metadata or destructive redaction.
CREATE OR REPLACE FUNCTION origen_binder_feedback_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['reviewed_version','hidden_at','removed_at','body','resource_url','version'])=(to_jsonb(OLD)-ARRAY['reviewed_version','hidden_at','removed_at','body','resource_url','version'])
   AND EXISTS(SELECT 1 FROM origen_accounts WHERE id=OLD.account_id AND auth0_subject=current_setting('origen.subject',true))
   AND ((NEW.body=OLD.body AND NEW.resource_url=OLD.resource_url AND NEW.version=OLD.version AND NEW.removed_at IS NOT DISTINCT FROM OLD.removed_at)
    OR (NEW.removed_at IS NOT NULL AND NEW.body='' AND NEW.resource_url='' AND NEW.version=OLD.version+1)) THEN RETURN NEW; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_binder_share_grants g JOIN origen_coordinator_profiles p ON p.id=g.coordinator_id WHERE g.account_id=NEW.account_id AND g.student_id=NEW.student_id AND g.id=NEW.grant_id AND origen_binder_grant_live(g.id) AND NEW.topic=ANY(g.topics) AND p.auth0_subject=NEW.author_subject) THEN RAISE EXCEPTION 'binder_grant_unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.withdrawn_at IS NULL AND NEW.publication_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_binder_publication_items WHERE account_id=NEW.account_id AND student_id=NEW.student_id AND grant_id=NEW.grant_id AND id=NEW.publication_item_id AND topic=NEW.topic AND withdrawn_at IS NULL) THEN RAISE EXCEPTION 'binder_item_unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_binder_feedback_parent() SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_binder_feedback_parent() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['origen_coordinator_feedback_requests','origen_coordinator_feedback_reports','origen_coordinator_feedback_steps'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tab);
 END LOOP;
END $$;

CREATE FUNCTION origen_coordinator_feedback_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'topic',x.topic,'kind',x.kind,'body',x.body,'resourceUrl',x.resource_url,'version',x.version,'authorName',x.author_name,'organizationName',x.organization_name,'createdAt',x.created_at,'editedAt',x.edited_at,'withdrawn',x.withdrawn_at IS NOT NULL,'hidden',CASE WHEN staff THEN false ELSE x.hidden_at IS NOT NULL END,'reviewed',CASE WHEN staff THEN false ELSE x.reviewed_version=x.version END,'connectionEnded',NOT origen_binder_grant_live(x.grant_id),'publicationItemId',x.publication_item_id,'replyCount',(SELECT count(*) FROM origen_coordinator_replies r WHERE r.feedback_id=x.id)) ORDER BY x.created_at,x.id),'[]') INTO items
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
ALTER FUNCTION origen_coordinator_feedback_command(jsonb) SET search_path FROM CURRENT;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_coordinator_feedback_command(jsonb) SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_coordinator_feedback_command(jsonb) FROM PUBLIC;

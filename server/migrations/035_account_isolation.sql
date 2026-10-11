-- The migration owner must NOT be the HTTP runtime role. Provision the latter
-- with scripts/provision-database-runtime.mjs after migrating. Owners deliberately
-- retain migration/backup authority; API startup rejects owners and BYPASSRLS.
CREATE FUNCTION origen_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM origen_accounts WHERE auth0_subject=nullif(current_setting('origen.subject',true),'')
$$;

ALTER TABLE origen_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_owner ON origen_accounts USING(auth0_subject=nullif(current_setting('origen.subject',true),''));

DO $$ DECLARE t text; BEGIN
 -- Every account_id table, including derived copies, receipts, and telemetry.
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables b USING(table_schema,table_name)
   WHERE c.table_schema=current_schema() AND c.column_name='account_id' AND b.table_type='BASE TABLE' AND c.table_name LIKE 'origen_%'
 LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY account_owner ON %I USING(account_id=(SELECT origen_current_account_id()))',t);
 END LOOP;
 -- Explicit content-free reporting paths. Private text tables are absent here.
 FOREACH t IN ARRAY ARRAY['origen_accounts','origen_login_activity','origen_voice_activity','origen_voice_quality_events',
  'origen_onboarding_attempts','origen_onboarding_events','origen_guidance_sessions','origen_guidance_segments',
  'origen_guidance_events','origen_ai_executions','origen_tool_calls','origen_summary_segments','origen_conversation_quality',
  'origen_admin_issue_reviews','origen_feedback_prompts','origen_progress_reports']
 LOOP
  EXECUTE format('CREATE POLICY reporting_read ON %I FOR SELECT USING(current_setting(''origen.purpose'',true)=''analytics'')',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['origen_admin_issue_reviews','origen_conversation_quality'] LOOP
  EXECUTE format('CREATE POLICY reporting_write ON %I FOR ALL USING(current_setting(''origen.purpose'',true)=''analytics'') WITH CHECK(current_setting(''origen.purpose'',true)=''analytics'')',t);
 END LOOP;
 -- Only the server's scheduled cleanup entry point establishes this purpose.
 FOREACH t IN ARRAY ARRAY['origen_accounts','origen_guidance_sessions','origen_guidance_segments','origen_guidance_events','origen_ai_executions',
  'origen_summary_segments','origen_conversation_summaries','origen_profile_observations','origen_plan_revisions','origen_progress_reports',
  'origen_feedback_prompts','origen_conversation_quality','origen_onboarding_attempts','origen_onboarding_events','origen_admin_issue_reviews']
 LOOP
  EXECUTE format('CREATE POLICY retention_read ON %I FOR SELECT USING(current_setting(''origen.purpose'',true)=''retention'')',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['origen_guidance_sessions','origen_ai_executions','origen_profile_observations','origen_plan_revisions',
  'origen_progress_reports','origen_feedback_prompts','origen_conversation_quality','origen_onboarding_attempts','origen_admin_issue_reviews']
 LOOP
  EXECUTE format('CREATE POLICY retention_delete ON %I FOR DELETE USING(current_setting(''origen.purpose'',true)=''retention'')',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['origen_guidance_sessions','origen_ai_executions'] LOOP
  EXECUTE format('CREATE POLICY retention_update ON %I FOR UPDATE USING(current_setting(''origen.purpose'',true)=''retention'') WITH CHECK(current_setting(''origen.purpose'',true)=''retention'')',t);
 END LOOP;
END $$;

ALTER TABLE origen_subject_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_lock ON origen_subject_locks USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
ALTER TABLE origen_closed_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_closure ON origen_closed_accounts USING(subject_hash=nullif(current_setting('origen.subject_hash',true),''));
ALTER TABLE origen_student_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY link_participant ON origen_student_links FOR SELECT USING(owner_account_id=(SELECT origen_current_account_id()) OR member_account_id=(SELECT origen_current_account_id()));
ALTER TABLE origen_family_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invite_owner ON origen_family_invites USING(owner_account_id=(SELECT origen_current_account_id()));
CREATE POLICY expired_invites ON origen_family_invites FOR SELECT USING(current_setting('origen.purpose',true)='retention');
CREATE POLICY expire_invites ON origen_family_invites FOR DELETE USING(current_setting('origen.purpose',true)='retention');

-- Reporting can count profiles/summaries but cannot select their prose, sources,
-- names, needs or notes. These owner-executed views are read-only to runtime.
DO $$ DECLARE s text:=current_schema(); r text:=s||'_reporting'; BEGIN
 EXECUTE format('CREATE SCHEMA %I',r);
 EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC',r);
 EXECUTE format('CREATE VIEW %I.origen_students WITH (security_barrier=true) AS SELECT account_id,id,created_at,updated_at FROM %I.origen_students WHERE current_setting(''origen.purpose'',true)=''analytics''',r,s);
 EXECUTE format('CREATE VIEW %I.origen_conversation_summaries WITH (security_barrier=true) AS SELECT account_id,id,student_id,mode,conversation_at,created_at FROM %I.origen_conversation_summaries WHERE current_setting(''origen.purpose'',true)=''analytics''',r,s);
END $$;

-- The only cross-account profile reader. Deliberately no needs/notes columns.
CREATE FUNCTION origen_shared_profile(local_id text)
RETURNS TABLE(name text,stage text,interest text,gpa text,color text,institutions text,entry_term text,school text,activities text,goals text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT s.name,s.stage,s.interest,s.gpa,s.color,s.institutions,s.entry_term,s.school,s.activities,s.goals
 FROM origen_student_links l JOIN origen_students s ON s.account_id=l.owner_account_id AND s.id=l.owner_student_id
 WHERE l.member_account_id=(SELECT origen_current_account_id()) AND l.member_student_id=local_id
$$;

CREATE FUNCTION origen_update_shared_profile(local_id text,fields jsonb,record_progress boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE link origen_student_links%ROWTYPE; before origen_students%ROWTYPE; key text; BEGIN
 SELECT * INTO link FROM origen_student_links WHERE member_account_id=(SELECT origen_current_account_id()) AND member_student_id=local_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
 IF jsonb_typeof(fields)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(fields) k WHERE k NOT IN ('name','stage','interest','gpa','color','institutions','entry_term','school','activities','goals'))
  THEN RAISE EXCEPTION 'invalid_shared_fields'; END IF;
 SELECT * INTO before FROM origen_students WHERE account_id=link.owner_account_id AND id=link.owner_student_id FOR UPDATE;
 UPDATE origen_students SET name=fields->>'name',stage=fields->>'stage',interest=fields->>'interest',gpa=fields->>'gpa',color=fields->>'color',
  institutions=fields->>'institutions',entry_term=fields->>'entry_term',school=fields->>'school',activities=fields->>'activities',goals=fields->>'goals',updated_at=now()
 WHERE account_id=link.owner_account_id AND id=link.owner_student_id;
 IF record_progress THEN
  FOREACH key IN ARRAY ARRAY['stage','interest','gpa','institutions','entry_term','school','activities','goals'] LOOP
   IF (to_jsonb(before)->>key) IS DISTINCT FROM (fields->>key) THEN
    INSERT INTO origen_profile_observations(account_id,student_id,field,previous_value,reported_value,origin)
     VALUES(link.owner_account_id,link.owner_student_id,key,to_jsonb(before)->>key,fields->>key,'linked-account');
   END IF;
  END LOOP;
 END IF;
END $$;

-- Invite possession permits only previewing/accepting that invitation. Accept
-- copies academic fields into a NEW local row; history and annotations stay put.
CREATE FUNCTION origen_family_link_command(command text,argument text,local_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE account uuid; invite origen_family_invites%ROWTYPE; link origen_student_links%ROWTYPE; snapshot origen_students%ROWTYPE; result jsonb; BEGIN
 account:=origen_current_account_id();
 IF account IS NULL THEN RAISE EXCEPTION 'account_not_found'; END IF;
 IF command IN ('inspect','accept') THEN
  SELECT * INTO invite FROM origen_family_invites WHERE token_hash=argument AND expires_at>now() AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_unavailable'; END IF;
  IF invite.owner_account_id=account THEN RAISE EXCEPTION 'cannot_accept_own_invitation'; END IF;
  IF command='inspect' THEN
   SELECT jsonb_build_object('invitation',jsonb_build_object('studentName',s.name,'inviterName',a.first_name,'role',invite.target_role,'expiresAt',invite.expires_at)) INTO result
    FROM origen_students s JOIN origen_accounts a ON a.id=s.account_id WHERE s.account_id=invite.owner_account_id AND s.id=invite.student_id;
   IF result IS NULL THEN RAISE EXCEPTION 'invitation_unavailable'; END IF;
   RETURN result;
  END IF;
  IF EXISTS(SELECT 1 FROM origen_student_links WHERE owner_account_id=invite.owner_account_id AND owner_student_id=invite.student_id AND member_account_id=account) THEN RAISE EXCEPTION 'already_linked'; END IF;
  IF local_id IS NULL OR local_id NOT LIKE 'linked-%' THEN RAISE EXCEPTION 'invalid_link_request'; END IF;
  INSERT INTO origen_students(account_id,id,name,stage,interest,gpa,color,institutions,entry_term,school,activities,goals)
   SELECT account,local_id,name,stage,interest,gpa,color,institutions,entry_term,school,activities,goals FROM origen_students WHERE account_id=invite.owner_account_id AND id=invite.student_id;
  INSERT INTO origen_student_links(owner_account_id,owner_student_id,member_account_id,member_student_id,member_role)
   VALUES(invite.owner_account_id,invite.student_id,account,local_id,invite.target_role);
  UPDATE origen_family_invites SET consumed_at=now() WHERE id=invite.id;
  RETURN jsonb_build_object('studentId',local_id);
 ELSIF command='unlink' THEN
  SELECT * INTO link FROM origen_student_links WHERE id=argument::uuid AND (owner_account_id=account OR member_account_id=account) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  SELECT * INTO snapshot FROM origen_students WHERE account_id=link.owner_account_id AND id=link.owner_student_id FOR UPDATE;
  UPDATE origen_students SET name=snapshot.name,stage=snapshot.stage,interest=snapshot.interest,gpa=snapshot.gpa,color=snapshot.color,
   institutions=snapshot.institutions,entry_term=snapshot.entry_term,school=snapshot.school,activities=snapshot.activities,goals=snapshot.goals,updated_at=now()
   WHERE account_id=link.member_account_id AND id=link.member_student_id;
  DELETE FROM origen_student_links WHERE id=link.id;
  RETURN '{}'::jsonb;
 ELSIF command='load' THEN
  SELECT coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) INTO result FROM (
   SELECT l.id,CASE WHEN l.owner_account_id=account THEN l.owner_student_id ELSE l.member_student_id END AS "studentId",
    s.name AS "studentName",a.first_name AS "personName",l.member_role AS role,(l.owner_account_id=account) AS "isOwner"
   FROM origen_student_links l JOIN origen_students s ON s.account_id=l.owner_account_id AND s.id=l.owner_student_id
   JOIN origen_accounts a ON a.id=CASE WHEN l.owner_account_id=account THEN l.member_account_id ELSE l.owner_account_id END
   WHERE l.owner_account_id=account OR l.member_account_id=account ORDER BY l.created_at
  ) x;
  RETURN result;
 ELSE RAISE EXCEPTION 'invalid_link_request'; END IF;
END $$;

-- Pin every function to the migration's trusted schema, with pg_temp last.
-- No SECURITY DEFINER function may resolve a caller-created replacement table.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.proname IN ('origen_current_account_id','origen_shared_profile','origen_update_shared_profile','origen_family_link_command')
 LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f.signature,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;
END $$;

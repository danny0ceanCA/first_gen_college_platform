-- A prospective, separately approved purpose. Earlier service-quality consent
-- and accepted actions authorize no collection in these tables.
CREATE TABLE origen_recommendation_evaluation_permissions (
 account_id uuid NOT NULL,student_id text NOT NULL,institution_id uuid REFERENCES origen_institutions(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('granted','declined','withdrawn','needs_review')),
 purpose text NOT NULL DEFAULT 'recommendation_evaluation' CHECK(purpose='recommendation_evaluation'),contract_version integer NOT NULL DEFAULT 1 CHECK(contract_version=1),
 scope_hash text,started_at timestamptz,expires_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,student_id),FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 CHECK(status<>'granted' OR institution_id IS NOT NULL AND scope_hash IS NOT NULL AND started_at IS NOT NULL AND expires_at IS NOT NULL)
);
CREATE TABLE origen_recommendation_evaluation_previews (
 id uuid PRIMARY KEY,account_id uuid NOT NULL,student_id text NOT NULL,expected_version integer NOT NULL,scope_hash text NOT NULL,
 snapshot jsonb NOT NULL,digest text NOT NULL,expires_at timestamptz NOT NULL,result_version integer,
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX recommendation_evaluation_one_preview ON origen_recommendation_evaluation_previews(account_id,student_id);
CREATE TABLE origen_recommendation_evaluation_receipts (
 account_id uuid NOT NULL,student_id text NOT NULL,id uuid NOT NULL,permission_version integer NOT NULL,institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 policy_version text NOT NULL CHECK(policy_version='evidence-informed-v1'),status text NOT NULL CHECK(status IN ('recommended','clarification_required','no_applicable_candidate','unavailable')),
 source jsonb,source_revision text,considered integer CHECK(considered BETWEEN 0 AND 52),eligible integer CHECK(eligible BETWEEN 0 AND 52),
 language text NOT NULL CHECK(language IN ('en','es')),channel text NOT NULL CHECK(channel IN ('binder','voice')),latency_ms integer NOT NULL CHECK(latency_ms BETWEEN 0 AND 60000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),displayed_at timestamptz,played_at timestamptz,accepted_at timestamptz,recommendation_id uuid,
 PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,student_id) REFERENCES origen_recommendation_evaluation_permissions(account_id,student_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,recommendation_id) REFERENCES origen_plan_recommendations(account_id,id) ON DELETE CASCADE,
 CHECK((status='recommended')=(source IS NOT NULL AND source_revision IS NOT NULL))
);
CREATE INDEX recommendation_evaluation_period ON origen_recommendation_evaluation_receipts(institution_id,created_at);
CREATE TABLE origen_recommendation_evaluation_capabilities (
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,coordinator_id uuid NOT NULL REFERENCES origen_coordinator_profiles(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL,revoked_at timestamptz,PRIMARY KEY(institution_id,coordinator_id)
);
CREATE TABLE origen_recommendation_evaluation_report_budget (
 institution_id uuid PRIMARY KEY REFERENCES origen_institutions(id) ON DELETE CASCADE,reported_on date NOT NULL
);
CREATE FUNCTION origen_recommendation_evaluation_scope(owner uuid,student text,org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('eligibility',e.revision,'account',a.id,'student',student,'organization',i.id,'connections',jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'expires',c.expires_at) ORDER BY c.id))::text,'UTF8')),'hex')
 FROM origen_accounts a JOIN origen_eligibility e ON e.subject_hash=encode(sha256(convert_to(a.auth0_subject,'UTF8')),'hex')
 JOIN origen_binder_connections c ON c.account_id=a.id AND c.student_id=student AND c.status='accepted' AND c.expires_at>clock_timestamp()
 JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id AND p.status='active'
 JOIN origen_institutions i ON i.id=p.institution_id AND i.id=org AND i.verification_status='verified' AND i.parent_approval='approved' AND i.archived_at IS NULL
 WHERE a.id=owner AND a.role='student' AND e.age_band='18plus' AND e.status='adult' AND origen_coordinator_student_ready(owner,student)
 AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts x WHERE x.subject_hash=e.subject_hash)
 AND EXISTS(SELECT 1 FROM origen_coordinator_organizations o WHERE o.institution_id=i.id AND o.status='active') GROUP BY a.id,e.revision,i.id
$$;
CREATE FUNCTION origen_recommendation_evaluation_view(owner uuid,student text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('version',version,'status',status,'organizationId',institution_id,'startedAt',started_at,'expiresAt',expires_at)
 FROM origen_recommendation_evaluation_permissions WHERE account_id=owner AND student_id=student
$$;
CREATE FUNCTION origen_student_recommendation_evaluation(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid;student text:=input->>'studentId';action text:=input->>'action';g origen_recommendation_evaluation_permissions%ROWTYPE;p origen_recommendation_evaluation_previews%ROWTYPE;
 scope text;org uuid;orgname text;snapshot jsonb;options jsonb;
BEGIN
 IF coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"evaluation_denied"}';END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=nullif(current_setting('origen.subject',true),'') AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(auth0_subject,'UTF8')),'hex')) FOR UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"evaluation_denied"}';END IF;
 IF action='export' AND input-'action'='{}'::jsonb THEN RETURN jsonb_build_object('permissions',coalesce((SELECT jsonb_agg(jsonb_build_object('studentId',student_id,'permission',origen_recommendation_evaluation_view(owner,student_id))) FROM origen_recommendation_evaluation_permissions WHERE account_id=owner),'[]'::jsonb),'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r)-'account_id') FROM origen_recommendation_evaluation_receipts r WHERE account_id=owner),'[]'::jsonb));END IF;
 IF input->>'purpose' IS DISTINCT FROM 'recommendation_evaluation' OR input->'contractVersion' IS DISTINCT FROM '1'::jsonb OR action NOT IN ('load','prepare','confirm','withdraw','decline')
 OR input-ARRAY['action','purpose','contractVersion','studentId','organizationId','version','operationId','previewId','digest','confirmed','enabled']<>'{}'::jsonb THEN RETURN '{"error":"invalid_recommendation_evaluation"}';END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_students WHERE account_id=owner AND id=student) THEN RETURN '{"error":"evaluation_denied"}';END IF;
 SELECT * INTO g FROM origen_recommendation_evaluation_permissions WHERE account_id=owner AND student_id=student FOR UPDATE;
 IF g.status='granted' AND (g.expires_at<=clock_timestamp() OR origen_recommendation_evaluation_scope(owner,student,g.institution_id) IS DISTINCT FROM g.scope_hash) THEN
  UPDATE origen_recommendation_evaluation_permissions SET status='needs_review',version=version+1,scope_hash=NULL,updated_at=clock_timestamp() WHERE account_id=owner AND student_id=student RETURNING * INTO g;
  DELETE FROM origen_recommendation_evaluation_receipts WHERE account_id=owner AND student_id=student;
  DELETE FROM origen_recommendation_evaluation_previews WHERE account_id=owner AND student_id=student;
 END IF;
 IF action='load' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(i.published->>'name',i.draft->>'name','Organization')) ORDER BY i.id),'[]'::jsonb) INTO options FROM origen_institutions i WHERE i.id IN (SELECT cp.institution_id FROM origen_binder_connections bc JOIN origen_coordinator_profiles cp ON cp.id=bc.coordinator_id WHERE bc.account_id=owner AND bc.student_id=student) AND origen_recommendation_evaluation_scope(owner,student,i.id) IS NOT NULL;
  RETURN jsonb_build_object('enabled',input->'enabled','organizations',options,'permission',origen_recommendation_evaluation_view(owner,student));
 END IF;
 IF action IN ('withdraw','decline') THEN
  IF coalesce(g.version,0) IS DISTINCT FROM (input->>'version')::integer OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_changed"}';END IF;
  INSERT INTO origen_recommendation_evaluation_permissions(account_id,student_id,version,status) VALUES(owner,student,coalesce(g.version,0)+1,CASE WHEN action='withdraw' THEN 'withdrawn' ELSE 'declined' END)
  ON CONFLICT(account_id,student_id) DO UPDATE SET version=excluded.version,status=excluded.status,institution_id=NULL,scope_hash=NULL,started_at=NULL,expires_at=NULL,updated_at=clock_timestamp();
  DELETE FROM origen_recommendation_evaluation_receipts WHERE account_id=owner AND student_id=student;
  DELETE FROM origen_recommendation_evaluation_previews WHERE account_id=owner AND student_id=student;
  RETURN jsonb_build_object('status','excluded','permission',origen_recommendation_evaluation_view(owner,student));
 END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_paused"}';END IF;
 IF action='prepare' THEN
  org:=(input->>'organizationId')::uuid;scope:=origen_recommendation_evaluation_scope(owner,student,org);
  IF scope IS NULL THEN RETURN '{"error":"evaluation_denied"}';END IF;
  IF coalesce(g.version,0) IS DISTINCT FROM (input->>'version')::integer THEN RETURN '{"error":"evaluation_changed"}';END IF;
  SELECT coalesce(published->>'name',draft->>'name','Organization') INTO orgname FROM origen_institutions WHERE id=org;
  SELECT * INTO p FROM origen_recommendation_evaluation_previews WHERE id=(input->>'operationId')::uuid FOR UPDATE;
  IF p.id IS NOT NULL THEN
   IF p.account_id<>owner OR p.student_id<>student OR p.expected_version<>coalesce(g.version,0) OR p.scope_hash<>scope OR p.result_version IS NOT NULL OR p.expires_at<=clock_timestamp() THEN RETURN '{"error":"evaluation_changed"}';END IF;
  ELSE
   DELETE FROM origen_recommendation_evaluation_previews WHERE account_id=owner AND student_id=student;
   snapshot:=jsonb_build_object('purpose','recommendation_evaluation','contractVersion',1,'organizationId',org,'organizationName',orgname,'permissionExpiresAt',clock_timestamp()+interval '90 days');
   INSERT INTO origen_recommendation_evaluation_previews(id,account_id,student_id,expected_version,scope_hash,snapshot,digest,expires_at) VALUES((input->>'operationId')::uuid,owner,student,coalesce(g.version,0),scope,snapshot,encode(sha256(convert_to(snapshot::text||gen_random_uuid()::text,'UTF8')),'hex'),clock_timestamp()+interval '10 minutes') RETURNING * INTO p;
  END IF;
  RETURN jsonb_build_object('preview',p.snapshot||jsonb_build_object('id',p.id,'digest',p.digest,'expiresAt',p.expires_at));
 END IF;
 SELECT * INTO p FROM origen_recommendation_evaluation_previews WHERE id=(input->>'previewId')::uuid AND account_id=owner AND student_id=student FOR UPDATE;
 IF p.id IS NULL OR input->>'digest' IS DISTINCT FROM p.digest OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"evaluation_changed"}';END IF;
 IF p.result_version IS NOT NULL THEN RETURN CASE WHEN g.version=p.result_version AND g.status='granted' THEN jsonb_build_object('status','included','permission',origen_recommendation_evaluation_view(owner,student)) ELSE '{"status":"superseded"}'::jsonb END;END IF;
 org:=(p.snapshot->>'organizationId')::uuid;scope:=origen_recommendation_evaluation_scope(owner,student,org);
 IF p.expires_at<=clock_timestamp() OR scope IS DISTINCT FROM p.scope_hash OR p.expected_version<>coalesce(g.version,0) THEN RETURN '{"error":"evaluation_changed"}';END IF;
 DELETE FROM origen_recommendation_evaluation_receipts WHERE account_id=owner AND student_id=student;
 INSERT INTO origen_recommendation_evaluation_permissions(account_id,student_id,institution_id,version,status,scope_hash,started_at,expires_at)
 VALUES(owner,student,org,coalesce(g.version,0)+1,'granted',scope,clock_timestamp(),(p.snapshot->>'permissionExpiresAt')::timestamptz)
 ON CONFLICT(account_id,student_id) DO UPDATE SET institution_id=excluded.institution_id,version=excluded.version,status='granted',scope_hash=excluded.scope_hash,started_at=excluded.started_at,expires_at=excluded.expires_at,updated_at=clock_timestamp() RETURNING * INTO g;
 UPDATE origen_recommendation_evaluation_previews SET result_version=g.version WHERE id=p.id;
 RETURN jsonb_build_object('status','included','permission',origen_recommendation_evaluation_view(owner,student));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_recommendation_evaluation"}';END $$;

-- Only the application delivery transaction calls this after independently
-- deriving selection/playback/acceptance. No public telemetry payload is stored.
CREATE FUNCTION origen_recommendation_evaluation_record(input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE owner uuid;g origen_recommendation_evaluation_permissions%ROWTYPE;r origen_recommendation_evaluation_receipts%ROWTYPE;p origen_recommendation_previews%ROWTYPE;
BEGIN
 IF current_setting('origen.recommendation_evaluation',true) IS DISTINCT FROM 'true' OR current_setting('origen.purpose',true) IS DISTINCT FROM 'account' THEN RETURN;END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=nullif(current_setting('origen.subject',true),'') FOR UPDATE;
 SELECT * INTO g FROM origen_recommendation_evaluation_permissions WHERE account_id=owner AND student_id=input->>'studentId';
 IF g.status IS DISTINCT FROM 'granted' OR g.expires_at<=clock_timestamp() OR origen_recommendation_evaluation_scope(owner,g.student_id,g.institution_id) IS DISTINCT FROM g.scope_hash THEN RETURN;END IF;
 IF input->>'event'='considered' THEN
  IF input->'source'->>'kind'='review-response' AND input->'source'->>'organizationId' IS DISTINCT FROM g.institution_id::text THEN RETURN;END IF;
  -- Revisited pre-existing actions cannot supply a prospective acceptance path.
  IF input->'source'->>'kind'='accepted-action' THEN RETURN;END IF;
  INSERT INTO origen_recommendation_evaluation_receipts(account_id,student_id,id,permission_version,institution_id,policy_version,status,source,source_revision,considered,eligible,language,channel,latency_ms)
  VALUES(owner,g.student_id,(input->>'id')::uuid,g.version,g.institution_id,'evidence-informed-v1',input->>'status',nullif(input->'source','null'::jsonb),input->>'sourceRevision',(input->>'considered')::integer,(input->>'eligible')::integer,input->>'language',input->>'channel',(input->>'latencyMs')::integer) ON CONFLICT DO NOTHING;
 ELSE
  SELECT * INTO r FROM origen_recommendation_evaluation_receipts WHERE account_id=owner AND id=(input->>'id')::uuid AND student_id=g.student_id AND permission_version=g.version AND created_at>=g.started_at FOR UPDATE;
  IF r.id IS NULL THEN RETURN;END IF;
  IF input->>'event'='accepted' THEN
   IF NOT EXISTS(SELECT 1 FROM origen_plan_recommendations WHERE account_id=owner AND id=r.id AND source=r.source AND source_revision=r.source_revision) THEN RETURN;END IF;
   UPDATE origen_recommendation_evaluation_receipts SET accepted_at=coalesce(accepted_at,clock_timestamp()),recommendation_id=r.id WHERE account_id=owner AND id=r.id;
  ELSE
   SELECT * INTO p FROM origen_recommendation_previews WHERE account_id=owner AND id=r.id AND expires_at>clock_timestamp();
   IF p.id IS NULL OR p.source<>r.source OR p.source_revision<>r.source_revision THEN RETURN;END IF;
   IF input->>'event'='displayed' AND r.channel='binder' AND p.session_id IS NULL THEN UPDATE origen_recommendation_evaluation_receipts SET displayed_at=coalesce(displayed_at,clock_timestamp()) WHERE account_id=owner AND id=r.id;
   ELSIF input->>'event'='played' AND r.channel='voice' AND p.presented THEN UPDATE origen_recommendation_evaluation_receipts SET played_at=coalesce(played_at,clock_timestamp()) WHERE account_id=owner AND id=r.id;END IF;
  END IF;
 END IF;
END $$;
CREATE FUNCTION origen_recommendation_evaluation_receipt_current(owner uuid,rid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r origen_recommendation_evaluation_receipts%ROWTYPE;g origen_recommendation_evaluation_permissions%ROWTYPE;resolved jsonb;
 old_subject text:=current_setting('origen.subject',true);old_flag text:=current_setting('origen.recommendations',true);old_purpose text:=current_setting('origen.purpose',true);
BEGIN
 SELECT * INTO r FROM origen_recommendation_evaluation_receipts WHERE account_id=owner AND id=rid;
 SELECT * INTO g FROM origen_recommendation_evaluation_permissions WHERE account_id=owner AND student_id=r.student_id;
 IF r.id IS NULL OR g.status IS DISTINCT FROM 'granted' OR g.version<>r.permission_version OR g.expires_at<=clock_timestamp() OR r.created_at<g.started_at OR r.created_at<clock_timestamp()-interval '90 days' OR origen_recommendation_evaluation_scope(owner,r.student_id,g.institution_id) IS DISTINCT FROM g.scope_hash THEN RETURN false;END IF;
 IF r.recommendation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM origen_plan_recommendations a JOIN origen_plan_steps s ON s.account_id=a.account_id AND s.plan_id=a.plan_id AND s.id=a.step_id WHERE a.account_id=owner AND a.id=r.recommendation_id AND a.action_hash=encode(sha256(convert_to(s.action,'UTF8')),'hex')) THEN RETURN false;END IF;
 IF r.source IS NULL THEN RETURN true;END IF;
 PERFORM set_config('origen.purpose','account',true);PERFORM set_config('origen.subject',(SELECT auth0_subject FROM origen_accounts WHERE id=owner),true);PERFORM set_config('origen.recommendations','true',true);
 resolved:=origen_recommendation_source_command(jsonb_build_object('action','resolve-source','contractVersion',1,'purpose','personal_guidance','studentId',r.student_id,'source',r.source));
 PERFORM set_config('origen.subject',coalesce(old_subject,''),true);PERFORM set_config('origen.recommendations',coalesce(old_flag,''),true);PERFORM set_config('origen.purpose',coalesce(old_purpose,''),true);
 RETURN resolved->>'status'='current' AND resolved->>'sourceRevision'=r.source_revision;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('origen.subject',coalesce(old_subject,''),true);PERFORM set_config('origen.recommendations',coalesce(old_flag,''),true);PERFORM set_config('origen.purpose',coalesce(old_purpose,''),true);RAISE;
END $$;
CREATE FUNCTION origen_recommendation_evaluation_grant(org uuid,coordinator uuid,valid_until timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 IF valid_until IS NULL THEN UPDATE origen_recommendation_evaluation_capabilities SET revoked_at=clock_timestamp(),version=version+1 WHERE institution_id=org AND coordinator_id=coordinator;RETURN;END IF;
 IF valid_until<=clock_timestamp() OR valid_until>clock_timestamp()+interval '90 days' OR NOT EXISTS(SELECT 1 FROM origen_coordinator_profiles WHERE id=coordinator AND institution_id=org AND status='active') THEN RAISE EXCEPTION 'invalid_evaluation_scope' USING ERRCODE='23514';END IF;
 INSERT INTO origen_recommendation_evaluation_capabilities(institution_id,coordinator_id,expires_at) VALUES(org,coordinator,valid_until) ON CONFLICT(institution_id,coordinator_id) DO UPDATE SET version=origen_recommendation_evaluation_capabilities.version+1,expires_at=excluded.expires_at,revoked_at=NULL;
END $$;
CREATE FUNCTION origen_recommendation_evaluation_after_restore() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
 DELETE FROM origen_recommendation_evaluation_receipts;DELETE FROM origen_recommendation_evaluation_previews;
 UPDATE origen_recommendation_evaluation_permissions SET status='withdrawn',version=version+1,scope_hash=NULL,started_at=NULL,expires_at=NULL;
 UPDATE origen_recommendation_evaluation_capabilities SET revoked_at=clock_timestamp(),version=version+1;
 -- Keep the non-personal daily report budget; a restore cannot reset it.
END $$;
CREATE FUNCTION origen_recommendation_evaluation_purge() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
 DELETE FROM origen_recommendation_evaluation_receipts WHERE (account_id,id) IN (SELECT account_id,id FROM (SELECT * FROM origen_recommendation_evaluation_receipts ORDER BY created_at,account_id,id LIMIT 1000) r WHERE NOT coalesce(origen_recommendation_evaluation_receipt_current(r.account_id,r.id),false));
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM origen_recommendation_evaluation_previews WHERE id IN (SELECT id FROM origen_recommendation_evaluation_previews WHERE expires_at<=clock_timestamp() LIMIT 1000);
 RETURN n;
END $$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['origen_recommendation_evaluation_permissions','origen_recommendation_evaluation_previews','origen_recommendation_evaluation_receipts','origen_recommendation_evaluation_capabilities','origen_recommendation_evaluation_report_budget'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);END LOOP;
 FOREACH name IN ARRAY ARRAY['origen_recommendation_evaluation_scope(uuid,text,uuid)','origen_recommendation_evaluation_view(uuid,text)','origen_student_recommendation_evaluation(jsonb)','origen_recommendation_evaluation_record(jsonb)','origen_recommendation_evaluation_receipt_current(uuid,uuid)','origen_recommendation_evaluation_grant(uuid,uuid,timestamptz)','origen_recommendation_evaluation_after_restore()','origen_recommendation_evaluation_purge()'] LOOP EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',name,current_schema());EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',name);END LOOP;
END $$;

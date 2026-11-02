-- Reuse the existing exact-preview and independent voice-turn approval store.
ALTER TABLE origen_follow_up_proposals DROP CONSTRAINT origen_follow_up_proposals_kind_check;
ALTER TABLE origen_follow_up_proposals ADD CONSTRAINT origen_follow_up_proposals_kind_check CHECK(kind IN ('check-in','report','outcome'));

-- A corrected event may occur after the report's original creation date.
-- Keep creation time as history and validate against the last approved edit.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='origen_student_follow_up_reports'::regclass AND contype='c'
  AND strpos(pg_get_expr(conbin,conrelid),'recorded_at')>0 AND strpos(pg_get_expr(conbin,conrelid),'<=')>0 LOOP
  EXECUTE format('ALTER TABLE origen_student_follow_up_reports DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE origen_student_follow_up_reports ADD CONSTRAINT follow_up_report_event_date CHECK(occurred_on IS NULL OR occurred_on<=(greatest(recorded_at,updated_at) AT TIME ZONE time_zone)::date);

CREATE OR REPLACE FUNCTION origen_outcome_episode_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE target jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','invalidation_reason']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','invalidation_reason']) THEN
   IF OLD.state='needs_review' AND NEW.state='current' THEN RAISE EXCEPTION 'outcome_episode_immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.consented_at<=OLD.consented_at OR NEW.state<>'current' OR NEW.invalidation_reason IS NOT NULL
   OR (to_jsonb(NEW)-ARRAY['version','consented_at','state','invalidation_reason','window_start','window_end','time_zone','accepted_plan_version','action_hash','request_id','response_version','valid_until']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['version','consented_at','state','invalidation_reason','window_start','window_end','time_zone','accepted_plan_version','action_hash','request_id','response_version','valid_until'])
   THEN RAISE EXCEPTION 'outcome_episode_immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) OR NEW.institution<>btrim(NEW.institution) OR NEW.term<>btrim(NEW.term) OR NEW.cycle<>btrim(NEW.cycle)
  OR NEW.institution ~ '[[:cntrl:]]' OR NEW.term ~ '[[:cntrl:]]' OR NEW.cycle ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_outcome_scope' USING ERRCODE='23514'; END IF;
 target:=origen_student_follow_up_target(NEW.account_id,NEW.plan_id,NEW.step_id);
 IF target IS NULL OR target->>'studentId' IS DISTINCT FROM NEW.student_id OR target->>'permitted' IS DISTINCT FROM 'true' OR target->>'sourceCurrent' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'outcome_source_unavailable' USING ERRCODE='23514'; END IF;
 NEW.accepted_plan_version:=(target->>'planVersion')::integer;NEW.action_hash:=target->>'actionHash';
 NEW.request_id:=(target->'source'->>'requestId')::uuid;NEW.response_version:=(target->'source'->>'responseVersion')::integer;NEW.valid_until:=(target->>'validUntil')::timestamptz;
 IF NEW.valid_until IS NULL OR NEW.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'outcome_source_expired' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION origen_outcome_recording_payload(owner uuid,student text,plan uuid,step text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE link jsonb:=input->'link'; spec jsonb:=link->'episode'; scope jsonb:=spec->'scope'; win jsonb:=spec->'window'; correction jsonb:=input->'correction';
 report origen_student_follow_up_reports%ROWTYPE; episode origen_outcome_episodes%ROWTYPE; previous origen_outcome_evidence%ROWTYPE;
 detail text; day date; tz text; startday date; endday date; renewal boolean; snapshot jsonb;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['link','correction','replaces']<>'{}'::jsonb OR NOT(input ?& ARRAY['link','correction','replaces'])
  OR jsonb_typeof(link) IS DISTINCT FROM 'object' OR link-ARRAY['episode','report','responseState','claimStatus','decision']<>'{}'::jsonb OR NOT(link ?& ARRAY['episode','report','responseState','claimStatus','decision'])
  OR jsonb_typeof(spec) IS DISTINCT FROM 'object' OR spec-ARRAY['definitionId','definitionVersion','scope','window']<>'{}'::jsonb OR NOT(spec ?& ARRAY['definitionId','definitionVersion','scope','window'])
  OR NOT EXISTS(SELECT 1 FROM origen_outcome_definitions WHERE id=spec->>'definitionId' AND version=(spec->>'definitionVersion')::integer)
  OR jsonb_typeof(scope) IS DISTINCT FROM 'object' OR scope-ARRAY['institution','term','cycle']<>'{}'::jsonb OR NOT(scope ?& ARRAY['institution','term','cycle'])
  OR jsonb_typeof(win) IS DISTINCT FROM 'object' OR win-ARRAY['start','end','timeZone']<>'{}'::jsonb OR NOT(win ?& ARRAY['start','end','timeZone'])
  OR jsonb_typeof(link->'report') IS DISTINCT FROM 'object' OR (link->'report')-ARRAY['id','version']<>'{}'::jsonb OR NOT(link->'report' ?& ARRAY['id','version'])
  THEN RAISE EXCEPTION 'invalid_outcome_recording' USING ERRCODE='23514'; END IF;
 IF coalesce(length(btrim(scope->>'institution')),0) NOT BETWEEN 1 AND 200 OR coalesce(length(btrim(scope->>'term')),0) NOT BETWEEN 1 AND 100 OR coalesce(length(btrim(scope->>'cycle')),0) NOT BETWEEN 1 AND 128
  OR coalesce(win->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(win->>'end','') !~ '^\d{4}-\d{2}-\d{2}$'
  THEN RAISE EXCEPTION 'invalid_outcome_scope' USING ERRCODE='23514'; END IF;
 startday:=(win->>'start')::date;endday:=(win->>'end')::date;
 IF startday<'1900-01-01' OR endday<startday OR endday-startday>=366 THEN RAISE EXCEPTION 'invalid_outcome_window' USING ERRCODE='23514'; END IF;
 SELECT * INTO report FROM origen_student_follow_up_reports WHERE account_id=owner AND student_id=student AND plan_id=plan AND step_id=step AND id=(link->'report'->>'id')::uuid FOR UPDATE;
 IF report.id IS NULL OR report.version IS DISTINCT FROM (link->'report'->>'version')::integer OR report.response_state IS DISTINCT FROM link->>'responseState' THEN RAISE EXCEPTION 'outcome_report_changed' USING ERRCODE='23514'; END IF;
 IF report.response_state='answered' THEN
  IF coalesce(link->>'claimStatus','') NOT IN ('occurred','not_occurred','pending','unknown','goal_changed') THEN RAISE EXCEPTION 'invalid_outcome_claim' USING ERRCODE='23514'; END IF;
 ELSE
  IF link->'claimStatus'<>'null'::jsonb OR link->'decision'<>'null'::jsonb OR correction<>'null'::jsonb THEN RAISE EXCEPTION 'invalid_outcome_claim' USING ERRCODE='23514'; END IF;
 END IF;
 IF spec->>'definitionId'='decision_received' AND link->>'claimStatus'='occurred' THEN
  IF coalesce(link->>'decision','') NOT IN ('approved','denied','other','unknown') THEN RAISE EXCEPTION 'invalid_outcome_decision' USING ERRCODE='23514'; END IF;
 ELSIF link->'decision'<>'null'::jsonb THEN RAISE EXCEPTION 'invalid_outcome_decision' USING ERRCODE='23514'; END IF;
 detail:=report.detail;day:=report.occurred_on;tz:=report.time_zone;
 IF correction<>'null'::jsonb THEN
  IF jsonb_typeof(correction) IS DISTINCT FROM 'object' OR correction-ARRAY['detail','occurredOn','timeZone']<>'{}'::jsonb OR NOT(correction ?& ARRAY['detail','occurredOn','timeZone'])
   OR jsonb_typeof(correction->'detail') IS DISTINCT FROM 'string' OR length(correction->>'detail')>2000 OR report.response_state<>'answered'
   OR correction->'occurredOn'<>'null'::jsonb AND coalesce(correction->>'occurredOn','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid_outcome_correction' USING ERRCODE='23514'; END IF;
  detail:=correction->>'detail';day:=(correction->>'occurredOn')::date;tz:=correction->>'timeZone';
 END IF;
 IF tz IS DISTINCT FROM win->>'timeZone' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz)
  OR day IS NOT NULL AND (day<startday OR day>endday OR day>(clock_timestamp() AT TIME ZONE tz)::date) THEN RAISE EXCEPTION 'invalid_outcome_date' USING ERRCODE='23514'; END IF;
 PERFORM origen_outcome_reconcile(owner,plan);
 SELECT * INTO episode FROM origen_outcome_episodes WHERE account_id=owner AND plan_id=plan AND step_id=step AND definition_id=spec->>'definitionId' AND definition_version=(spec->>'definitionVersion')::integer AND institution=scope->>'institution' AND term=scope->>'term' AND cycle=scope->>'cycle' FOR UPDATE;
 IF episode.id IS NULL AND (SELECT count(*) FROM origen_outcome_episodes WHERE account_id=owner AND plan_id=plan AND step_id=step)>=50 THEN RAISE EXCEPTION 'outcome_limit' USING ERRCODE='23514'; END IF;
 IF input->'replaces'<>'null'::jsonb THEN
  IF jsonb_typeof(input->'replaces') IS DISTINCT FROM 'object' OR (input->'replaces')-ARRAY['id','version']<>'{}'::jsonb OR NOT(input->'replaces' ?& ARRAY['id','version']) THEN RAISE EXCEPTION 'invalid_outcome_replacement' USING ERRCODE='23514'; END IF;
  SELECT r.* INTO previous FROM origen_outcome_evidence r JOIN origen_outcome_episodes e ON e.account_id=r.account_id AND e.id=r.episode_id WHERE r.account_id=owner AND r.id=(input->'replaces'->>'id')::uuid AND e.plan_id=plan AND e.step_id=step AND r.report_id=report.id FOR UPDATE OF r;
  IF previous.id IS NULL OR previous.version IS DISTINCT FROM (input->'replaces'->>'version')::integer THEN RAISE EXCEPTION 'outcome_evidence_changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM origen_outcome_evidence WHERE account_id=owner AND episode_id=episode.id AND report_id=report.id AND id IS DISTINCT FROM previous.id) THEN RAISE EXCEPTION 'outcome_evidence_changed' USING ERRCODE='23514'; END IF;
 IF previous.id IS NULL AND (SELECT count(*) FROM origen_outcome_evidence r JOIN origen_outcome_episodes e ON e.account_id=r.account_id AND e.id=r.episode_id WHERE e.account_id=owner AND e.plan_id=plan AND e.step_id=step)>=100 THEN RAISE EXCEPTION 'outcome_limit' USING ERRCODE='23514'; END IF;
 renewal:=episode.id IS NOT NULL AND (episode.state<>'current' OR episode.window_start<>startday OR episode.window_end<>endday OR episode.time_zone<>tz OR correction<>'null'::jsonb);
 snapshot:=jsonb_build_object('definitionId',spec->'definitionId','definitionVersion',spec->'definitionVersion','scope',scope,'responseState',link->'responseState','claimStatus',link->'claimStatus','decision',link->'decision','statement',detail,'eventOn',day,'timeZone',tz);
 RETURN jsonb_build_object('input',input,'snapshot',snapshot,'existingEpisode',CASE WHEN episode.id IS NOT NULL THEN to_jsonb(episode)-'account_id' END,'previousEvidence',CASE WHEN previous.id IS NOT NULL THEN to_jsonb(previous)-'account_id' END,'renew',renewal);
END $$;

CREATE FUNCTION origen_outcome_recording_commit(owner uuid,student text,plan uuid,step text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE input jsonb:=payload->'input'; link jsonb:=input->'link'; spec jsonb:=link->'episode'; snapshot jsonb:=payload->'snapshot';
 selected_episode uuid; evidence_id uuid:=coalesce((input->'replaces'->>'id')::uuid,gen_random_uuid()); report_version integer:=(link->'report'->>'version')::integer;
 evidence_version integer:=coalesce((input->'replaces'->>'version')::integer,0)+1;
BEGIN
 IF origen_outcome_recording_payload(owner,student,plan,step,input) IS DISTINCT FROM payload THEN RAISE EXCEPTION 'outcome_recording_changed' USING ERRCODE='23514'; END IF;
 IF input->'correction'<>'null'::jsonb THEN
  UPDATE origen_student_follow_up_reports SET version=version+1,detail=snapshot->>'statement',occurred_on=(snapshot->>'eventOn')::date,time_zone=snapshot->>'timeZone',updated_at=clock_timestamp()
   WHERE account_id=owner AND id=(link->'report'->>'id')::uuid AND version=report_version RETURNING version INTO report_version;
  IF report_version IS NULL THEN RAISE EXCEPTION 'outcome_report_changed' USING ERRCODE='23514'; END IF;
 END IF;
 selected_episode:=(payload->'existingEpisode'->>'id')::uuid;
 IF selected_episode IS NULL THEN
  INSERT INTO origen_outcome_episodes(account_id,student_id,plan_id,step_id,definition_id,definition_version,institution,term,cycle,window_start,window_end,time_zone,consented_at)
   VALUES(owner,student,plan,step,spec->>'definitionId',(spec->>'definitionVersion')::integer,spec->'scope'->>'institution',spec->'scope'->>'term',spec->'scope'->>'cycle',(spec->'window'->>'start')::date,(spec->'window'->>'end')::date,snapshot->>'timeZone',now()) RETURNING id INTO selected_episode;
 ELSIF (payload->>'renew')::boolean THEN
  DELETE FROM origen_outcome_evidence WHERE account_id=owner AND origen_outcome_evidence.episode_id=selected_episode;
  UPDATE origen_outcome_episodes SET version=version+1,state='current',invalidation_reason=NULL,consented_at=now(),window_start=(spec->'window'->>'start')::date,window_end=(spec->'window'->>'end')::date,time_zone=snapshot->>'timeZone' WHERE account_id=owner AND id=selected_episode;
 END IF;
 DELETE FROM origen_outcome_evidence WHERE account_id=owner AND id=evidence_id;
 INSERT INTO origen_outcome_evidence(account_id,id,episode_id,version,report_id,report_version,response_state,claim_status,decision,event_on,date_precision,time_zone,approved_at)
  VALUES(owner,evidence_id,selected_episode,evidence_version,(link->'report'->>'id')::uuid,report_version,link->>'responseState',link->>'claimStatus',link->>'decision',(snapshot->>'eventOn')::date,CASE WHEN snapshot->>'eventOn' IS NULL THEN 'unknown' ELSE 'day' END,snapshot->>'timeZone',now());
 RETURN jsonb_build_object('status','saved','kind','outcome','episodeId',selected_episode,'evidenceId',evidence_id,'version',evidence_version,'reportVersion',report_version);
END $$;

DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_follow_up_conversation_command(jsonb)'::regprocedure);
 anchor:='plan:=p.plan_id;step:=p.step_id;';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_proposal'; END IF;
 d:=replace(d,anchor,anchor||$patch$
  IF input ? 'expectedKind' AND p.kind IS DISTINCT FROM input->>'expectedKind' THEN RETURN '{"error":"follow_up_proposal_changed"}'; END IF;
 $patch$);
 anchor:='IF p.kind=''report'' THEN';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_replay'; END IF;
 d:=replace(d,anchor,$patch$IF p.kind='outcome' THEN
   IF NOT EXISTS(SELECT 1 FROM origen_outcome_evidence WHERE account_id=owner AND id=(p.result->>'evidenceId')::uuid AND version=(p.result->>'version')::integer) THEN RETURN '{"status":"superseded"}'; END IF;
  ELSIF p.kind='report' THEN$patch$);
 anchor:='IF action=''prepare'' THEN';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_prepare'; END IF;
 d:=replace(d,anchor,$patch$
 IF (p.kind='outcome' OR input->>'kind'='outcome') AND coalesce(current_setting('origen.outcome_evidence',true),'false')<>'true' THEN RETURN '{"error":"follow_up_paused"}'; END IF;
 $patch$||anchor);
 d:=replace(d,'input->>''kind'' NOT IN (''check-in'',''report'')','input->>''kind'' NOT IN (''check-in'',''report'',''outcome'')');
 anchor:='ELSE'||chr(10)||'    report:=body->''report'';';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_payload'; END IF;
 d:=replace(d,anchor,$patch$ELSIF input->>'kind'='outcome' THEN
    body:=origen_outcome_recording_payload(owner,student,plan,step,body);
   ELSE
    report:=body->'report';$patch$);
 anchor:='ELSE'||chr(10)||'  body:=p.payload;report:=body->''report'';';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_commit'; END IF;
 d:=replace(d,anchor,$patch$ELSIF p.kind='outcome' THEN
  answer:=origen_outcome_recording_commit(owner,student,plan,step,p.payload);
 ELSE
  body:=p.payload;report:=body->'report';$patch$);
 d:=replace(d,$old$THEN RETURN '{"error":"invalid_follow_up"}';
END$old$,$new$THEN
 IF SQLERRM LIKE 'outcome%changed' THEN RETURN jsonb_build_object('error',SQLERRM); END IF;
 RETURN '{"error":"invalid_follow_up"}';
END$new$);
 EXECUTE d;

 d:=pg_get_functiondef('origen_outcome_evidence_command(jsonb)'::regprocedure);
 anchor:='RETURN jsonb_build_object(''episodes'',coalesce((SELECT jsonb_agg(to_jsonb(e)-''account_id''-''action_hash'' ORDER BY';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_load'; END IF;
 d:=replace(d,anchor,$patch$RETURN jsonb_build_object('planVersion',(origen_student_follow_up_target(owner,plan,step)->'planVersion'),
  'canRecord',(origen_student_follow_up_target(owner,plan,step)->>'permitted'='true' AND origen_student_follow_up_target(owner,plan,step)->>'sourceCurrent'='true'),
  'episodes',coalesce((SELECT jsonb_agg(to_jsonb(e)-'account_id'-'action_hash' ORDER BY$patch$);
 anchor:='SELECT e.* FROM origen_outcome_evidence e JOIN origen_outcome_episodes p';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_evidence_load'; END IF;
 d:=replace(d,anchor,'SELECT e.*,r.detail AS statement FROM origen_outcome_evidence e JOIN origen_student_follow_up_reports r ON r.account_id=e.account_id AND r.id=e.report_id AND r.version=e.report_version JOIN origen_outcome_episodes p');
 EXECUTE d;
END $$;

CREATE FUNCTION origen_outcome_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END; student text;
BEGIN
 SELECT student_id INTO student FROM origen_outcome_episodes WHERE account_id=(row->>'account_id')::uuid AND id=(row->>'episode_id')::uuid;
 IF student IS NOT NULL THEN INSERT INTO origen_memory_scopes(account_id,scope_key,student_id) VALUES((row->>'account_id')::uuid,student,student) ON CONFLICT(account_id,scope_key) DO UPDATE SET revision=origen_memory_scopes.revision+1; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER outcome_episode_context_changed AFTER UPDATE OR DELETE ON origen_outcome_episodes FOR EACH ROW EXECUTE FUNCTION origen_memory_context_changed();
CREATE TRIGGER outcome_context_changed AFTER INSERT OR DELETE ON origen_outcome_evidence FOR EACH ROW EXECUTE FUNCTION origen_outcome_context_changed();
-- Canonical correction/deletion also scrubs pending copied readbacks. The
-- committing proposal keeps its local payload and stores only its receipt.
CREATE FUNCTION origen_outcome_pending_report_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 UPDATE origen_follow_up_proposals SET payload=NULL,readback_hash=NULL,presented=false,expires_at=least(expires_at,clock_timestamp())
 WHERE account_id=OLD.account_id AND kind='outcome' AND result IS NULL AND payload->'input'->'link'->'report'->>'id'=OLD.id::text;
 RETURN NULL;
END $$;
CREATE TRIGGER outcome_pending_report_changed AFTER UPDATE OR DELETE ON origen_student_follow_up_reports FOR EACH ROW EXECUTE FUNCTION origen_outcome_pending_report_changed();
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT oid FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'origen_outcome_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.oid::regprocedure);EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn.oid::regprocedure,current_schema());
 END LOOP;
END $$;

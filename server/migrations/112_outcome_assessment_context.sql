-- Assessments are derived on read. No stored conclusion, inferred report/share
-- relationship, evaluation dataset or permission backfill is introduced.
CREATE FUNCTION origen_outcome_assessment_sources(owner uuid,student text,ref jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE episodes jsonb; evidence jsonb; observations jsonb; selected uuid[]; row record; limited boolean:=false;
BEGIN
 IF coalesce(current_setting('origen.outcome_context',true),'false')<>'true' THEN RETURN NULL; END IF;
 IF NOT origen_coordinator_student_ready(owner,student) THEN RETURN NULL; END IF;
 -- Resolve only exact accepted-action/response identities. Shared copies are
 -- returned separately; matching prose/scope does not create a private link.
 SELECT array_agg(id ORDER BY recorded_at,id) INTO selected FROM (
  SELECT id,recorded_at FROM origen_outcome_episodes WHERE account_id=owner AND student_id=student
   AND request_id=(ref->>'requestId')::uuid AND response_version=(ref->>'responseVersion')::integer ORDER BY recorded_at,id LIMIT 9) e;
 limited:=coalesce(array_length(selected,1),0)>8;selected:=selected[1:8];
 FOR row IN SELECT DISTINCT plan_id FROM origen_outcome_episodes WHERE account_id=owner AND id=ANY(selected) LOOP PERFORM origen_outcome_reconcile(owner,row.plan_id); END LOOP;
 SELECT coalesce(jsonb_agg((to_jsonb(e)-ARRAY['account_id','action_hash'])||jsonb_build_object('asOfDay',(clock_timestamp() AT TIME ZONE e.time_zone)::date) ORDER BY e.recorded_at,e.id),'[]'::jsonb) INTO episodes
  FROM origen_outcome_episodes e WHERE account_id=owner AND id=ANY(selected);
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.recorded_at,x.id),'[]'::jsonb) INTO evidence FROM (
  SELECT e.id,e.recorded_at,(to_jsonb(e)-'account_id')||jsonb_build_object('statement',r.detail) AS item FROM origen_outcome_evidence e
   JOIN origen_student_follow_up_reports r ON r.account_id=e.account_id AND r.id=e.report_id AND r.version=e.report_version
   WHERE e.account_id=owner AND e.episode_id=ANY(selected) ORDER BY e.recorded_at,e.id LIMIT 81) x;
 IF jsonb_array_length(evidence)>80 THEN limited:=true;evidence:=evidence-80; END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.created_at,x.id),'[]'::jsonb) INTO observations FROM (
  SELECT o.id,o.created_at,origen_outcome_observation_view(o.id,true)||jsonb_build_object('source',jsonb_build_object('requestId',r.id,'publicationId',o.publication_id),
   'asOfDay',(clock_timestamp() AT TIME ZONE coalesce(o.payload->>'timeZone','UTC'))::date) AS item
  FROM origen_outcome_observations o JOIN origen_review_requests r ON r.id=o.request_id
  WHERE o.account_id=owner AND o.student_id=student AND (r.id=(ref->>'requestId')::uuid OR (r.related_request_id=(ref->>'requestId')::uuid AND r.related_response_version=(ref->>'responseVersion')::integer AND NOT r.related_detached))
  ORDER BY o.created_at,o.id LIMIT 11) x;
 IF jsonb_array_length(observations)>10 THEN limited:=true;observations:=observations-10; END IF;
 RETURN jsonb_build_object('ruleVersion',current_setting('origen.outcome_rule_version',true),'episodes',episodes,'evidence',evidence,'observations',observations,'limited',limited,
  'definitions',(SELECT jsonb_agg(contract ORDER BY id,version) FROM origen_outcome_definitions));
END $$;
-- Include definition/expiry in the same authorized projection for binder,
-- coordinator and voice assessment. No private fields are added for staff.
DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_outcome_observation_view(uuid,boolean)'::regprocedure);
 anchor:='''updatedAt'',o.updated_at,';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_observation_assessment_view'; END IF;
 d:=replace(d,anchor,$patch$'updatedAt',o.updated_at,
  'validUntil',least(c.expires_at,(SELECT expires_at FROM origen_review_request_publications WHERE id=o.publication_id)),
  'definitionContract',(SELECT contract FROM origen_outcome_definitions WHERE id=o.payload->'claim'->>'definitionId' AND version=(o.payload->'claim'->>'definitionVersion')::integer),$patch$);EXECUTE d;
 d:=pg_get_functiondef('origen_outcome_evidence_command(jsonb)'::regprocedure);
 anchor:='''canRecord'',(origen_student_follow_up_target';
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_private_assessment_view'; END IF;
 d:=replace(d,anchor,$patch$'definitions',(SELECT jsonb_agg(contract ORDER BY id,version) FROM origen_outcome_definitions),
  'canRecord',(origen_student_follow_up_target$patch$);EXECUTE d;
END $$;
-- Bind the existing response guard to exact current outcome inputs and rule
-- version, including time/permission changes. Existing client polling and both
-- providers use this guard; no second unguarded context channel is introduced.
DO $$ DECLARE d text; anchor text; BEGIN
 d:=pg_get_functiondef('origen_review_response_context_command(jsonb)'::regprocedure);
 anchor:='context_revision text;';IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_context_declaration'; END IF;
 d:=replace(d,anchor,'context_revision text; outcome_inputs jsonb;');
 anchor:='context_revision:=encode(sha256';IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_context_revision'; END IF;
 d:=replace(d,anchor,$patch$outcome_inputs:=origen_outcome_assessment_sources(owner,student,current_source);
 context_revision:=encode(sha256$patch$);
 anchor:='''source'',current_source,''generation''';IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_context_hash'; END IF;
 d:=replace(d,anchor,'''outcomeInputs'',outcome_inputs,''source'',current_source,''generation''');
 anchor:='''status'',''retrieved'',''guard''';IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_outcome_context_result'; END IF;
 d:=replace(d,anchor,'''outcomeInputs'',outcome_inputs,''status'',''retrieved'',''guard''');EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION origen_outcome_assessment_sources(uuid,text,jsonb) FROM PUBLIC;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_outcome_assessment_sources(uuid,text,jsonb) SET search_path=%I,pg_temp',current_schema()); END $$;

-- Only a separately approved outcome preview can create this relationship.
-- Existing episodes are not backfilled or joined by wording/timing.
CREATE TABLE origen_outcome_recommendation_links (
 account_id uuid NOT NULL, episode_id uuid NOT NULL, episode_version integer NOT NULL,
 recommendation_id uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,episode_id),
 FOREIGN KEY(account_id,episode_id) REFERENCES origen_outcome_episodes(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,recommendation_id) REFERENCES origen_plan_recommendations(account_id,id) ON DELETE CASCADE
);
ALTER TABLE origen_outcome_recommendation_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_outcome_recommendation_links FROM PUBLIC;
CREATE FUNCTION origen_outcome_recommendation_reference(owner uuid,student text,plan uuid,step text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('kind','accepted-recommendation','id',r.id,'policyVersion',r.policy_version,'source',r.source,'sourceRevision',r.source_revision,'acceptedPlanVersion',r.plan_version)
 FROM origen_plan_recommendations r JOIN origen_plan_steps s ON s.account_id=r.account_id AND s.plan_id=r.plan_id AND s.id=r.step_id
 WHERE r.account_id=owner AND r.student_id=student AND r.plan_id=plan AND r.step_id=step AND r.action_hash=encode(sha256(convert_to(s.action,'UTF8')),'hex')
$$;
ALTER FUNCTION origen_outcome_recording_payload(uuid,text,uuid,text,jsonb) RENAME TO origen_outcome_recording_payload_v1;
CREATE FUNCTION origen_outcome_recording_payload(owner uuid,student text,plan uuid,step text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE payload jsonb:=origen_outcome_recording_payload_v1(owner,student,plan,step,input); ref jsonb;
BEGIN
 IF coalesce(current_setting('origen.recommendation_provenance',true),'false')='true' THEN
  ref:=origen_outcome_recommendation_reference(owner,student,plan,step);
  IF ref IS NOT NULL THEN payload:=payload||jsonb_build_object('recommendation',ref); END IF;
 END IF;
 RETURN payload;
END $$;
ALTER FUNCTION origen_outcome_recording_commit(uuid,text,uuid,text,jsonb) RENAME TO origen_outcome_recording_commit_v1;
CREATE FUNCTION origen_outcome_recording_commit(owner uuid,student text,plan uuid,step text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 -- The existing commit regenerates the exact preview and checks its digest.
 -- A changed canonical action/provenance cannot attach a different relationship.
 PERFORM set_config('origen.recommendation_provenance',CASE WHEN payload ? 'recommendation' THEN 'true' ELSE 'false' END,true);
 result:=origen_outcome_recording_commit_v1(owner,student,plan,step,payload);
 DELETE FROM origen_outcome_recommendation_links WHERE account_id=owner AND episode_id=(result->>'episodeId')::uuid;
 IF payload ? 'recommendation' THEN
  INSERT INTO origen_outcome_recommendation_links(account_id,episode_id,episode_version,recommendation_id)
   SELECT owner,id,version,(payload->'recommendation'->>'id')::uuid FROM origen_outcome_episodes WHERE account_id=owner AND id=(result->>'episodeId')::uuid;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION origen_recommendation_outcomes_export() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('episodeId',r.episode_id,'episodeVersion',r.episode_version,'recommendationId',r.recommendation_id,'approvedAt',r.approved_at,
  'current',e.state='current' AND e.version=r.episode_version AND p.action_hash=encode(sha256(convert_to(s.action,'UTF8')),'hex')) ORDER BY r.approved_at),'[]'::jsonb)
 FROM origen_outcome_recommendation_links r JOIN origen_outcome_episodes e ON e.account_id=r.account_id AND e.id=r.episode_id
 JOIN origen_plan_recommendations p ON p.account_id=r.account_id AND p.id=r.recommendation_id
 JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.plan_id AND s.id=p.step_id
 JOIN origen_accounts a ON a.id=r.account_id
 WHERE a.auth0_subject=nullif(current_setting('origen.subject',true),'') AND current_setting('origen.purpose',true)='account'
$$;
CREATE OR REPLACE FUNCTION origen_recommendation_acceptance_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 DELETE FROM origen_recommendation_previews;
 DELETE FROM origen_outcome_recommendation_links;
$$;
DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_outcome_recommendation_reference(uuid,text,uuid,text)','origen_outcome_recording_payload(uuid,text,uuid,text,jsonb)','origen_outcome_recording_payload_v1(uuid,text,uuid,text,jsonb)','origen_outcome_recording_commit(uuid,text,uuid,text,jsonb)','origen_outcome_recording_commit_v1(uuid,text,uuid,text,jsonb)','origen_recommendation_outcomes_export()','origen_recommendation_acceptance_after_restore()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;

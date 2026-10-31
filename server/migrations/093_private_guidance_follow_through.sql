-- Private student choices. Reading or talking about a comment never writes these.
ALTER TABLE origen_coordinator_feedback
 ADD COLUMN student_follow_state text NOT NULL DEFAULT 'available' CHECK(student_follow_state IN ('available','explored','deferred')),
 ADD COLUMN student_follow_revision integer NOT NULL DEFAULT 0 CHECK(student_follow_revision>=0),
 ADD COLUMN student_follow_version integer,
 ADD COLUMN student_follow_at timestamptz;
CREATE INDEX origen_feedback_steps_source ON origen_coordinator_feedback_steps(feedback_id,account_id);

-- Internal projection only. Staff must never receive plan status or private choices.
CREATE FUNCTION origen_student_guidance_progress(fid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT jsonb_build_object('state',f.student_follow_state,'revision',f.student_follow_revision,
  'feedbackVersion',f.student_follow_version,'updatedAt',f.student_follow_at,
  'steps',coalesce((SELECT jsonb_agg(jsonb_build_object('planId',x.plan_id,'stepId',x.step_id,
    'status',x.status,'planStatus',x.plan_status,'planVersion',x.plan_version,'feedbackVersion',x.feedback_version))
   FROM (SELECT l.plan_id,l.step_id,l.feedback_version,s.status,p.status AS plan_status,p.version AS plan_version
    FROM origen_coordinator_feedback_steps l
    JOIN origen_plans p ON p.account_id=l.account_id AND p.id=l.plan_id AND p.student_id=f.student_id
    JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id AND s.id=l.step_id
    WHERE l.feedback_id=f.id AND l.account_id=f.account_id ORDER BY p.updated_at DESC,l.plan_id,l.step_id LIMIT 30) x),'[]'::jsonb),
  'stepsTruncated',(SELECT count(*)>30 FROM origen_coordinator_feedback_steps l
   JOIN origen_plans p ON p.account_id=l.account_id AND p.id=l.plan_id AND p.student_id=f.student_id
   JOIN origen_plan_steps s ON s.account_id=p.account_id AND s.plan_id=p.id AND s.id=l.step_id
   WHERE l.feedback_id=f.id AND l.account_id=f.account_id))
 FROM origen_coordinator_feedback f JOIN origen_accounts a ON a.id=f.account_id
 WHERE f.id=fid AND f.removed_at IS NULL AND a.role='student'
  AND a.auth0_subject=nullif(current_setting('origen.subject',true),'')
  AND current_setting('origen.purpose',true)='account'
$$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION origen_student_guidance_progress(uuid) SET search_path=%I,pg_temp',current_schema()); END $$;
REVOKE ALL ON FUNCTION origen_student_guidance_progress(uuid) FROM PUBLIC;

-- Invalidate prepared voice snapshots after an explicit private choice. Plan
-- mutations already increment this revision through migration 048's triggers.
CREATE TRIGGER voice_follow_through_changed AFTER UPDATE OF student_follow_revision ON origen_coordinator_feedback
 FOR EACH ROW WHEN (OLD.student_follow_revision IS DISTINCT FROM NEW.student_follow_revision)
 EXECUTE FUNCTION origen_voice_context_changed();

-- Keep all existing version, actor, grant, tombstone and idempotency checks.
DO $$
DECLARE definition text:=pg_get_functiondef('origen_coordinator_feedback_v6(jsonb)'::regprocedure);
 needle text; replacement text;
BEGIN
 FOR needle,replacement IN SELECT * FROM (VALUES
  ($old$'student-source','student-link') THEN$old$,$new$'student-source','student-link','student-follow-through') THEN$new$),
  ($old$'publicationItemId',x.publication_item_id,$old$,$new$'followThrough',CASE WHEN staff THEN NULL ELSE origen_student_guidance_progress(x.id) END,'publicationItemId',x.publication_item_id,$new$),
  ($old$ELSIF action='student-source' THEN$old$,$new$ELSIF action='student-follow-through' THEN
   IF f.withdrawn_at IS NOT NULL OR f.hidden_at IS NOT NULL THEN RETURN '{"error":"feedback_unavailable"}'; END IF;
   IF input->>'state' IS NULL OR input->>'state' NOT IN ('available','explored','deferred') THEN RETURN '{"error":"feedback_denied"}'; END IF;
   IF (input->>'progressRevision')::integer IS DISTINCT FROM f.student_follow_revision THEN RETURN '{"error":"feedback_changed"}'; END IF;
   UPDATE origen_coordinator_feedback SET student_follow_state=input->>'state',student_follow_revision=student_follow_revision+1,
    student_follow_version=version,student_follow_at=clock_timestamp() WHERE id=f.id;
  ELSIF action='student-source' THEN$new$),
  ($old$'connectionEnded',NOT live);$old$,$new$'connectionEnded',NOT live,'followThrough',origen_student_guidance_progress(f.id));$new$)
 ) AS changes(a,b) LOOP
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'unexpected_follow_through_function: %',needle; END IF;
  definition:=replace(definition,needle,replacement);
 END LOOP;
 EXECUTE definition;
END $$;

-- Allow only the same owner-only receipt metadata updates after sharing ends.
DO $$
DECLARE definition text:=pg_get_functiondef('origen_binder_feedback_parent()'::regprocedure);
 needle text:=$old$ARRAY['reviewed_version','hidden_at','removed_at','body','resource_url','version']$old$;
 replacement text:=$new$ARRAY['reviewed_version','hidden_at','removed_at','body','resource_url','version','student_follow_state','student_follow_revision','student_follow_version','student_follow_at']$new$;
BEGIN
 IF length(definition)-length(replace(definition,needle,''))<>2*length(needle) THEN RAISE EXCEPTION 'unexpected_follow_through_parent_guard'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;

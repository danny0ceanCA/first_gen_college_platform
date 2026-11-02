-- Phase 2 step 1: response provenance and a read-only connection contract.
-- There is still exactly one response body per request; old versions are not
-- archived as prose. The owning student's private receipt is not a staff grant.
ALTER TABLE origen_review_request_responses ADD COLUMN author_name text, ADD COLUMN organization_name text;
-- A response could only be written while these request names matched the live
-- recipient. Preserve those historical facts, not today's directory labels.
UPDATE origen_review_request_responses a SET author_name=r.coordinator_name,organization_name=r.organization_name
 FROM origen_review_requests r WHERE r.id=a.request_id;
ALTER TABLE origen_review_request_responses ALTER COLUMN author_name SET NOT NULL, ALTER COLUMN organization_name SET NOT NULL;

CREATE FUNCTION origen_review_response_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT r.coordinator_name,r.organization_name INTO NEW.author_name,NEW.organization_name
   FROM origen_review_requests r JOIN origen_review_request_publications p ON p.request_id=r.id
   WHERE r.id=NEW.request_id AND r.account_id=NEW.account_id AND r.student_id=NEW.student_id
    AND p.id=NEW.publication_id AND p.recipient_subject=NEW.author_subject;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_response_provenance_required' USING ERRCODE='23514'; END IF;
 ELSE
  -- Edits, withdrawal and restore scrubbing never relabel the original author.
  IF (NEW.request_id,NEW.account_id,NEW.student_id,NEW.publication_id,NEW.author_subject,NEW.created_at)
   IS DISTINCT FROM (OLD.request_id,OLD.account_id,OLD.student_id,OLD.publication_id,OLD.author_subject,OLD.created_at)
   THEN RAISE EXCEPTION 'review_response_provenance_immutable' USING ERRCODE='23514'; END IF;
  NEW.author_name:=OLD.author_name;NEW.organization_name:=OLD.organization_name;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_response_provenance BEFORE INSERT OR UPDATE ON origen_review_request_responses
 FOR EACH ROW EXECUTE FUNCTION origen_review_response_provenance();

-- Internal projection. Both this helper and its command are read-only: loading
-- metadata cannot mark a notification/response opened, discussed or accepted.
CREATE FUNCTION origen_review_response_connection(rid uuid,expected_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r origen_review_requests%ROWTYPE; a origen_review_request_responses%ROWTYPE;
 p origen_review_request_publications%ROWTYPE; notice origen_coordinator_outbox%ROWTYPE;
 ref jsonb; live boolean; reason text;
BEGIN
 SELECT q.* INTO r FROM origen_review_requests q JOIN origen_accounts owner ON owner.id=q.account_id
  WHERE q.id=rid AND owner.auth0_subject=nullif(current_setting('origen.subject',true),'')
   AND current_setting('origen.purpose',true)='account'
   AND NOT EXISTS(SELECT 1 FROM origen_closed_accounts c WHERE c.subject_hash=encode(sha256(convert_to(owner.auth0_subject,'UTF8')),'hex'));
 IF r.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM origen_review_request_responses WHERE request_id=r.id;
 ref:=CASE WHEN coalesce(expected_version,a.version) IS NULL THEN NULL ELSE jsonb_build_object(
  'kind','review-response','requestId',r.id,'responseVersion',coalesce(expected_version,a.version)) END;
 -- Revocation takes precedence over a stale reference. Never substitute a new
 -- version or expose a withdrawn body to satisfy an old connection.
 reason:=CASE WHEN a.request_id IS NULL THEN 'no_response' WHEN a.withdrawn_at IS NOT NULL THEN 'response_withdrawn'
  WHEN expected_version IS NOT NULL AND expected_version<>a.version THEN 'response_changed' END;
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('availability','unavailable','reason',reason,'source',ref,'currentVersion',a.version); END IF;
 SELECT * INTO p FROM origen_review_request_publications WHERE id=a.publication_id;
 live:=origen_review_request_live(r.id);
 reason:=CASE WHEN live THEN NULL WHEN r.status='withdrawn' THEN 'withdrawn' WHEN p.invalidation_reason IS NOT NULL THEN p.invalidation_reason
  WHEN p.expires_at<=clock_timestamp() THEN 'expired' ELSE 'access_changed' END;
 SELECT * INTO notice FROM origen_coordinator_outbox
  WHERE account_id=r.account_id AND student_id=r.student_id AND kind='review-response' AND event_key='review-response:'||r.id||':'||a.version;
 RETURN jsonb_build_object('availability',CASE WHEN live THEN 'current' ELSE 'historical' END,'reason',reason,'source',ref,'currentVersion',a.version,
  'request',jsonb_build_object('id',r.id,'status',r.status,'originalQuestion',r.original_question,
   'approvedQuestion',CASE WHEN p.wording='clarification' THEN r.proposed_clarification ELSE r.original_question END,'approvedWording',p.wording,
   'submittedAt',r.submitted_at,'withdrawnAt',r.withdrawn_at,'coordinatorOpenedAt',p.opened_at,'coordinatorReviewedAt',p.reviewed_at),
  'response',jsonb_build_object('version',a.version,'createdAt',a.created_at,'updatedAt',a.updated_at,
   'author',jsonb_build_object('coordinatorId',r.coordinator_id,'name',a.author_name),
   'organization',jsonb_build_object('id',r.institution_id,'name',a.organization_name)),
  'notification',jsonb_build_object('status',coalesce(notice.status,'not_recorded'),'deliveredAt',CASE WHEN notice.status='delivered' THEN notice.finished_at END),
  'studentActivity',jsonb_build_object('opened','not_recorded','discussed','not_recorded','actionAccepted','not_recorded'),
  'scope',jsonb_build_object('aiEligible',origen_coordinator_student_ready(r.account_id,r.student_id),
   'requestPublicationCurrent',live,'historicalRequiresExplicitFocus',NOT live));
END $$;

CREATE FUNCTION origen_review_response_connection_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE ref jsonb:=input->'source'; result jsonb; actor text:=nullif(current_setting('origen.subject',true),'');
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_response_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['action','studentId','source']<>'{}'::jsonb OR input->>'action' IS DISTINCT FROM 'inspect'
  OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(input->>'studentId') NOT BETWEEN 1 AND 128
  OR length(btrim(input->>'studentId'))=0 OR input->>'studentId' ~ '[\x01-\x1f\x7f]'
  OR jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['kind','requestId','responseVersion']<>'{}'::jsonb
  OR ref->>'kind' IS DISTINCT FROM 'review-response' OR jsonb_typeof(ref->'requestId') IS DISTINCT FROM 'string'
  OR ref->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR jsonb_typeof(ref->'responseVersion') IS DISTINCT FROM 'number' OR ref->>'responseVersion' !~ '^[1-9][0-9]*$'
  THEN RETURN '{"error":"invalid_review_response_reference"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_review_requests r JOIN origen_accounts a ON a.id=r.account_id
  WHERE r.id=(ref->>'requestId')::uuid AND r.student_id=input->>'studentId' AND a.auth0_subject=actor)
  THEN RETURN '{"error":"review_response_unavailable"}'; END IF;
 result:=origen_review_response_connection((ref->>'requestId')::uuid,(ref->>'responseVersion')::integer);
 IF result IS NULL THEN RETURN '{"error":"review_response_unavailable"}'; END IF;
 RETURN jsonb_build_object('connection',result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_review_response_reference"}';
END $$;

-- Add metadata to the existing owner receipt/export; coordinator projections
-- remain separate and do not gain access to student-private facts/questions.
DO $$ DECLARE d text; anchor text:='''response'',origen_review_response_view(r.id))'; BEGIN
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_response_receipt'; END IF;
 EXECUTE replace(d,anchor,'''response'',origen_review_response_view(r.id),''connection'',origen_review_response_connection(r.id,NULL))');
END $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['origen_review_response_provenance()','origen_review_response_connection(uuid,integer)','origen_review_response_connection_command(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=%I,pg_temp',f,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 END LOOP;
END $$;

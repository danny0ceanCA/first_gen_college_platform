-- One response identity per verified spoken turn, with no copied prose. These
-- operational fences expire/delete/restore with the existing live sessions.
ALTER TABLE origen_review_request_responses ADD COLUMN context_generation uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE origen_live_memory_sessions ADD COLUMN review_response_sequence integer,
 ADD COLUMN review_response_request uuid, ADD COLUMN review_response_version integer,
 ADD COLUMN review_response_revision text;
ALTER TABLE origen_live_memory_sessions ADD CONSTRAINT review_response_turn_fence CHECK(
 num_nonnulls(review_response_sequence,review_response_request,review_response_version,review_response_revision)=0 OR
 (num_nonnulls(review_response_sequence,review_response_request,review_response_version,review_response_revision)=4
  AND review_response_sequence>0 AND review_response_version>0 AND review_response_revision ~ '^[a-f0-9]{64}$'));

CREATE FUNCTION origen_review_response_context_command(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); owner uuid; action text:=input->>'action'; student text:=input->>'studentId';
 ref jsonb:=input->'source'; r origen_review_requests%ROWTYPE; a origen_review_request_responses%ROWTYPE;
 p origen_review_request_publications%ROWTYPE; e origen_eligibility%ROWTYPE; s origen_live_memory_sessions%ROWTYPE;
 connection jsonb; candidates jsonb; context_revision text; mode text:=input->>'mode'; current_source jsonb; v jsonb:=input->'voice';
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_response_context_denied"}'; END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('candidates','read','verify')
  OR jsonb_typeof(input->'studentId') IS DISTINCT FROM 'string' OR length(student) NOT BETWEEN 1 AND 128 OR length(btrim(student))=0
  OR input-ARRAY['action','studentId','terms','source','mode','revision','voice']<>'{}'::jsonb THEN RETURN '{"error":"invalid_review_response_context"}'; END IF;
 IF coalesce(current_setting('origen.review_response_context',true),'false')<>'true' THEN RETURN '{"error":"review_response_context_paused"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor;
 IF owner IS NULL OR NOT origen_coordinator_student_ready(owner,student) THEN RETURN '{"status":"unavailable","reason":"scope_unavailable"}'; END IF;
 IF action='candidates' THEN
  IF input-ARRAY['action','studentId','terms']<>'{}'::jsonb OR jsonb_typeof(input->'terms') IS DISTINCT FROM 'array' THEN RETURN '{"error":"invalid_review_response_context"}'; END IF;
  IF jsonb_array_length(input->'terms') NOT BETWEEN 1 AND 60
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'terms') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' !~ '^[a-z0-9]{3,64}$') THEN RETURN '{"error":"invalid_review_response_context"}'; END IF;
  -- Limit after matching, so a relevant older question is not displaced by
  -- thirty newer unrelated requests. Never load candidate response bodies.
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.updated_at DESC,x.id),'[]') INTO candidates FROM (
   SELECT q.id,reply.updated_at,jsonb_build_object('source',jsonb_build_object('kind','review-response','requestId',q.id,'responseVersion',reply.version),
    'question',left(CASE WHEN pub.wording='clarification' THEN q.proposed_clarification ELSE q.original_question END,240),
    'authorName',reply.author_name,'organizationName',reply.organization_name,'updatedAt',reply.updated_at) AS item
   FROM origen_review_requests q JOIN origen_review_request_publications pub ON pub.request_id=q.id JOIN origen_review_request_responses reply ON reply.request_id=q.id
   WHERE q.account_id=owner AND q.student_id=student AND reply.withdrawn_at IS NULL AND origen_review_request_live(q.id)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(input->'terms') term WHERE term=ANY(regexp_split_to_array(translate(lower(CASE WHEN pub.wording='clarification' THEN q.proposed_clarification ELSE q.original_question END),'áéíóúüñ','aeiouun'),'[^a-z0-9]+')))
   ORDER BY reply.updated_at DESC,q.id LIMIT 31) x;
  RETURN jsonb_build_object('status','candidates','candidates',CASE WHEN jsonb_array_length(candidates)>30 THEN candidates-30 ELSE candidates END,'truncated',jsonb_array_length(candidates)>30);
 END IF;
 IF input-ARRAY['action','studentId','source','mode','revision','voice']<>'{}'::jsonb OR mode IS NULL OR mode NOT IN ('focus','question')
  OR jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['kind','requestId','responseVersion']<>'{}'::jsonb
  OR ref->>'kind' IS DISTINCT FROM 'review-response' OR jsonb_typeof(ref->'requestId') IS DISTINCT FROM 'string'
  OR ref->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR jsonb_typeof(ref->'responseVersion') IS DISTINCT FROM 'number' OR ref->>'responseVersion' !~ '^[1-9][0-9]*$'
  OR action='verify' AND (input ? 'voice' OR jsonb_typeof(input->'revision') IS DISTINCT FROM 'string' OR input->>'revision' !~ '^[a-f0-9]{64}$')
  OR action='read' AND input ? 'revision' THEN RETURN '{"error":"invalid_review_response_context"}'; END IF;
 SELECT * INTO r FROM origen_review_requests WHERE id=(ref->>'requestId')::uuid AND account_id=owner AND student_id=student;
 IF r.id IS NULL THEN RETURN '{"status":"unavailable","reason":"source_unavailable"}'; END IF;
 connection:=origen_review_response_connection(r.id,(ref->>'responseVersion')::integer);
 IF connection IS NULL OR connection->>'availability'='unavailable' OR connection->'scope'->>'aiEligible' IS DISTINCT FROM 'true'
  OR mode='question' AND connection->>'availability'<>'current' THEN RETURN '{"status":"unavailable","reason":"source_unavailable"}'; END IF;
 SELECT * INTO a FROM origen_review_request_responses WHERE request_id=r.id;
 IF a.request_id IS NULL OR a.withdrawn_at IS NOT NULL OR a.version<>(ref->>'responseVersion')::integer THEN RETURN '{"status":"unavailable","reason":"source_unavailable"}'; END IF;
 SELECT * INTO p FROM origen_review_request_publications WHERE id=a.publication_id;
 SELECT * INTO e FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
 current_source:=jsonb_build_object('kind','review-response','requestId',r.id,'responseVersion',a.version);
 context_revision:=encode(sha256(convert_to(jsonb_build_object('source',current_source,'generation',a.context_generation,'updatedAt',a.updated_at,'permission',e.revision,'permissionExpiresAt',e.permission_expires_at,
  'availability',connection->>'availability','reason',connection->>'reason','requestVersion',r.version,'invalidatedAt',p.invalidated_at,'expiresAt',p.expires_at,'mode',mode)::text,'UTF8')),'hex');
 IF action='verify' THEN RETURN jsonb_build_object('status',CASE WHEN context_revision=input->>'revision' THEN 'current' ELSE 'changed' END); END IF;
 IF v IS NOT NULL THEN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['sessionId','sequence','turnId','transcriptHash']<>'{}'::jsonb
   OR v->>'sessionId' IS NULL OR jsonb_typeof(v->'sequence') IS DISTINCT FROM 'number' OR v->>'sequence' !~ '^[1-9][0-9]*$'
   OR jsonb_typeof(v->'turnId') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'transcriptHash') IS DISTINCT FROM 'string' OR v->>'transcriptHash' !~ '^[a-f0-9]{64}$'
   THEN RETURN '{"error":"invalid_review_response_context"}'; END IF;
  SELECT * INTO s FROM origen_live_memory_sessions WHERE id=(v->>'sessionId')::uuid AND account_id=owner FOR UPDATE;
  IF s.id IS NULL OR s.student_id IS DISTINCT FROM student OR s.closed OR s.expires_at<=clock_timestamp()
   OR s.turn_sequence IS DISTINCT FROM (v->>'sequence')::integer OR s.turn_id IS DISTINCT FROM v->>'turnId' OR s.transcript_hash IS DISTINCT FROM v->>'transcriptHash'
   THEN RETURN '{"error":"review_response_turn_changed"}'; END IF;
  IF s.review_response_sequence=s.turn_sequence AND (s.review_response_request IS DISTINCT FROM r.id OR s.review_response_version IS DISTINCT FROM a.version OR s.review_response_revision IS DISTINCT FROM context_revision)
   THEN RETURN '{"status":"unavailable","reason":"turn_context_changed"}'; END IF;
  UPDATE origen_live_memory_sessions SET review_response_sequence=s.turn_sequence,review_response_request=r.id,review_response_version=a.version,review_response_revision=context_revision WHERE id=s.id;
 END IF;
 RETURN jsonb_build_object('status','retrieved','guard',jsonb_build_object('source',current_source,'revision',context_revision,'mode',mode),
  'response',jsonb_build_object('source',current_source,'availability',connection->>'availability','historyReason',connection->>'reason',
   'approvedQuestion',connection->'request'->>'approvedQuestion','language',r.language,'kind',r.kind,
   'author',connection->'response'->'author','organization',connection->'response'->'organization','createdAt',a.created_at,'updatedAt',a.updated_at,
   'guidance',a.guidance,'suggestedAction',a.suggested_action,'resourceUrl',a.resource_url,'followUpOn',a.follow_up_on,'untrusted',true));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_review_response_context"}';
END $$;
-- Operator-only restore invalidation. A fresh random generation also fences
-- repeated restores of the same backup and already-historical receipts.
CREATE FUNCTION origen_review_response_context_after_restore() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 UPDATE origen_review_request_responses SET context_generation=gen_random_uuid()
$$;
DO $$ BEGIN
 EXECUTE format('ALTER FUNCTION origen_review_response_context_command(jsonb) SET search_path=%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION origen_review_response_context_after_restore() SET search_path=%I,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION origen_review_response_context_command(jsonb),origen_review_response_context_after_restore() FROM PUBLIC;

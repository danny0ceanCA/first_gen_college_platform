-- Short-lived browser-observed consent, scoped to one student/call. No raw
-- audio, conversation transcript, or extra copy of the readback is retained.
CREATE TABLE origen_review_voice_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, student_id text NOT NULL,
 permission_revision integer NOT NULL, sequence integer NOT NULL DEFAULT 0, turn_id text NOT NULL DEFAULT '',
 transcript_hash text NOT NULL DEFAULT '', language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','es')),
 request_id uuid, preview_id uuid, preview_digest text, proposal_sequence integer,
 readback_hash text, presented_at timestamptz, approved_sequence integer,
 closed boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX review_voice_owner ON origen_review_voice_sessions(account_id,expires_at);
ALTER TABLE origen_review_voice_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_review_voice_sessions FROM PUBLIC;
ALTER TABLE origen_review_request_publications ADD COLUMN approval_channel text NOT NULL DEFAULT 'notebook' CHECK(approval_channel IN ('notebook','voice')),
 ADD COLUMN readback_hash text, ADD COLUMN readback_at timestamptz;
ALTER TABLE origen_review_request_publications ADD CHECK(approval_channel='notebook' AND readback_hash IS NULL AND readback_at IS NULL OR approval_channel='voice' AND readback_hash IS NOT NULL AND readback_hash ~ '^[a-f0-9]{64}$' AND readback_at IS NOT NULL);

CREATE FUNCTION origen_review_voice_command(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); action text:=input->>'action'; owner uuid; permission integer;
 s origen_review_voice_sessions%ROWTYPE; proof text; seq integer; result jsonb; card jsonb; rid uuid;
BEGIN
 IF actor IS NULL OR coalesce(current_setting('origen.purpose',true),'')<>'account' THEN RETURN '{"error":"review_voice_denied"}'; END IF;
 IF action IS NULL OR action NOT IN ('open','state','turn','prepare','bind','present','confirm','close') THEN RETURN '{"error":"invalid_review_voice"}'; END IF;
 INSERT INTO origen_subject_locks(subject_hash) VALUES(encode(sha256(convert_to(actor,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM origen_subject_locks WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR UPDATE;
 IF EXISTS(SELECT 1 FROM origen_closed_accounts WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex')) THEN RETURN '{"error":"review_voice_denied"}'; END IF;
 SELECT id INTO owner FROM origen_accounts WHERE auth0_subject=actor FOR NO KEY UPDATE;
 IF owner IS NULL THEN RETURN '{"error":"review_voice_denied"}'; END IF;
 IF action='open' THEN
  IF input->'enabled' IS DISTINCT FROM 'true'::jsonb OR NOT origen_coordinator_student_ready(owner,input->>'studentId') THEN RETURN '{"error":"review_voice_denied"}'; END IF;
  DELETE FROM origen_review_voice_sessions WHERE account_id=owner AND (closed OR expires_at<=clock_timestamp());
  IF (SELECT count(*) FROM origen_review_voice_sessions WHERE account_id=owner)>=20 THEN RETURN '{"error":"review_voice_limit"}'; END IF;
  SELECT revision INTO permission FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex');
  INSERT INTO origen_review_voice_sessions(account_id,student_id,permission_revision) VALUES(owner,input->>'studentId',permission) RETURNING * INTO s;
  RETURN jsonb_build_object('id',s.id,'expiresAt',s.expires_at);
 END IF;
 SELECT * INTO s FROM origen_review_voice_sessions WHERE id=(input->>'sessionId')::uuid AND account_id=owner FOR UPDATE;
 IF s.id IS NULL THEN RETURN '{"error":"review_voice_unavailable"}'; END IF;
 IF action='close' THEN UPDATE origen_review_voice_sessions SET closed=true,presented_at=NULL,readback_hash=NULL WHERE id=s.id;RETURN '{"status":"closed"}'; END IF;
 IF input->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"error":"review_voice_paused"}'; END IF;
 IF s.closed OR s.expires_at<=clock_timestamp() THEN RETURN '{"error":"review_voice_session_changed"}'; END IF;
 SELECT revision INTO permission FROM origen_eligibility WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') FOR SHARE;
 IF permission IS DISTINCT FROM s.permission_revision OR NOT origen_coordinator_student_ready(owner,s.student_id) THEN RETURN '{"error":"review_voice_denied"}'; END IF;
 IF action='state' THEN RETURN to_jsonb(s); END IF;
 IF jsonb_typeof(input->'sequence') IS DISTINCT FROM 'number' OR input->>'sequence' !~ '^[1-9][0-9]*$'
  OR jsonb_typeof(input->'transcript') IS DISTINCT FROM 'string' OR length(input->>'transcript')>8000
  OR jsonb_typeof(input->'turnId') IS DISTINCT FROM 'string' OR length(input->>'turnId') NOT BETWEEN 1 AND 128 THEN RETURN '{"error":"invalid_review_voice"}'; END IF;
 seq:=(input->>'sequence')::integer;proof:=encode(sha256(convert_to(input->>'transcript','UTF8')),'hex');
 IF action='turn' THEN
  IF seq<s.sequence OR seq=s.sequence AND (s.turn_id<>input->>'turnId' OR s.transcript_hash<>encode(sha256(convert_to('','UTF8')),'hex') AND s.transcript_hash<>proof) THEN RETURN '{"error":"review_voice_turn_changed"}'; END IF;
  UPDATE origen_review_voice_sessions SET sequence=seq,turn_id=input->>'turnId',transcript_hash=proof,language=input->>'language',
   presented_at=CASE WHEN (seq=s.sequence OR seq=s.proposal_sequence+1) AND (input->>'transcript'='' OR input->'accepted'='true'::jsonb) THEN presented_at ELSE NULL END WHERE id=s.id;
  RETURN '{"status":"registered"}';
 END IF;
 IF seq<>s.sequence OR s.turn_id<>input->>'turnId' OR s.transcript_hash<>proof OR length(btrim(input->>'transcript'))=0 THEN RETURN '{"error":"review_voice_turn_changed"}'; END IF;
 IF action='prepare' THEN
  IF input->'intent' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"status":"not_requested"}'; END IF;
  IF s.proposal_sequence=seq THEN RETURN '{"error":"review_voice_proposal_changed"}'; END IF;
  result:=origen_review_request_command(jsonb_build_object('action','create','studentId',s.student_id,'enabled',true,
   'requestKey',input->>'requestKey','connectionId',input->>'connectionId','origin','voice','kind',input->>'kind','language',s.language,
   'originalQuestion',input->>'transcript','proposedClarification',input->>'question','entries',input->'entries'));
  IF result ? 'error' THEN RETURN result; END IF;
  rid:=(result->'request'->>'id')::uuid;
  -- A delayed retry of a prior creation never creates another request.
  IF result->'request'->>'status'<>'draft' THEN RETURN '{"error":"review_voice_proposal_changed"}'; END IF;
  card:=origen_review_request_command(jsonb_build_object('action','preview','studentId',s.student_id,'enabled',true,'id',rid,'version',1,'wording','clarification'));
  IF card ? 'error' THEN RETURN card; END IF;
  UPDATE origen_review_voice_sessions SET request_id=rid,preview_id=(card->'preview'->>'id')::uuid,preview_digest=card->'preview'->>'digest',
   proposal_sequence=seq,readback_hash=NULL,presented_at=NULL,approved_sequence=NULL WHERE id=s.id;
  RETURN jsonb_build_object('status','readback_required','request',result->'request','preview',card->'preview');
 END IF;
 IF action='bind' THEN
  IF s.proposal_sequence<>seq OR s.preview_id IS DISTINCT FROM (input->>'previewId')::uuid OR input->>'readbackHash' !~ '^[a-f0-9]{64}$' THEN RETURN '{"error":"review_voice_proposal_changed"}'; END IF;
  UPDATE origen_review_voice_sessions SET readback_hash=input->>'readbackHash',presented_at=NULL WHERE id=s.id;
  RETURN '{"status":"bound"}';
 END IF;
 IF action='present' THEN
  UPDATE origen_review_voice_sessions SET presented_at=CASE WHEN s.proposal_sequence=seq AND s.readback_hash=input->>'presentationHash'
   AND EXISTS(SELECT 1 FROM origen_review_request_previews p WHERE p.id=s.preview_id AND p.digest=s.preview_digest AND p.expires_at>clock_timestamp()) THEN clock_timestamp() ELSE NULL END WHERE id=s.id RETURNING * INTO s;
  RETURN jsonb_build_object('status',CASE WHEN s.presented_at IS NULL THEN 'not_presented' ELSE 'presented' END);
 END IF;
 IF action='confirm' THEN
  IF s.proposal_sequence IS NULL OR seq<>s.proposal_sequence+1 OR input->'accepted' IS DISTINCT FROM 'true'::jsonb THEN RETURN '{"status":"approval_required"}'; END IF;
  IF s.approved_sequence=seq THEN
   RETURN origen_review_request_command(jsonb_build_object('action','get','studentId',s.student_id,'id',s.request_id));
  END IF;
  IF s.presented_at IS NULL OR s.presented_at<clock_timestamp()-interval '2 minutes' OR s.readback_hash IS NULL THEN RETURN '{"status":"approval_required"}'; END IF;
  result:=origen_review_request_command(jsonb_build_object('action','submit','enabled',true,'studentId',s.student_id,'id',s.request_id,'version',1,'previewId',s.preview_id,'digest',s.preview_digest,'confirmed',true));
  IF result ? 'error' THEN RETURN result; END IF;
  UPDATE origen_review_request_publications SET approval_channel='voice',readback_hash=s.readback_hash,readback_at=s.presented_at WHERE request_id=s.request_id;
  UPDATE origen_review_voice_sessions SET approved_sequence=seq WHERE id=s.id;
  RETURN origen_review_request_command(jsonb_build_object('action','get','studentId',s.student_id,'id',s.request_id));
 END IF;
 RETURN '{"error":"invalid_review_voice"}';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN '{"error":"invalid_review_voice"}';
END $$;

DO $$ DECLARE d text; anchor text:='''wording'',p.wording,'; BEGIN
 d:=pg_get_functiondef('origen_review_request_view(uuid)'::regprocedure);
 IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'unexpected_review_receipt_anchor'; END IF;
 EXECUTE replace(d,anchor,anchor||'''approvalMethod'',p.approval_channel,''readbackAt'',p.readback_at,');
 d:=pg_get_functiondef('origen_review_requests_expire()'::regprocedure);
 IF strpos(d,'BEGIN')=0 THEN RAISE EXCEPTION 'unexpected_review_expiry_anchor'; END IF;
 EXECUTE replace(d,'BEGIN','BEGIN DELETE FROM origen_review_voice_sessions WHERE closed OR expires_at<=clock_timestamp();');
 EXECUTE format('ALTER FUNCTION origen_review_voice_command(jsonb) SET search_path=%I,pg_temp',current_schema());
 REVOKE ALL ON FUNCTION origen_review_voice_command(jsonb) FROM PUBLIC;
END $$;

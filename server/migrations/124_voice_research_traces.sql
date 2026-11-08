-- Research diagnostics deliberately outlive the ten-minute queue. Account
-- deletion remains authoritative. No profiles, raw conversations or private
-- provider reasoning are archived here.
CREATE TABLE origen_voice_research_traces (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 mode text NOT NULL,
 language text NOT NULL,
 status text NOT NULL,
 queued_at timestamptz NOT NULL,
 started_at timestamptz,
 finished_at timestamptz,
 request_snapshot jsonb,
 result_snapshot jsonb,
 snapshot_omitted boolean NOT NULL DEFAULT false,
 diagnostics_dropped integer NOT NULL DEFAULT 0,
 UNIQUE(id,account_id,session_id)
);
CREATE INDEX voice_research_trace_call ON origen_voice_research_traces(account_id,session_id,queued_at,id);
CREATE TABLE origen_voice_research_trace_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 stage text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(octet_length(data::text)<=4096),
 FOREIGN KEY(job_id,account_id,session_id) REFERENCES origen_voice_research_traces(id,account_id,session_id) ON DELETE CASCADE
);
CREATE INDEX voice_research_trace_timeline ON origen_voice_research_trace_events(account_id,session_id,received_at,id);
CREATE INDEX voice_research_trace_job ON origen_voice_research_trace_events(job_id,observed_at,id);
ALTER TABLE origen_voice_research_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE origen_voice_research_trace_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_trace_access ON origen_voice_research_traces
 USING(CASE WHEN current_user='origen_research_worker' THEN true ELSE account_id=origen_current_account_id() END)
 WITH CHECK(CASE WHEN current_user='origen_research_worker' THEN true ELSE account_id=origen_current_account_id() END);
CREATE POLICY research_trace_event_access ON origen_voice_research_trace_events
 USING(CASE WHEN current_user='origen_research_worker' THEN true ELSE account_id=origen_current_account_id() END)
 WITH CHECK(CASE WHEN current_user='origen_research_worker' THEN true ELSE account_id=origen_current_account_id() END);

CREATE FUNCTION origen_archive_research_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j origen_voice_research_jobs; stage_name text; request_data jsonb; result_data jsonb; omitted boolean:=false;
BEGIN
 IF TG_OP='DELETE' THEN j:=OLD; ELSE j:=NEW; END IF;
 IF TG_OP='DELETE' AND j.expires_at<=now() AND j.status IN ('queued','running') THEN j.status:='expired';j.finished_at:=clock_timestamp();END IF;
 -- Account-private research evidence, separate from metadata-only service logs.
 -- These are the server-shaped public query and parsed application result,
 -- never the original student profile, conversation or provider reasoning.
 SELECT jsonb_object_agg(key,value) INTO request_data FROM jsonb_each(j.input) WHERE key IN ('question','institution','mode','language','reusedEvidence','lookupInstitutions');
 SELECT jsonb_object_agg(key,value) INTO result_data FROM jsonb_each(coalesce(j.result,'{}'::jsonb)) WHERE key IN ('text','sources','voiceBrief','checkedAt','evidenceVersion','researchPending','researchDiagnostics','retainedFindingCount');
 IF octet_length(request_data::text)>524288 THEN request_data:=NULL;omitted:=true;END IF;
 IF octet_length(result_data::text)>524288 THEN result_data:=NULL;omitted:=true;END IF;
 INSERT INTO origen_voice_research_traces(id,account_id,session_id,mode,language,status,queued_at,started_at,finished_at,request_snapshot,result_snapshot,snapshot_omitted)
 VALUES(j.id,j.account_id,j.session_id,coalesce(j.input->>'mode','unknown'),coalesce(j.input->>'language','unknown'),j.status,j.created_at,j.started_at,j.finished_at,request_data,result_data,omitted)
 ON CONFLICT(id) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,finished_at=excluded.finished_at,
 request_snapshot=CASE WHEN excluded.snapshot_omitted THEN NULL ELSE coalesce(excluded.request_snapshot,origen_voice_research_traces.request_snapshot) END,result_snapshot=CASE WHEN excluded.snapshot_omitted THEN NULL ELSE coalesce(excluded.result_snapshot,origen_voice_research_traces.result_snapshot) END,snapshot_omitted=origen_voice_research_traces.snapshot_omitted OR excluded.snapshot_omitted;
 IF TG_OP='INSERT' THEN stage_name:='queued';
 ELSIF TG_OP='DELETE' THEN stage_name:='queue_cleaned';
 ELSIF OLD.status IS DISTINCT FROM NEW.status THEN stage_name:=NEW.status;
 ELSE RETURN NULL; END IF;
 INSERT INTO origen_voice_research_trace_events(job_id,account_id,session_id,stage,data)
 VALUES(j.id,j.account_id,j.session_id,stage_name,jsonb_build_object('evidenceKind','server_observed','component','queue','status',j.status));
 RETURN NULL;
EXCEPTION WHEN foreign_key_violation THEN
 -- Cascading account deletion removes the archive as well as its queue.
 -- Never recreate a record belonging to an account being deleted.
 IF TG_OP='DELETE' THEN RETURN NULL; ELSE RAISE; END IF;
END $$;
CREATE TRIGGER archive_research_state AFTER INSERT OR UPDATE OR DELETE ON origen_voice_research_jobs FOR EACH ROW EXECUTE FUNCTION origen_archive_research_state();
-- Backfill only jobs still present, using the same bounded archive projection.
UPDATE origen_voice_research_jobs SET status=status;
REVOKE ALL ON origen_voice_research_traces,origen_voice_research_trace_events FROM PUBLIC;
REVOKE ALL ON FUNCTION origen_archive_research_state() FROM PUBLIC;

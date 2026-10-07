-- Operational metadata only. Collection remains disabled until explicitly enabled.
CREATE TABLE origen_account_identities (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 issuer text NOT NULL,
 subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (issuer,subject),
 UNIQUE (account_id,issuer)
);
CREATE TABLE origen_representative_identities (
 auth0_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 issuer text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (issuer,auth0_subject)
);
CREATE TABLE origen_ai_configurations (
 id text PRIMARY KEY,
 model_id text NOT NULL,
 operation text NOT NULL,
 prompt_hash text NOT NULL,
 tool_schema_hash text NOT NULL,
 policy_version text NOT NULL,
 application_revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE origen_guidance_sessions (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 actor_role text NOT NULL CHECK (actor_role IN ('parent','student','unknown')),
 initial_language text NOT NULL CHECK (initial_language IN ('en','es')),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 end_reason text CHECK (end_reason IS NULL OR end_reason IN ('completed','disconnected','failed','abandoned')),
 last_activity_at timestamptz NOT NULL DEFAULT now(),
 next_ordinal integer NOT NULL DEFAULT 0 CHECK (next_ordinal >= 0),
 PRIMARY KEY (account_id,id)
);
CREATE TABLE origen_guidance_segments (
 account_id uuid NOT NULL,
 session_id uuid NOT NULL,
 id uuid NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal >= 0),
 topic text NOT NULL CHECK (topic IN ('profile','finance','admissions','planning','loans')),
 target_kind text NOT NULL CHECK (target_kind IN ('unresolved','family','student')),
 student_id text,
 pending_student_id text,
 configuration_id text NOT NULL REFERENCES origen_ai_configurations(id),
 configuration_state text NOT NULL DEFAULT 'prepared' CHECK (configuration_state IN ('prepared','applied')),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 PRIMARY KEY (account_id,id),
 UNIQUE (account_id,session_id,ordinal),
 UNIQUE (account_id,session_id,id),
 FOREIGN KEY (account_id,session_id) REFERENCES origen_guidance_sessions(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 CHECK ((target_kind='student' AND student_id IS NOT NULL) OR (target_kind IN ('family','unresolved') AND student_id IS NULL))
);
CREATE TABLE origen_guidance_events (
 account_id uuid NOT NULL,
 session_id uuid NOT NULL,
 segment_id uuid,
 id uuid NOT NULL,
 producer text NOT NULL CHECK (producer IN ('server','browser')),
 name text NOT NULL,
 sequence integer,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
 PRIMARY KEY (account_id,id),
 FOREIGN KEY (account_id,session_id) REFERENCES origen_guidance_sessions(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,session_id,segment_id) REFERENCES origen_guidance_segments(account_id,session_id,id) ON DELETE CASCADE,
 UNIQUE (account_id,session_id,producer,sequence)
);
CREATE TABLE origen_ai_executions (
 account_id uuid NOT NULL,
 id uuid NOT NULL,
 session_id uuid NOT NULL,
 segment_id uuid NOT NULL,
 configuration_id text NOT NULL REFERENCES origen_ai_configurations(id),
 operation text NOT NULL,
 status text NOT NULL CHECK (status IN ('started','completed','failed','abandoned')),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 duration_ms integer,
 upstream_request_id text,
 error_code text,
 usage jsonb,
 resolved_model text,
 PRIMARY KEY (account_id,id),
 FOREIGN KEY (account_id,session_id) REFERENCES origen_guidance_sessions(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,session_id,segment_id) REFERENCES origen_guidance_segments(account_id,session_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_tool_calls (
 account_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 tool_name text NOT NULL,
 tool_version text NOT NULL,
 status text NOT NULL CHECK (status IN ('completed','failed','abandoned')),
 source_count integer NOT NULL CHECK (source_count >= 0),
 sources jsonb NOT NULL CHECK (jsonb_typeof(sources)='array'),
 PRIMARY KEY (account_id,execution_id),
 FOREIGN KEY (account_id,execution_id) REFERENCES origen_ai_executions(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_summary_segments (
 account_id uuid NOT NULL,
 summary_id text NOT NULL,
 segment_id uuid NOT NULL,
 language text NOT NULL CHECK (language IN ('en','es')),
 configuration_id text REFERENCES origen_ai_configurations(id),
 PRIMARY KEY (account_id,summary_id,segment_id),
 FOREIGN KEY (account_id,summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,segment_id) REFERENCES origen_guidance_segments(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_guidance_sessions_retention ON origen_guidance_sessions(started_at);
CREATE INDEX origen_guidance_events_session ON origen_guidance_events(account_id,session_id,received_at);
CREATE INDEX origen_ai_executions_session ON origen_ai_executions(account_id,session_id,started_at);
CREATE INDEX origen_guidance_segments_student ON origen_guidance_segments(account_id,student_id);
-- Deferred onboarding summaries have no student row until profile review/save.
CREATE TABLE origen_guidance_summary_intents (
 account_id uuid NOT NULL,
 summary_id text NOT NULL,
 session_id uuid NOT NULL,
 segment_ids jsonb NOT NULL CHECK (jsonb_typeof(segment_ids)='array'),
 student_id text NOT NULL,
 language text NOT NULL CHECK (language IN ('en','es')),
 configuration_id text NOT NULL REFERENCES origen_ai_configurations(id),
 PRIMARY KEY (account_id,summary_id),
 FOREIGN KEY (account_id,session_id) REFERENCES origen_guidance_sessions(account_id,id) ON DELETE CASCADE
);

-- Private operational history, never an institution/research data feed.
CREATE TABLE origen_profile_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 student_id text NOT NULL, field text NOT NULL,
 previous_value text, reported_value text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('user-reported','imported','linked-account')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_profile_observations_target ON origen_profile_observations(account_id,student_id,recorded_at);
CREATE INDEX origen_profile_observations_retention ON origen_profile_observations(recorded_at);
CREATE TABLE origen_plan_revisions (
 account_id uuid NOT NULL, plan_id uuid NOT NULL, version integer NOT NULL,
 snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,plan_id,version),
 FOREIGN KEY(account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE
);
CREATE TABLE origen_step_transitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
 plan_id uuid NOT NULL, version integer NOT NULL, step_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('added','removed','status-changed')),
 previous_status text, reported_status text,
 FOREIGN KEY(account_id,plan_id,version) REFERENCES origen_plan_revisions(account_id,plan_id,version) ON DELETE CASCADE
);
CREATE INDEX origen_plan_revisions_retention ON origen_plan_revisions(recorded_at);
CREATE TABLE origen_measurement_definitions (
 id text NOT NULL, version integer NOT NULL, definition jsonb NOT NULL,
 PRIMARY KEY(id,version)
);
INSERT INTO origen_measurement_definitions VALUES ('guidance-helpfulness',1,
 '{"purpose":"optional-service-feedback","validatedResearchInstrument":false,"en":"Was this guidance helpful?","es":"¿Te sirvió esta orientación?","choices":["helpful","partly","not-yet"]}');
CREATE TABLE origen_progress_reports (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL, student_id text, kind text NOT NULL CHECK(kind IN ('feedback','milestone')),
 definition_id text, definition_version integer,
 response_status text NOT NULL CHECK(response_status IN ('answered','declined','unknown')),
 value text, language text NOT NULL CHECK(language IN ('en','es')),
 occurred_date date, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY(definition_id,definition_version) REFERENCES origen_measurement_definitions(id,version),
 CHECK ((kind='feedback' AND definition_id IS NOT NULL AND definition_version IS NOT NULL AND occurred_date IS NULL AND
  ((response_status='answered' AND value IS NOT NULL AND value IN ('helpful','partly','not-yet')) OR (response_status IN ('declined','unknown') AND value IS NULL))) OR
  (kind='milestone' AND definition_id IS NULL AND definition_version IS NULL AND response_status='answered' AND value IS NOT NULL AND value IN ('counselor-contacted','application-started','application-submitted','aid-offer-reviewed')))
);

CREATE INDEX origen_progress_reports_retention ON origen_progress_reports(recorded_at);

-- Family summaries have no student FK to carry account deletion through.
ALTER TABLE origen_conversation_summaries ADD CONSTRAINT origen_history_account_fk FOREIGN KEY (account_id) REFERENCES origen_accounts(id) ON DELETE CASCADE;

CREATE TABLE origen_plans (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 student_id text,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 goal text NOT NULL DEFAULT '' CHECK (length(goal) <= 4000),
 category text NOT NULL CHECK (category IN ('education','courses','transfer','degree','career','financial','other')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id,id),
 FOREIGN KEY (account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_plans_target ON origen_plans(account_id,student_id,status,updated_at DESC);

CREATE TABLE origen_plan_steps (
 account_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
 position integer NOT NULL CHECK (position >= 0),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 action text NOT NULL DEFAULT '' CHECK (length(action) <= 4000),
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
 status text NOT NULL DEFAULT 'not-started' CHECK (status IN ('not-started','in-progress','complete')),
 due_date date,
 PRIMARY KEY (account_id,plan_id,id),
 UNIQUE (account_id,plan_id,position),
 FOREIGN KEY (account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE
);

-- These are references, not a claim that a requirement was verified or satisfied.
CREATE TABLE origen_plan_sources (
 account_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 step_id text NOT NULL,
 position integer NOT NULL CHECK (position >= 0),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
 url text NOT NULL CHECK (length(url) BETWEEN 1 AND 2000),
 PRIMARY KEY (account_id,plan_id,step_id,position),
 FOREIGN KEY (account_id,plan_id,step_id) REFERENCES origen_plan_steps(account_id,plan_id,id) ON DELETE CASCADE
);

CREATE TABLE origen_plan_conversations (
 account_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 summary_id text NOT NULL,
 PRIMARY KEY (account_id,plan_id,summary_id),
 FOREIGN KEY (account_id,plan_id) REFERENCES origen_plans(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (account_id,summary_id) REFERENCES origen_conversation_summaries(account_id,id) ON DELETE CASCADE
);

CREATE TABLE origen_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth0_subject text NOT NULL UNIQUE CHECK (length(auth0_subject) BETWEEN 1 AND 255),
 first_name text NOT NULL DEFAULT '' CHECK (length(first_name) <= 100),
 email text NOT NULL DEFAULT '' CHECK (length(email) <= 320),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- IDs are text to preserve existing browser/native profile identifiers on import.
CREATE TABLE origen_students (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 stage text NOT NULL DEFAULT '' CHECK (stage IN ('', '9th grade', '10th grade', '11th grade', '12th grade', 'Community college', 'College')),
 interest text NOT NULL DEFAULT '' CHECK (length(interest) <= 2000),
 gpa text NOT NULL DEFAULT '' CHECK (length(gpa) <= 30),
 color text NOT NULL DEFAULT 'peach' CHECK (length(color) <= 40),
 institutions text NOT NULL DEFAULT '' CHECK (length(institutions) <= 2000),
 entry_term text NOT NULL DEFAULT '' CHECK (length(entry_term) <= 2000),
 school text NOT NULL DEFAULT '' CHECK (length(school) <= 2000),
 activities text NOT NULL DEFAULT '' CHECK (length(activities) <= 2000),
 goals text NOT NULL DEFAULT '' CHECK (length(goals) <= 2000),
 needs text NOT NULL DEFAULT '' CHECK (length(needs) <= 2000),
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, id)
);

CREATE TABLE origen_conversation_summaries (
 account_id uuid NOT NULL,
 id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
 student_id text NOT NULL,
 mode text NOT NULL CHECK (mode IN ('profile', 'finance', 'admissions')),
 summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 12000),
 sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
 conversation_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, id),
 FOREIGN KEY (account_id, student_id) REFERENCES origen_students(account_id, id) ON DELETE CASCADE
);

CREATE INDEX origen_conversation_student_date ON origen_conversation_summaries (account_id, student_id, conversation_at DESC, id);

-- Institution representatives are separate from family accounts and student links.
CREATE TABLE origen_institution_representatives (
 auth0_subject text PRIMARY KEY CHECK (length(auth0_subject) BETWEEN 1 AND 255),
 first_name text NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 100),
 work_email text NOT NULL CHECK (length(work_email) BETWEEN 3 AND 320),
 job_role text NOT NULL CHECK (length(btrim(job_role)) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE origen_institutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE,
 verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','changes-requested','published')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 draft jsonb NOT NULL CHECK (jsonb_typeof(draft)='object'),
 published jsonb,
 published_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz
);
CREATE TABLE origen_institution_members (
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 auth0_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','editor')),
 PRIMARY KEY (institution_id,auth0_subject)
);
CREATE TABLE origen_institution_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 reviewer_subject text NOT NULL,
 action text NOT NULL CHECK (action IN ('verify','publish','request-changes')),
 note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_institution_members_subject ON origen_institution_members(auth0_subject,institution_id);
CREATE INDEX origen_institutions_review_queue ON origen_institutions(status,updated_at);

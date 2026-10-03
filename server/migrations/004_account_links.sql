-- Each participant keeps a private local profile row for notes and history.
-- Academic fields are read/written through the canonical profile while linked.
CREATE TABLE origen_student_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL,
 owner_student_id text NOT NULL,
 member_account_id uuid NOT NULL,
 member_student_id text NOT NULL,
 member_role text NOT NULL CHECK (member_role IN ('parent','student')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (owner_account_id,owner_student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 FOREIGN KEY (member_account_id,member_student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE,
 CHECK (owner_account_id <> member_account_id),
 UNIQUE (owner_account_id,owner_student_id,member_account_id),
 UNIQUE (member_account_id,member_student_id)
);
CREATE TABLE origen_family_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL,
 student_id text NOT NULL,
 target_role text NOT NULL CHECK (target_role IN ('parent','student')),
 token_hash text NOT NULL UNIQUE CHECK (length(token_hash)=64),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 consumed_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (owner_account_id,student_id) REFERENCES origen_students(account_id,id) ON DELETE CASCADE
);
CREATE INDEX origen_family_invites_owner ON origen_family_invites(owner_account_id,created_at DESC);
CREATE INDEX origen_student_links_owner ON origen_student_links(owner_account_id,owner_student_id);

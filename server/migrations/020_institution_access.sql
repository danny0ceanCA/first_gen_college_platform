ALTER TABLE origen_institutions ADD COLUMN parent_institution_id uuid REFERENCES origen_institutions(id) ON DELETE RESTRICT;
ALTER TABLE origen_institutions ADD COLUMN unit_type text NOT NULL DEFAULT 'institution' CHECK (unit_type IN ('institution','department','program'));
ALTER TABLE origen_institutions ADD COLUMN parent_approval text NOT NULL DEFAULT 'approved' CHECK (parent_approval IN ('pending','approved','rejected'));
ALTER TABLE origen_institutions ADD CONSTRAINT origen_institution_parent_shape CHECK ((unit_type='institution' AND parent_institution_id IS NULL AND parent_approval='approved') OR (unit_type IN ('department','program') AND parent_institution_id IS NOT NULL AND parent_institution_id<>id));
ALTER TABLE origen_institution_members DROP CONSTRAINT origen_institution_members_role_check;
ALTER TABLE origen_institution_members ADD CONSTRAINT origen_institution_members_role_check CHECK (role IN ('owner','editor','outreach','analyst'));
CREATE INDEX origen_institution_units ON origen_institutions(parent_institution_id,parent_approval);
CREATE TABLE origen_institution_registration_requests (
 auth0_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 payload_hash text NOT NULL,
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 PRIMARY KEY(auth0_subject,request_id)
);
CREATE TABLE origen_institution_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 recipient_email text NOT NULL,
 role text NOT NULL CHECK (role IN ('editor','outreach','analyst')),
 created_by text NOT NULL,
 expires_at timestamptz NOT NULL,
 accepted_by text,
 accepted_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_institution_invites_workspace ON origen_institution_invites(institution_id,created_at);
CREATE TABLE origen_institution_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 actor_subject text NOT NULL,
 action text NOT NULL,
 target_subject text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX origen_institution_access_history ON origen_institution_access_events(institution_id,created_at);
CREATE TABLE origen_institution_affiliation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth0_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 parent_institution_id uuid REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 parent_name text NOT NULL,
 parent_website text NOT NULL,
 unit_name text NOT NULL,
 unit_type text NOT NULL CHECK (unit_type IN ('institution','department','program')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','changes-requested','resolved')),
 review_note text NOT NULL DEFAULT '',
 reviewer_subject text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(auth0_subject,request_id)
);

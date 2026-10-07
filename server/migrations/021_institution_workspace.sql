ALTER TABLE origen_institutions ADD COLUMN archived_at timestamptz;
ALTER TABLE origen_institutions ADD COLUMN draft_saved_at timestamptz;
UPDATE origen_institutions SET draft_saved_at=updated_at;
ALTER TABLE origen_institutions ALTER COLUMN draft_saved_at SET DEFAULT now();
CREATE TABLE origen_institution_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 auth0_subject text NOT NULL REFERENCES origen_institution_representatives(auth0_subject) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('verify','publish','request-changes','parent-approved','parent-rejected','archive','unpublish','restore')),
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX origen_institution_notifications_recipient ON origen_institution_notifications(auth0_subject,created_at);

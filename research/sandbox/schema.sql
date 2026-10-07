-- SYNTHETIC LAB ONLY. Not a server migration and not a production schema.
CREATE TABLE lab_study_versions (
 study_id text NOT NULL, version integer NOT NULL, protocol jsonb NOT NULL,
 protocol_hash text NOT NULL, notice_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('active-simulation','suspended')),
 PRIMARY KEY(study_id,version)
);
CREATE TABLE lab_recipients (
 study_id text NOT NULL, version integer NOT NULL, recipient_id text NOT NULL,
 purpose text NOT NULL CHECK(purpose='aggregate-research'), revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(study_id,version,recipient_id),
 FOREIGN KEY(study_id,version) REFERENCES lab_study_versions(study_id,version) ON DELETE CASCADE
);
CREATE TABLE lab_participants (
 study_id text NOT NULL, version integer NOT NULL, participant_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('consented','declined','withdrawn')),
 PRIMARY KEY(study_id,version,participant_id),
 FOREIGN KEY(study_id,version) REFERENCES lab_study_versions(study_id,version) ON DELETE CASCADE
);
-- Restricted mapping is never included in a recipient dataset.
CREATE TABLE lab_identity_map (
 study_id text NOT NULL, version integer NOT NULL, participant_id uuid NOT NULL, synthetic_subject text NOT NULL,
 PRIMARY KEY(study_id,version,participant_id), UNIQUE(study_id,version,synthetic_subject),
 FOREIGN KEY(study_id,version,participant_id) REFERENCES lab_participants(study_id,version,participant_id) ON DELETE CASCADE
);
CREATE TABLE lab_permissions (
 id uuid PRIMARY KEY, study_id text NOT NULL, version integer NOT NULL, participant_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('consent','decline','withdraw')),
 purpose text NOT NULL CHECK(purpose='aggregate-research'), notice_hash text NOT NULL,
 language text NOT NULL CHECK(language IN ('en','es')), sequence integer NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(study_id,version,participant_id,sequence),
 FOREIGN KEY(study_id,version,participant_id) REFERENCES lab_participants(study_id,version,participant_id) ON DELETE CASCADE
);
CREATE TABLE lab_measurements (
 study_id text NOT NULL, version integer NOT NULL, participant_id uuid NOT NULL,
 response text NOT NULL CHECK(response IN ('helpful','partly','not-yet','unknown')), month text NOT NULL,
 PRIMARY KEY(study_id,version,participant_id),
 FOREIGN KEY(study_id,version,participant_id) REFERENCES lab_participants(study_id,version,participant_id) ON DELETE CASCADE
);
CREATE TABLE lab_manifests (
 id uuid PRIMARY KEY, study_id text NOT NULL, version integer NOT NULL, recipient_id text NOT NULL,
 payload jsonb NOT NULL, checksum text NOT NULL, status text NOT NULL CHECK(status IN ('released-simulation','invalidated','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(study_id,version,recipient_id) REFERENCES lab_recipients(study_id,version,recipient_id) ON DELETE CASCADE
);
CREATE TABLE lab_manifest_members (
 manifest_id uuid NOT NULL REFERENCES lab_manifests(id) ON DELETE CASCADE,
 study_id text NOT NULL, version integer NOT NULL, participant_id uuid NOT NULL,
 PRIMARY KEY(manifest_id,participant_id),
 FOREIGN KEY(study_id,version,participant_id) REFERENCES lab_participants(study_id,version,participant_id) ON DELETE CASCADE
);
CREATE TABLE lab_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), study_id text NOT NULL, version integer NOT NULL,
 actor text NOT NULL, action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('allowed','denied')),
 reason text, manifest_id uuid, recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE origen_institution_inquiries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE, receipt_hash text NOT NULL UNIQUE, payload_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('inquiry','rsvp')), event_id uuid, event_title text,
 name text NOT NULL, email text NOT NULL DEFAULT '', language text NOT NULL CHECK(language IN ('en','es')),
 topic text NOT NULL, message text NOT NULL, channel text NOT NULL CHECK(channel IN ('in-app','email')),
 reply_consent boolean NOT NULL, future_consent boolean NOT NULL DEFAULT false,
 notice_version text NOT NULL DEFAULT 'adult-contact-v1', adult_attested boolean NOT NULL,
 state text NOT NULL DEFAULT 'new' CHECK(state IN ('new','assigned','awaiting-response','resolved','withdrawn')),
 assignee text, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, withdrawn_at timestamptz,
 transfer_id uuid REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 transfer_requested_by text
);
CREATE INDEX origen_inquiry_inbox ON origen_institution_inquiries(institution_id,created_at DESC);
CREATE INDEX origen_inquiry_retention ON origen_institution_inquiries(expires_at);
CREATE TABLE origen_institution_inquiry_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES origen_institution_inquiries(id) ON DELETE CASCADE,
 request_key uuid NOT NULL UNIQUE, body text NOT NULL, kind text NOT NULL CHECK(kind IN ('note','reply','visitor')),
 actor text, created_at timestamptz NOT NULL DEFAULT now(),
 delivery text NOT NULL DEFAULT 'in-app' CHECK(delivery IN ('in-app','queued','accepted','failed','unknown','suppressed')),
 provider_id text, attempts integer NOT NULL DEFAULT 0, attempted_at timestamptz
);
CREATE TABLE origen_institution_inquiry_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid REFERENCES origen_institution_inquiries(id) ON DELETE SET NULL,
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE RESTRICT,
 actor text, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE origen_topic_notes DROP CONSTRAINT origen_topic_notes_kind_check;
ALTER TABLE origen_topic_notes ADD CONSTRAINT origen_topic_notes_kind_check CHECK (kind IN ('note','explanation','question','decision'));

-- Receipt survives plan deletion, preventing a delayed create retry from restoring it.
CREATE TABLE origen_plan_creations (
 account_id uuid NOT NULL REFERENCES origen_accounts(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_id)
);

-- Accepted actions are independent copies. Deleting a note removes its reference,
-- not an action the user has explicitly chosen to put in their plan.
CREATE TABLE origen_plan_note_links (
 account_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 step_id text NOT NULL,
 note_id uuid NOT NULL,
 note_version integer NOT NULL CHECK (note_version > 0),
 PRIMARY KEY(account_id,plan_id,step_id),
 FOREIGN KEY(account_id,plan_id,step_id) REFERENCES origen_plan_steps(account_id,plan_id,id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,note_id) REFERENCES origen_topic_notes(account_id,id) ON DELETE CASCADE
);

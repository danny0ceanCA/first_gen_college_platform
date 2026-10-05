-- Existing accounts remain unclassified until the person chooses their role.
ALTER TABLE origen_accounts ADD COLUMN role text CHECK (role IS NULL OR role IN ('parent', 'student'));

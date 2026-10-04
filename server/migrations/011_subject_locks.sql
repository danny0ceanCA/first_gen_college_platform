-- Stable transaction guard survives deletion of the account row.
CREATE TABLE origen_subject_locks (
 subject_hash text PRIMARY KEY CHECK (length(subject_hash)=64)
);

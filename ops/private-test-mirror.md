# Private account mirror

Migration 121 installs an operator-managed one-way copy for the specifically authorized student test account. Installing the migration alone enables no mirror: an owner must insert the explicitly approved source and target UUIDs into `origen_private_test_mirrors`. The target must retain `student-test@example.test` as its stored email. Runtime roles cannot read or configure the mapping.

Source inserts, updates and deletes copy profiles, summaries, notes, memory versions and extraction receipts, plans/steps/source references, and workspace sheets in the source transaction. Changes become visible after refreshing the test account. Source account erasure also removes its copied personal records. Test-side changes never propagate back; a later source edit wins for that same record. Unrelated test-created records remain test-only.

Credentials, account roles, eligibility/guardian consent, coordinator connections, publication grants, feedback, telemetry and billing are not copied. Imported source lineage is incomplete and inactive, and copied summaries cannot acquire student-only sharing certification. The source report's attribution is retained. Copied summaries do not enqueue duplicate binder extraction.

An explicitly erased destination record is not recreated. A copy failure records a table name and SQLSTATE in `last_error`; it does not fail the real account's save. Failures are sticky until an operator investigates and reconciles them. There is no automatic retry worker: monitor `last_error` if continuing to rely on this special-purpose mirror. Disable with an owner-only update of `enabled=false`; this stops future copying without deleting either account.

The November 2 setup was verified in a rollback-only production dry run, then applied atomically to the two authorized accounts. Alex's synthetic profile and associated sharing were removed, along with the known original family-scope fixture sentinel. Aiden and Elodie remain private.

Validation: `DATABASE_TEST_URL=... node --test server/private-test-mirror.test.mjs server/voice-workspace.test.mjs server/history-retrieval.test.mjs`. Use a disposable local database, never a production database as `DATABASE_TEST_URL`.

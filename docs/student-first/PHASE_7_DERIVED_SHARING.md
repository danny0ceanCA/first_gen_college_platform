# Phase 7: student-selected conversation details

Implementation in progress, 2026-10-21. Database verification is blocked by Windows denying the disposable PostgreSQL cluster's loopback socket binds, including after the explicitly authorized retry outside the sandbox. This is not a completed release gate. No production migrations, deployment, commit or push occurred. `ORIGEN_DERIVED_BINDER_SHARING` defaults to `false`.

## Student experience

The existing sharing screen remains the only publication path. A student chooses a connected coordinator, topics and individual eligible entries, then sees the exact text before publishing. Automatic organization does not create a grant, a publication, or a help request. Cancelling a preview does not share anything.

Eligible goals, constraints and preferences in memory, plus eligible topic notes and questions, can appear alongside manual notes. Derived entries carry a short attribution inside their published content, for example:

> From a student conversation summary; not a verbatim quote. Tentative, not a decision: Maybe nursing would be a good fit.

Spanish entries carry Spanish attribution. This prefix remains visible in the student's preview, published selection and coordinator view. It describes evidence accurately: the item comes from a saved summary, not a verified recording or independently established fact. Sharing a tentative interest never changes its certainty or confirms a decision.

The coordinator receives only the reviewed publication. Whole summaries, other binder items, source identifiers, private evidence and raw turns are not included. Existing expiry, withdrawal, topic removal, disconnect, account closure and permission rules remain in place. New conversations and edits require another explicit review/publication.

## Implementation and rationale

- `server/migrations/067_derived_binder_sharing.sql` extends the existing eligibility adapter, publication guard and two commands. Discovery, preview, commit and coordinator reads use the same filter. Existing receipt identity, source versions/digests, account locks and grant locks continue to protect stale previews and publication/revocation races.
- The migration records `sharing_student_scope` on **new authenticated student-scoped summary inserts**. It cannot be set retroactively by updating an old summary. Content/scope/reporter changes clear it. This is trusted scope evidence, not a claim that an entire conversation is safe.
- Memory items join the existing private lineage graph with source kind `memory`. Memory changes, suppression and source deletion consequently invalidate shared snapshots through the same dependency cascade as notes. No second queue, public memory table or independent sharing permission system is introduced.
- `origen_binder_derived_entries` returns only a bounded excerpt and its public attribution. It does not turn an unknown summary lineage into `student_only` certification. The original manual-note policy and serializer remain separate and unchanged.
- `server/binder-organization.mjs` now retains the already validated topic in organization metadata. A goal in the memory store needs that topic to be included in a selected sharing section without guessing. Existing metadata remains readable; no historical extraction runs.
- `server/binder-sharing.mjs` and `server/coordinator-binders.mjs` supply the server-owned gate. Validators discard caller-supplied enable flags, ownership and provenance. The database commands set the gate transaction-locally for their shared helper. The runtime already constitutes the trusted database-command caller; this is not a new client-selected permission.
- `src/BinderSharing.tsx` explains exact entry selection and derived attribution. The existing snapshot shape is retained, so the coordinator renderer needs no new private fields or parsing rules. Keeping attribution in snapshot content also prevents a renderer that only understands existing fields from dropping the qualifier.

## Conservative eligibility boundary

Both current item and source must belong to the same student/account. The current source must have post-migration authenticated student-scope evidence and a student reporter, current digest, active unprotected lineage, no suppression, and no family/unresolved/other-student session attribution. The item must have versioned organization metadata, student attribution, summary evidence type, current summary hash, valid topic/language/certainty, an exact unchanged source quote and an active direct dependency on that summary. Extra ancestry is excluded.

The entire source is screened, not only the selected sentence. The initial English/Spanish exclusion policy blocks family/parent terms, medical/health, immigration, identity/contact identifiers and other listed sensitive categories. This deliberately rejects some harmless interests, dates or contexts too. Pattern screening is **not** semantic proof that every sensitive statement is recognized. Its quality and false-negative rate require multilingual human/provider evaluation in Phase 9; do not describe it as a complete sensitive-information detector.

Older summaries are not backfilled. Legacy extraction without organization metadata, unknown/mixed/family/parent provenance, restored notes, edited quotations and suppressed sources stay private. Corrections that suppress an original source deliberately cannot make that old derivation newly shareable. A student can write a separate manual note using the existing flow; automatically certifying corrected/free-form derivations requires a later explicit policy, not a weakened check here. The legacy memory confirmation path can drop organization metadata; that item then remains private. These are conservative limitations, not data loss.

Manual notes retain their existing eligibility policy; the new whole-source sensitive screening applies to automatically derived entries. A student remains responsible for reviewing any manually written material they choose to share.

## Rollout and rollback

1. Complete the restricted-role PostgreSQL tests, including the existing sharing suites and new derived cases, against disposable synthetic data.
2. Rehearse migration 067 and runtime grants as part of the later release packet. No production execution is authorized by this phase.
3. Apply migration before enabling `ORIGEN_DERIVED_BINDER_SHARING=true` on a future approved deployment. Existing binder sharing/linking/account prerequisites still apply. The startup check requires migration 067 when the new flag is enabled. Organization must have produced eligible entries; it need not remain enabled to read already explicitly shared items.
4. Keep the flag false until release/pilot approval. Disabling it hides derived discovery, publication and coordinator content while retaining ordinary manual sharing and removal controls. It does not delete prior valid grants/snapshots; re-enabling can reveal still-valid, previously approved selections. Use revoke/withdraw when permanent removal is intended. No reverse schema migration is needed.

No new telemetry payload or raw-content log is added. Existing finite sharing outcomes and source-change conflicts remain the operational signals. Preview expiration, ambiguous responses and failed publication continue to use the existing refresh/review flow.

## Verification status

**Phase 9 follow-up (2026-10-21):** the newly authorized start of the same disposable cluster succeeded. Real restricted-role publication/source invalidation, concurrency and lifecycle suites subsequently passed after forward migrations 069–071. See [PHASE_9_VALIDATION.md](PHASE_9_VALIDATION.md) and its linked evidence for current results. The denial below describes the original Phase 7 attempt and is preserved as history, not the current database-test status. No production migration was applied.

- Passed: TypeScript, production Vite build using the native config loader, production logging policy and whitespace checks. Existing Auth0 directive and bundle-size warnings remain.
- Passed: six synthetic browser journeys, English/Spanish at 1280, 390 and 320 pixels, using a separate local headless Chrome profile. Each exercises exact attributed preview, no publication before confirmation, cancel, stale-preview rejection, publication, revocation, logout clearing and no persistent content. The 320px Spanish screenshot was visually inspected.
- Passed: non-database policy/validation tests. PostgreSQL-dependent cases were skipped in these invocations and are **not** counted as passing database evidence.
- Pending: real PostgreSQL migration, restricted-role source invalidation, preview/publication equality, rollback flag behavior, concurrent publication/revocation, and existing lifecycle regression suites. The tests are written in `server/derived-binder-sharing.test.mjs`; existing publication, coordinator-viewing and sharing lifecycle suites remain required.

The sandboxed `pg_ctl start` for `tmp/student-first-phase1-pg-20261021`, loopback port 55487, failed with `could not create restricted token: error code 87` and `could not start server: error code 3`. A subsequent read-only readiness check returned `no response`.

The user then explicitly authorized starting this exact cluster outside the sandbox and stopping it after verification. One authorized retry was executed with escalation. PostgreSQL started its process but Windows returned `Permission denied` for both IPv6 `::1` and IPv4 `127.0.0.1` socket binds. The log (`tmp/phase7-postgres.log`, 2026-10-21 15:01:40 PDT) ends with `FATAL: could not create any TCP/IP sockets` and `database system is shut down`. A read-only `pg_isready -h 127.0.0.1 -p 55487` check again returned `no response`. No further start retry or alternate-port workaround was attempted. The exact blocker is an OS socket-bind denial, not an automatic approval-review rejection; authorization is no longer pending. Database tests remain unrun. No running cluster remains to stop. The isolated Vite preview had already been stopped through its own execution session after browser verification.

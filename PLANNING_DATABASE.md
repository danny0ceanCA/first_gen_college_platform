# Planning storage

Planning records and conversation summaries are separate. A conversation may explore ideas without committing to a plan. The voice guide cannot silently change a saved plan; create/update/delete requires an explicit authenticated API operation and, for an edit/delete, the last saved version.

| Table | Stores |
| --- | --- |
| `origen_plans` | Account owner, student or general-family target, title, goal, broad category, active/archived state, version and timestamps |
| `origen_plan_steps` | Ordered actions, progress, notes and optional calendar due date |
| `origen_plan_sources` | Source title and HTTPS reference URL for each step; a reference does not certify course approval or eligibility |
| `origen_plan_conversations` | Links to existing account-private summaries that informed the plan |
| `origen_conversation_summaries` | Existing summarized discussion history, including `planning` conversations; no raw audio/transcripts |

All plan tables carry `account_id`. Composite foreign keys prevent steps, references or conversations from attaching to another account's records. `student_id=NULL` means a general family plan. The API derives the account from the verified Auth0 subject, checks that the student belongs to that account, and checks that every linked summary has the same student/family target. A plan's target cannot be changed in an update. Create a separate plan for another student.

Categories are education, courses, transfer, degree, career, financial and other. They do not assume high school. Due dates are user-planned dates, not independently verified application deadlines. Stage and profile details remain in the student record rather than duplicated in each plan. Progress belongs to action steps; completing a step does not mark a university requirement satisfied.

Plans remain private to the signed-in account even when an academic student profile is linked to another account. Sharing plans would require a separate explicit product decision. Deleting a student deletes that account's plans and histories for that student. Deleting a summary removes its plan associations but keeps the plan and steps. Deleting a plan deletes its steps, references and associations but preserves the conversations. Account deletion cascades to family plans and family summaries as well. Migration 007 adds the previously missing direct account foreign key for summaries with NULL student IDs.

## API contract

Authenticated `POST /api/plans` supports:

- `load`: optional `studentId` (omitted means all account plans; NULL means family only).
- `create`: `plan` with studentId, title, goal, category, status, steps and summaryIds. The database creates the plan ID and version 1.
- `update`: plan ID, current version and replacement `plan`. The transaction validates all records before replacing ordered steps and sources, and increments the version.
- `delete`: plan ID and current version. Returns the remaining account plans.

Each step has id, title, action, notes, status (`not-started`, `in-progress`, `complete`), dueDate (YYYY-MM-DD or NULL), and sources (title and HTTPS url). A version conflict returns 409 `plan_changed`; clients should reload and review changes before resubmitting. No stale update is automatically retried. Errors are sanitized and logged under the known `api.plans` endpoint. Anonymous voice previews cannot read or write persistent plans.

At planning-voice startup, the server loads up to five active plans for the confirmed account/student or family target along with recent summaries. Client-supplied plans are ignored for authenticated calls. No other student's plans enter that session. The voice can discuss actions and identify unresolved questions, but cannot claim it edited the records.

## Deployment and remaining UI work

Backend startup applies migrations through `007_planning_records.sql`; readiness requires 007. Deploy the API before the web frontend. No database reset, new credentials or domain change is required. Applied migrations remain immutable.

The database and authenticated API are implemented. The current Planning screen still saves voice summaries; it does not yet expose a structured plan editor or turn a voice suggestion into a saved plan. Those flows should use this API with explicit review, rather than parsing arbitrary summary text as an approved plan. Native clients can use the same API when their plan editor is added.

Tests exercise ownership, stale-update rejection, target mismatches, calendar-date/source validation, ordered-step round trips, linked-history deletion and account/student cascade cleanup in pg-mem. The emulator fixture supplies PostgreSQL's generated name for the original mode CHECK constraint; production migration files are unchanged. A real PostgreSQL integration test is gated by `DATABASE_TEST_URL`; use a dedicated test database before production deployment.

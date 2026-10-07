# PostgreSQL integration

## Phase 1 — database foundation

Implemented: a five-connection `pg` pool using backend-only `DATABASE_URL`, transactional versioned migrations, startup initialization and `/readyz`.

Tables:

- `origen_accounts`: Auth0 subject, first name, email and timestamps. No account phone number, last name or password is stored.
- `origen_students`: existing profile fields, tied to an account.
- `origen_conversation_summaries`: student-specific summaries, mode, dates and source links. No audio or full transcripts are stored here.
- `origen_schema_migrations`: migration versions and checksums.

Student IDs are scoped to accounts, so importing existing local IDs will not collide between families. A composite foreign key prevents summaries from referencing students in a different account. Phase 2 adds API ownership checks based on the verified Auth0 identity; the constraints alone are not authorization.

### Deploy and verify

1. Set `DATABASE_URL` on the **Origen Edu API web service**, using the Render database's internal connection URL. Never set it on the static site or mobile bundle.
2. Deploy the code. The existing `npm start` command applies pending migrations before accepting traffic. Do not change already applied SQL files; add a new numbered migration for later schema changes.
3. Check Render logs for `Origen database migrations are up to date.` followed by `Origen API listening`.
4. Open `https://origen-edu.onrender.com/readyz`; expect HTTP 200 and `{"ok":true}`. It returns 503 when the database or required schema is unavailable. `/healthz` remains a process liveness check.

When `DATABASE_URL` is configured but initialization fails, the new process exits without starting. Error logs do not include the connection URL or credentials. Without `DATABASE_URL`, local development can still run the existing features, but `/readyz` returns 503.

`npm run db:migrate` runs migrations separately if desired. Database URLs for local/CI use must be external URLs with TLS; Render's internal hostname works only on its private network.

### Checks

`npm test` covers transaction rollback, migration retries, modified-migration rejection and readiness responses. To also verify the actual PostgreSQL schema, set backend-only `DATABASE_TEST_URL` to a dedicated test database and run `npm test`. The integration test creates a uniquely named temporary schema, checks account foreign keys and cascades, and removes that schema afterward.

Phase 1 does not write any real account/profile/summary records and does not import or replace browser/device storage.

## Phase 2 — account and student persistence

Implemented in source: authenticated `POST /api/family`, with actions `load`, `save-account`, `save-student`, `delete-student`, and `import`. Ownership comes only from the gateway's verified Auth0 subject, never a client-supplied account or user ID. Requests validate supported fields and all student queries are scoped to the account. Account updates store first name and contact email only; changing that email does not change Auth0 credentials or prove email ownership.

Web settings, onboarding and student create/edit/delete now wait for backend confirmation when signed in. Failed loads block the family UI with retry/logout; failed saves keep form drafts open. Anonymous previews remain local. Only the authenticated user's previous scoped browser records import automatically; sample/anonymous records are excluded. Original local files are retained as backups.

The native app now uses its existing Auth0 SDK, requesting the same API audience. It reads/writes the same family endpoint. Legacy mobile records had no owner identity, so settings offers an explicit **Import saved device profiles** action after signing in. Imports preserve server edits, are atomic, and are recorded once per account/source so old local copies do not recreate later-deleted profiles. Legacy free-text education stages are preserved in notes when they do not match the canonical options.

Deploy backend before frontend. Startup applies `002_local_imports.sql`. No Render start command change is needed. Validate `/readyz`, then sign in, save a test student, refresh, and confirm it on the same account on a second device. Cross-device updates load on app entry/refresh; this phase does not add live collaborative editing. Concurrent edits use the last confirmed save.

### Mobile Auth0 setup

Native sign-in requires a development/EAS build, not Expo Go. The existing Auth0 config plugin and `origen` scheme are used. Add both URLs to the **Origen Mobile** Auth0 application's Allowed Callback URLs and Allowed Logout URLs:

```text
origen://origenedu.us.auth0.com/ios/com.danny0ceanca.origen/callback
origen://origenedu.us.auth0.com/android/com.danny0ceanca.origen/callback
```

Use the same passwordless SMS connection on the web and native clients so a person has the same Auth0 subject. Enable refresh token rotation and offline access for the API/native client if persistent native sessions are desired. Auth0 manages native tokens through its credentials manager; tokens are not stored in AsyncStorage.

Optional public mobile variables: `EXPO_PUBLIC_API_URL` defaults to `https://origen-edu.onrender.com`; `EXPO_PUBLIC_AUTH0_AUDIENCE` defaults to `https://api.origenedu.ai`. These are identifiers/URLs, never database or OpenAI credentials.

The mobile browser preview uses the **Origen Web** SPA client. For browser sign-in testing at `http://127.0.0.1:8081`, add that exact origin to the web client's callbacks/logout/web origins and the backend `ALLOWED_ORIGINS`. Use the actual preview origin if different. Expo Go retains the device-only preview and explains the development-build requirement when Sign in is tapped.

### Validation limits

Repository/handler tests execute the family SQL against the `pg-mem` PostgreSQL emulator, checking account isolation, supported fields, one-time imports, server-edit preservation and deleted-profile handling. Real PostgreSQL checks remain available through `DATABASE_TEST_URL`; credentials were not supplied locally, so those checks are skipped. Native phone sign-in and live Render writes still require deployment and device testing.

## Phase 3 — conversation history and voice context

Implemented in source. Authenticated `POST /api/conversation-history` loads the latest 100 summaries, deletes a summary, imports prior account-scoped browser summaries once, or saves an onboarding summary after the student profile is saved. All reads and writes use the verified Auth0 subject and account/student ownership. Student deletion cascades to their summaries. Original local backups remain untouched; the import receipt prevents deleted summaries from being recreated by those backups.

`POST /api/conversation-summary` generates a short summary with OpenAI storage disabled and saves it to PostgreSQL before reporting success for an existing student. Session IDs make repeat saves idempotent. Only the summary, date, guidance topic and source links are stored; raw transcripts and microphone audio are not saved in this database. During onboarding, a generated summary stays in memory until its student profile is saved; abandoning onboarding or reloading first discards that pending summary.

The family view keeps history in a collapsed section per student on both web and native mobile. Signed-in history comes from the backend; anonymous web previews remain browser-local. The mobile app reviews web-generated summaries, but native live voice is still pending.

At voice-session creation, the backend verifies the selected student and supplies their most recent six summaries automatically. It ignores client-supplied memory for authenticated sessions. No resume/continue button is added. Deleting a summary removes it from future voice sessions; an already-running session retains the context it received at startup. Dynamic facts such as costs and deadlines must still be checked against current official sources.

### Deployment and verification

Finish any remaining phases before deploying if desired. Deploy the backend first: startup applies `003_history_imports.sql`; `/readyz` then checks that migration and database connectivity. Next deploy the frontend and rebuild/update the mobile app. No domain or SSL changes are needed.

Sign in, talk with Origen for an existing student, end the conversation, and open **Past conversations**. Refresh and check the same student on another signed-in device. Start a new voice session and ask about a prior topic. Delete the summary, refresh, and verify it stays deleted. Use a second account to confirm that it cannot see the first family's summaries.

Automated tests cover isolation even with matching student IDs across accounts, unsafe source rejection, one-time imports, deleted-profile cascades, idempotent saves, deferred onboarding summaries and server-owned voice context. Tests use the PostgreSQL emulator; real database integration is optional via `DATABASE_TEST_URL`. Live Render and physical-device voice/auth testing still require deployment and credentials.

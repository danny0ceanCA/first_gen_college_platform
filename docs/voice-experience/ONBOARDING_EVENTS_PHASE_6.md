# Onboarding release verification — phase 6

The original onboarding proposal ended at phase 5. This extension makes the completed phases repeatably verifiable before release. It does not change prompts, add research collection, call a paid model or deploy the app.

## Run the checks

```sh
npm run check:onboarding
npm run check:onboarding -- --browser
```

The first command runs the complete server test suite and production build. The browser option additionally starts an owned Vite server on an available local port, runs six isolated scenarios through Playwright CLI, closes each browser session and shuts down that server. It does not attach to an existing user's browser or stop another development server. Node/npm and a usable Playwright CLI browser installation are required; npx may fetch the CLI package if it is not cached. Browser setup or assertion failure fails the check rather than becoming a skipped success.

All browser APIs, media and authentication identities are synthetic. Scenario requests to paid endpoints are mocked; unexpected external page requests are blocked. Google font requests receive an empty local response, so browser layout checks use fallback fonts. Production Auth0, Google social login, provider audio generation and real microphone permission dialogs are not exercised.

The machine-readable report is `output/onboarding-release-check.json`. It records test counts including skips, build status, browser scenario results, durations and a source fingerprint. It stores no request payloads, identities, tokens, conversation content or raw command/error logs. Nonzero exit means the configured check failed. Source changes during verification invalidate the result; generated outputs do not alter the fingerprint. Fingerprinting covers server/client source, public assets, build/package configuration, verification scripts and onboarding documentation, not environment files or credentials. The latest report describes only that run; archive it with the release when durable evidence is needed.

## Coverage

| Scenario | Evidence |
| --- | --- |
| Phase 1 | Actual setup: microphone denial, failed save, retry during tracking outage, native acknowledgement and web home arrival |
| Phase 2 | Protected per-account timeline, return visits, event/visit paging, missing capture, error retry and responsive display |
| Phase 3 | Simulated voice playback, interruption, save confirmation drain, same call/audio into home and explicit hangup |
| Phase 4 | Cohorts, maturity/sample denominators, reporting refresh, directory isolation and missing/empty states |
| Phase 5 | Refresh replay, storage sanitization, account switching, token mismatch, closure and admin review flags |
| Phase 6 | Initial account-load failure blocks replay; retry restores setup; animated labels switch Spanish/English; manual Spanish stage keeps its canonical value; logout failure recovers; failed saves remain tracked; successful save and refresh return to home |

`server/onboarding-release.test.mjs` traverses real HTTP gateway/handlers against the PostgreSQL-compatible synthetic fixture. It confirms profile validation and authoritative save, duplicate replay, subsequent account loading, admin history/cohorts/flags, two-account isolation despite a reused visit ID, export, deletion cascades and refusal of late events after closure. It also checks that diagnostic logs and timeline metadata exclude profile text. Its verifier is synthetic; it does not establish real JWT/provider configuration or PostgreSQL locking behavior.

`server/onboarding-release-report.test.mjs` rejects absent, duplicate and inconsistent test summary evidence and checks the source fingerprint. Existing dedicated PostgreSQL integration checks run only with explicitly configured `ORIGEN_TEST_DATABASE_URL`; skipped checks are reported, never called passed. No production `DATABASE_URL` is used automatically for these tests.

## CI and rollout

The application CI workflow runs `check:onboarding` in place of its separate server-test/build steps, keeps existing operations tests and dependency audit, and uploads the verification report even when checks fail. It does not install/run the optional browser suite automatically. A passing report means the configured local/CI checks passed; `productionVerified` remains false.

Before treating a deployment as verified, record the release commit and check the following on that deployed version:

1. Real Auth0 email/password registration and Google sign-in for the Origen tenant/application, with the intended API audience and callback origin.
2. An unfinished account returns to setup; a saved account returns to home. A manual profile save and a spoken save both reach home without losing the active conversation.
3. A human listens in English and Spanish: greeting/pronunciation, language switching, volume, interruptions and spoken save completion. Synthetic audio events cannot establish what a person actually hears.
4. Applied migrations 027/028, configured retention and server-granted admin permission. A normal account cannot read the dashboard.
5. Dedicated PostgreSQL checks if they were skipped, including concurrency and cascade behavior. Retention changes delete qualifying diagnostics; reverting the setting cannot recreate expired rows.

The report is technical verification evidence, not deployment permission, research approval or certification. Existing deployment and rollback processes remain applicable. No commit, push, deployment or production configuration change is performed by the verification command.

# Fresh authentication and concurrent closure

Implemented locally October 3, 2026. No provider configuration or deployment changed.

## Fresh authentication

Account closure and institution verification/publication/change-request actions require `https://origenedu.ai/auth_time` in the API's verified access token. It must be an integer Unix timestamp no more than five minutes old and not in the future. Missing/malformed/stale claims return `403 reauthentication_required` before a database transaction. Token issuance (`iat`), request fields and client-side assertions are not accepted as login evidence. Reviewer authorization and self-review restrictions remain separately enforced.

Web controls offer an explicit Auth0 re-login with `max_age: 0` and `prompt: login`, returning to the appropriate app area. They never automatically replay deletion or publication. The user must review and confirm again. Unsaved review notes can be lost across redirect; save/retain them before reauthenticating. This is fresh authentication, not an assertion that MFA was performed.

### Required Auth0 setup before rollout

1. In the intended Auth0 tenant, create a Post Login Action using `auth0/recent-auth-action.cjs` and bind it to the Login flow.
2. The Action copies `event.session.authenticated_at` into the namespaced API access-token claim in Unix seconds. It never uses current time, token issuance or last interaction as a substitute. When that provider field is absent/invalid it omits the claim and the API fails closed for protected actions.
3. Verify the actual configured connection produces the field after interactive login. Check with synthetic accounts: immediate action succeeds, a session older than five minutes requires login, silent/refresh issuance does not refresh authentication age, and interactive re-login updates it. Do not publish raw tokens in logs or evidence.
4. Deploy API/web changes after validating the Action. Old tokens without the claim intentionally cannot perform protected actions. Existing profile edits/read-only access remain available subject to normal authorization.

Provider references: [Auth0 session authentication timestamps](https://support.auth0.com/center/s/article/Difference-between-the-properties-of-event-session-in-a-post-login-Action), [custom access-token claims](https://support.auth0.com/center/s/article/Set-access-token-claims-using-actions). Actual tenant behavior is not verified by local Action tests.

## Closure concurrency

Migration 011 adds stable per-subject transaction guards, keyed by a SHA-256 subject hash. Family, links, history, plans, institution and lifecycle transactions acquire that row lock immediately after BEGIN and check the closure receipt before touching account records. The lock is held until commit/rollback and remains valid even if the account row is deleted or has never existed.

If a write gets the lock first, closure waits and then sees the committed state; family/institution ownership safeguards can block closure or the active private records are deleted. If closure commits first, a waiting subject-scoped transaction sees the receipt and fails instead of recreating the account or registering an institution. Guards work across PostgreSQL connections/processes. Different accounts use different locks. Database statement timeouts bound waits; transient contention can produce retryable service failures.

Active subject-lock rows are minimal pseudonymous operational records and currently have no automatic expiry. Removing them while a transaction can still use them breaks serialization. Closure receipts also remain. Include both tables in backup/recovery and privacy documentation; neither should be called anonymous data.

Authenticated gateway checks remain a fast rejection layer. Database guards protect later persistence even when an AI request passed the gateway before closure and subsequently tries to save history. Already-sent provider processing and issued voice connections are not remotely cancelled by this change. Other participants keep their own legitimately shared copies.

## Verification and rollout

Local tests cover fresh/stale/missing/future timestamps, Action claim generation, fail-closed HTTP checks, guard order and receipt rejection. The optional `account-concurrency.test.mjs` uses separate real PostgreSQL connections to prove blocking in both orderings; it is skipped without a dedicated `DATABASE_TEST_URL`. Emulator tests do not prove real lock scheduling.

Deploy backend before frontend. Startup applies 011 and readiness requires it. Verify synthetic closure, stale-login review actions and two-connection tests before production readiness is claimed. Do not edit applied migrations or delete closure/lock tables as a rollback shortcut.

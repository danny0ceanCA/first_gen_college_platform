# Admin dashboard enhancement — phase 1

The account directory now separates account-holder role, saved student-profile count, recorded journey stage, and admin access. This phase changes reporting only; it does not grant access, change onboarding routing, contact users, or add model calls.

## Journey definitions

- **Registered:** no setup milestone or profile-detail evidence is recorded.
- **Onboarding started:** an account opening milestone or retained onboarding visit exists, without a confirmed completion or profile details.
- **Save unconfirmed:** account details or student profiles exist without the server-owned onboarding completion timestamp. Older/imported history may be missing. This is not proof that a user failed to save.
- **Profile saved:** the server-owned `onboarding_completed_at` confirms setup completion. Names, roles, browser save messages and student counts cannot establish this stage on their own.
- **Used guidance after setup:** a non-profile voice call has positive recorded connected time and started after confirmed completion. The onboarding call continuing into home does not establish this stage. This is a technical usage milestone, not proof of usefulness or educational progress.

The last two stages take precedence over incomplete/missing profile-detail evidence. Journey stages and latest timestamps use all recorded history through the report cutoff; changing the 7/30/90-day usage window does not reset a journey. Directory filters do not filter the registration milestones or onboarding visit cohorts above it.

The registration milestone report counts confirmed saves independently of opening events and uses the same post-setup call definition. Missing opening telemetry must not suppress an authoritative save.

## Latest activity and roles

Last recorded activity is the latest account creation, sign-in, voice activity/heartbeat, retained onboarding receipt, or confirmed setup save. The directory and detail view identify its source and show last sign-in separately. Device timestamps are not used to promote a delayed onboarding event; its server receipt time is used. This is neither an online indicator nor complete app-session tracking. Student edits and unrelated page navigation are outside this measure. Retention and capture gaps can leave incomplete history.

Saved student-profile counts are account-owned records, not distinct people across the service. Account-holder role remains parent/guardian, student, or not provided. It does not imply an Auth0 authorization role.

Admin access is confirmed only when the account matches the current authorized request subject or the backend `ADMIN_SUBJECTS` allowlist. Other accounts are **not verified here**, not classified as non-admin. Auth0 role assignments are not synchronized by this feature; manage them in Auth0. Request bodies cannot supply this evidence, and admin subjects are not returned to the browser. Confirmed admins without setup receive an explicit note that setup is optional.

## Implementation and verification

Directory and account details share the same SQL facts. Source aggregates are joined only after grouping by account to avoid multiplying minutes/sign-ins when an account has multiple students or visits. Role, literal name/ID search, journey filtering, last-activity sorting and pagination run on the server with bound inputs and an allowlisted sort. No new migration or app dependency is required; onboarding tables from migration 027 must already be present.

Run `node --test server/admin-users.test.mjs`. The SQL integration test in `server/admin-users-journey.test.mjs` runs with an explicitly supplied `DATABASE_TEST_URL`, in its own disposable schema. It never reads the production `DATABASE_URL`. Alternatively, set `ADMIN_TEST_PGLITE_MODULE` to a locally installed PGlite entry point; it runs in memory. The temporary PGlite verification package used during development is not an application dependency.

The integration scenarios cover confirmed saves without opening events, older details without save history, calls before setup, zero-time calls, ongoing onboarding calls, latest receipts/heartbeats, all-time stages versus period usage, literal searches, account isolation, access evidence, stable paging, and directory/detail consistency. Browser checks use synthetic records for filters, stage labels, admin evidence, detail parity, errors and responsive layout. Production Auth0 configuration and deployment are separate from these local checks.

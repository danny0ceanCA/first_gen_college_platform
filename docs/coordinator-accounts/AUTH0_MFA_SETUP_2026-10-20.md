# Coordinator authenticator verification â€” October 20, 2026

The product owner authorized the Auth0 setup, paused it to review alternatives, then chose to proceed with authenticator verification and explain preparation on Become a coordinator.

## Live tenant configuration

Tenant: `origenedu.us.auth0.com`. OTP and recovery-code factors are enabled. `customize_mfa_in_postlogin_action` is enabled. The existing empty Guardian policy list is preserved: the MFA Action challenges only when Origen requests staff verification using the existing multi-factor `acr_values` parameter. Ordinary student login does not request that challenge.

The Login flow binds these deployed Node 22 / post-login v3 Actions in order:

1. **Origen Staff MFA**, from `auth0/staff-mfa-action.cjs`: enroll in OTP when needed; otherwise challenge the enrolled OTP factor.
2. **Origen Authentication Proof**, from `auth0/recent-auth-action.cjs`: sign actual authentication and completed MFA timestamps into the API access token. Token issuance is never substituted for authentication time.

The sanitized activation evidence is `AUTH0_MFA_ACTIVATION_2026-10-20.json`. Action code hashes, deployment versions, binding order, factors, preserved policies and synthetic test outcomes were re-fetched and verified. The CLI session is stored outside the repository in the operator user configuration directory; no credentials are included in the evidence.

## Coordinator experience

Become a coordinator includes **What to have ready**: a verifiable email and a phone with a free authenticator app for staff access. An expandable guide links to the official Google Authenticator apps, explains QR/manual setup, six-digit codes, and recovery-code storage. It makes clear that the application can be submitted before MFA setup. The same guide is shown by the staff verification prompt. English and Spanish are supported.

## Validation and limits

- Auth0 hosted synthetic tests: ordinary login produces no MFA command; first-time staff verification requests OTP enrollment; enrolled staff verification requests an OTP challenge; completed verification produces the expected timestamp claims; a password-only event produces no MFA claim.
- 12 existing authentication/authorization tests passed; TypeScript, production build and logging policy checks passed.
- Browser checks exercised the preparation section and expanded guide in English and Spanish at 390px and 1280px, including three setup steps, official download links, registration availability, no horizontal overflow and no application JavaScript errors. Mobile and desktop screenshots were visually reviewed.
- A real person must still complete the first phone enrollment and verify access on a supported device. Synthetic hosted tests do not constitute a real OTP enrollment, recovery attempt or signed-token end-to-end sign-in.
- Account approval, organization membership, student sharing confirmations and family-content privacy are unchanged.

No new application environment variable, backend code change, migration, SMS provider, or payment configuration is required for this tenant configuration. The guide is deployed through the existing frontend release process.


## Synthetic coordinator exception — October 24, 2026

At the product owner's request, `coordinator-test@example.test` is exempt from OTP verification. The Action requires the exact Auth0 user ID `auth0|6adaf0051ec26ca8f49f32fe`, verified email, and administrator-managed `app_metadata` identifying it as a synthetic coordinator signup account. Email alone, user metadata, and request parameters cannot opt in.

The Action issues `https://origenedu.ai/coordinator_test_mfa_exempt` with that exact subject in the signed access and ID tokens. The API accepts it only for that subject. It never fabricates `mfa_time`. Actual password/sign-in proof still expires after 12 hours; existing permissions, organization membership, approvals, audit, and suspension checks still apply. Other coordinators continue using OTP.

Removing the exception from the Action stops issuing the claim on subsequent tokens. To revoke already issued tokens immediately, use the existing staff access control/token-valid-after mechanism. No new database migration or environment variable is required for this exception.

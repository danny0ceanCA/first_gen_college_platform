# Origen Auth0 setup

Public tenant: `dev-0dghf4l675sx6lf3.us.auth0.com`.

## Origen Web (Single Page Application)

Client ID: `KGR1dIEl4G9ZskORHBkvAc1tXaDoCtTt`.

Set **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins** to:

```text
http://127.0.0.1:5173,http://localhost:5173
```

Save changes. Add the eventual HTTPS website URLs in these fields before deployment. The callback uses the origin without a hash; the SDK then returns to `/#app`.

The website uses Auth0 React SDK with hosted Universal Login, `connection=sms` and selected `ui_locales`. Browser PKCE is SDK-managed. No client secret is embedded. Signed-in students/plans and account forms use user-specific local-storage keys; preview data is not silently migrated. These local records are not cloud-synced, and browser-local keys are not a production access-control boundary.

## Passwordless SMS and Twilio

1. Open **Authentication → Passwordless → SMS**.
2. Configure the phone provider through **Branding → Phone Provider** if your tenant uses the Unified Phone Experience.
3. Enter Twilio credentials directly into Auth0, not the repository or chat.
4. Enable SMS delivery and a verified/registered sender as required by Twilio.
5. Enable the SMS connection for **Origen Web** and **Origen Mobile** under its Applications settings.
6. Use Universal Login for the phone-code flow. Send a test message only when ready to incur its SMS cost.

No dashboard changes or SMS deliveries have been performed by the coding agent.

## Origen Mobile (Native)

Client ID: `BVvQs1gEZMMhs76MrwMo8J4juYV51iDd`.

Development bundle/package identifier: `com.danny0ceanca.origen`; scheme: `origen`.

Set **Allowed Callback URLs** and **Allowed Logout URLs** to:

```text
origen://dev-0dghf4l675sx6lf3.us.auth0.com/ios/com.danny0ceanca.origen/callback,
origen://dev-0dghf4l675sx6lf3.us.auth0.com/android/com.danny0ceanca.origen/callback
```

The SDK and Expo config plugin are installed and configured. Auth0 native login still needs UI/session wiring and a native development build. Do not use the Native client ID for a browser preview. Expo Go cannot run the Auth0 native module; the current Expo Go experience remains the local preview.

For release, configure verified HTTPS App/Universal Links and actual release signing credentials. No signed app has been created or published.

## Remaining backend work

Real profile persistence needs an authenticated API and hosted database keyed by verified Auth0 subject. The existing loopback Vite AI endpoints are unchanged and are not protected by the new UI sign-in. Keep them loopback-only until production token validation, authorized per-user access, and usage limits exist. First-name/email Settings currently saves locally; it does not modify the Auth0 identity or verify an email.

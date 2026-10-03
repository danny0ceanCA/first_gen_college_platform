# Origen for iPhone and Android

Native React Native + Expo project, separate from the Vite website.

## Run

From the repository root:

```powershell
cd mobile
npm install
npm start
```

Install Expo Go on your phone, connect the computer and phone to the same Wi-Fi, and open the QR code printed in the terminal. iPhone may require an Expo account. Windows can run Metro and serve either device; a local iOS simulator requires macOS. Android emulation requires a configured Android SDK.

Browser preview of the native components:

```powershell
npm run web
```

## Implemented

- Welcome screen, English/Spanish switching and local preview exit.
- Family, college costs and applications navigation.
- Add/edit/delete student profiles; PostgreSQL persistence when signed in, device-local preview otherwise.
- Settings: first name and email, stored in the signed-in account.
- Auth0 sign-in/logout and explicit legacy-device profile import; native sign-in requires a development build.
- Seven financial-aid learning cards and verified Spanish source routing.
- Official UC, CSU, Common App and CCCApply links in the system browser.
- Safe-area layout and native accessibility roles.

The developer version starts with no students. It does not use or overwrite the website's local-storage data.

## Still to connect

Auth0 and cloud account/student persistence are wired in source. Native live voice is still pending. The voice card explains this and does not request microphone access. Local information is not encrypted secure storage; do not use this prototype for sensitive documents.

The existing Vite API is loopback/origin restricted and is not a mobile production API. Before connecting native live voice, deploy an authenticated backend that owns OpenAI credentials and issues voice sessions to signed-in users. Keep API keys off the device. Native WebRTC needs a development build with its native module; Expo Go alone cannot host arbitrary native libraries. Do not relax the existing website origin restrictions to bypass this.

## Checks

```powershell
npm run typecheck
npx expo export --platform all
```

Export confirms JavaScript bundles, not signed installable iOS/Android binaries. Physical microphone, background lifecycle and device behavior need real-device testing. Store package identifiers, icons, credentials and EAS project registration are pending; no app has been published.

## Database and native sign-in

See [DATABASE_PHASES.md](../DATABASE_PHASES.md) for the API deployment order, native callback URLs and browser-preview configuration. Expo Go remains a local preview because the Auth0 SDK requires a development/EAS build. Native credentials are managed by Auth0, not AsyncStorage.

### Conversation history (phase 3)

Signed-in family cards now include a collapsed Past conversations section. It loads the selected student's summaries from PostgreSQL and supports viewing source links and deleting summaries. Web voice sessions save summaries automatically; native live voice remains pending. Backend migrations must be deployed first. See `../DATABASE_PHASES.md`.

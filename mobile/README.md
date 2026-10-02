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
- Add/edit/delete student profiles; device-local persistence.
- Settings: first name and email, device-local persistence.
- Seven financial-aid learning cards and verified Spanish source routing.
- Official UC, CSU, Common App and CCCApply links in the system browser.
- Safe-area layout and native accessibility roles.

The developer version starts with no students. It does not use or overwrite the website's local-storage data.

## Still to connect

There is no real authentication, cloud profile syncing or native live voice yet. The voice card explains this and does not request microphone access. Local information is not encrypted secure storage; do not use this prototype for sensitive documents.

The existing Vite API is loopback/origin restricted and is not a mobile production API. Before connecting native live voice, deploy an authenticated backend that owns OpenAI credentials and issues voice sessions to signed-in users. Keep API keys off the device. Native WebRTC needs a development build with its native module; Expo Go alone cannot host arbitrary native libraries. Do not relax the existing website origin restrictions to bypass this.

## Checks

```powershell
npm run typecheck
npx expo export --platform all
```

Export confirms JavaScript bundles, not signed installable iOS/Android binaries. Physical microphone, background lifecycle and device behavior need real-device testing. Store package identifiers, icons, credentials and EAS project registration are pending; no app has been published.

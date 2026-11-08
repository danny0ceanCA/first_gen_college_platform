# Isolated microphone observation hookup

Prepared on November 7, 2026 (Pacific), on `v1.3-decisions-integration`.

The local app is connected to the observation wrapper and is ready for a user
microphone call. No listening evaluation or naturalness score is claimed.

## What changed

| Finding | Correction | Effect on the voice call |
| --- | --- | --- |
| Observer startup or transport errors could escape into the call. | Construct the original controller first; bound worker startup and shutdown; stop observation on failures. | The existing call continues without waiting for observation. |
| Every configuration update closed observation. | Preserve same-student observation; explicitly authorize and fence student changes; retain language changes separately. | Student selection and the normal intro use the existing behavior. |
| New fragments left older classifier work apparently current. | Invalidate immediately; defer classification during incomplete caller speech; reject stale results. | No speech commands are added. |
| Playback updates could discard or duplicate transcript classifications. | Retain separate playback evidence and deduplicate by relevant transcript state. | No mute, interruption, or playback action is added. |
| Scope changes or missing transcript evidence could misattribute text. | Log gaps, exclude ambiguous cross-student spans, and stop observation when continuity cannot be trusted. | The observer cannot rewrite or replay the conversation. |

The worker receives copied transcript, scope and playback fields. It has no
provider socket, speech sender, research executor, or student-record writer.
Standalone Decisions results end in local diagnostic records. There are no
native Decisions triggers or injected cues.

## Validation

- **89 observer and local-call tests passed**, including English and Spanish,
  authenticated local WebSockets, baseline/observed provider-command equality,
  intro parity, incomplete input, student changes, disconnects, duplicate events,
  queue saturation, worker startup/post/exit failures, and durable spending limits.
- Existing voice-controller and API regression suites also passed in the
  combined regression run. No real voice provider was used by these tests.
- The isolation check verifies **3,161 other protected files unchanged** and
  pins the exact two reviewed local factory hooks in `server/index.mjs` and
  `server/voice-control.mjs`. Production rejects a custom factory.
- All **110 library snapshots** matched their manifests. Recorded prior full
  review was reused; saved references and relevant full contracts were reread,
  with current official guidance checked. Details: [review](REVIEW_MICROPHONE.md).

## Local environment

- App: `http://127.0.0.1:5173/#app`.
- API/observer status: `http://127.0.0.1:3001/__local_observer`.
- Database: `127.0.0.1:55480/origen_decisions_local_20261107`.
- Data: an isolated clone of the existing November 4 copy of Daniel's account,
  containing Aiden and Elodie; explicitly marked `isolated-copy`, not fictional.
- The new clone was migrated through `124_voice_research_traces.sql` and uses
  restricted runtime/research roles. The source copy and production were untouched.
- Research worker readiness was confirmed. There were no queued/running
  historical research jobs to execute accidentally.
- The frontend API and WebSocket proxy are forced to the local API. Only the
  copied account's existing Auth0 identity is accepted.
- API status reported `classificationEnabled:true`, `workerReady:true`,
  `observeOnly:true`, `cuesEnabled:false`, and zero construction failures.
- The browser reached Origen's normal Auth0 sign-in page from the local app.
  The user must sign in and start the microphone call; no call was started here.

## Spending and retained evidence

This hookup and its regression tests made **zero paid API calls**. At setup,
the existing $5 ledger had $0.0031018 estimated settled usage, $0.15 reserved
for earlier unknown outcomes, and $4.8468982 unreserved. The immutable request
limit had 16 requests remaining. Each call allows at most 12 classifications;
reaching either cap stops further classification without stopping the call.

The user authorized observation of this isolated account copy with Decisions.
Auth0 sign-in and ordinary OpenAI voice/research requests still use their normal
providers. The Decisions cap is not a new budget for automated voice tests.

Native fragments/timestamps, estimated transcript boundaries, browser playback,
scope gaps and classification results persist in ignored local files under
`research/decisions/.local/`. The filename matches the diagnostic call ID.
`app.stdout.log` and `app.stderr.log` retain launcher/worker status. Files are not
deleted at call end. Transcripts do not prove playback or understanding.

An actual microphone call remains necessary to assess device audio, perceived
naturalness, and classifier usefulness on spontaneous conversation. The observer
starts when the authenticated call starts; zero active observers before then
is expected. No commit, push, deployment, or production setting was changed.

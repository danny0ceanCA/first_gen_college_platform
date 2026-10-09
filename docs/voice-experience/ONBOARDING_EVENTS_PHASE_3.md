# Onboarding voice diagnostics — phase 3

For subsequent retry persistence, retention settings and operational flags, see [phase 5](ONBOARDING_EVENTS_PHASE_5.md).

The existing admin onboarding timeline now shows speech, playback, spoken save confirmation and the handoff into home. These are technical observations, not recorded conversations or evidence of abandonment.

## Voice stages

- `first_agent_audio` requires both a provider output buffer and a browser playback state with sound enabled. It records elapsed milliseconds from the voice request using the same monotonic device clock. Playback unavailable, paused or muted does not qualify. These signals cannot verify device volume or that a person heard the audio.
- `audio_playback_started`, `audio_playback_blocked`, `audio_playback_resumed` and `audio_playback_paused` describe the media element. `agent_audio_started`, `agent_audio_drained` and `agent_audio_cleared` describe provider buffer signals; a drained buffer alone does not prove audible playback.
- `first_user_speech`, `user_speech_started` and `user_speech_stopped` describe detected speech. Stop events include measured duration only if a matching start was observed.
- `user_speech_transcription` records accepted, empty/ignored, failed or timed out. Late acceptance after a timeout remains visible. No words are copied into diagnostics.
- `speech_during_agent_audio` means speech detection overlapped a provider audio buffer. Noise can trigger this; it does not by itself prove an intentional interruption. Cleared buffers and cancelled/failed/incomplete responses are separate signals.
- `agent_response_finished` records generation status. `microphone_muted` and `microphone_unmuted` record user-selected microphone controls.

Internal provider speech/response IDs are mapped to bounded numeric indices. Only indices and existing UUID voice session/attempt references appear in the timeline. The observer is stopped during transport cleanup; stale track/playback callbacks cannot mark another session ready.

## Save confirmation and home

The voice save tool arms `save_confirmation_waiting` only after a successful profile save. `save_confirmation_started` identifies the following non-progress response; `save_confirmation_audio_started` records its output buffer. `save_confirmation_finished` requires both completed generation without another tool call and the matching audio buffer drain. It includes measured wait duration and browser playback readiness.

Cancellation, failed/incomplete generation or cleared audio produce `save_confirmation_interrupted`. The existing flow can wait for another confirmation. If the call ends first, `save_confirmation_skipped` records the known end reason and preserves the existing saved-profile handoff; it never claims the confirmation played. Status updates from research do not count as the confirmation.

`home_guide_update_started`, `home_guide_update_finished` and `home_guide_update_failed` describe the existing in-place guide change. `home_transition_started`, `home_transition_open_requested`, `home_transition_finished`, `home_transition_failed` and `home_transition_cancelled` describe the page transition. `home_reached` remains the separate React home-render milestone. Animation completion is observed only after a home surface was found; failures and component cancellation restore the page's interaction/animation state.

The same onboarding attempt accepts the small set of handoff events after `home_reached`; ordinary post-home speech and call events remain excluded. `home_introduction_requested`, `home_introduction_started`, `home_introduction_finished` and `home_introduction_failed` describe the initial app-introduction response, with provider drain/readiness limitations retained. These events do not require an additional voice session or model request.

Native WebView onboarding uses the same tracker and records `native_handoff_requested`, `native_handoff_acknowledged` or `native_handoff_failed` around its existing host bridge. A host acknowledgement is **not** a confirmed native home render. The host Exit button and actual native home screen are still outside this web capture. A bounded best-effort flush precedes the closed message; delivery is not guaranteed if the host terminates the WebView first.

## Data and rollout

New onboarding-open events carry capture version 3 and web/native surface. Older attempts cannot acquire missing speech/playback history retroactively. The admin coverage note explains this explicitly.

The server accepts only allowlisted event names, outcomes, reasons, UUID references and field-presence flags. Durations are integers from 0 to 600,000 ms; numeric speech/response indices are 1–2,000. Audio, transcripts, provider IDs, raw error messages and profile answers remain excluded. The existing account isolation, deletion/export, 90-day inactive-attempt retention, request batching and record limits remain unchanged. This adds PostgreSQL diagnostic records, not paid model calls or audio-frame logging.

No new database migration is required after phase 1's `027_onboarding_events.sql`. Deploy the updated backend validator, capture client and admin labels together. Changes are local until deployed; production history is not backfilled.

## Verification

`server/onboarding-phase3.test.mjs` verifies blocked playback, first-audio qualification, speech deduplication and durations, transcription outcomes, interruption/end versus audio completion, post-home event boundaries, transition cancellation/failure cleanup, metadata bounds and storage-to-admin reading.

`output/playwright/onboarding-events-phase3-check.js` mounts the actual app with synthetic Auth0 context, mocked HTTP and simulated WebRTC/media playback. It verifies the actual capture wiring, a successful voice save waiting for audio drain, the same transport/audio element persisting into home, the app introduction and an explicit hangup before confirmation. No production accounts or paid model requests are used. The existing phase 1/2 browser checks cover manual save, native handoff and responsive admin display, including the new phase 3 labels.

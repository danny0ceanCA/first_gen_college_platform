# Minimal event catalog

Proposed collection contract, October 6, 2026. None of these new durable events are enabled by this document. Existing diagnostics remain troubleshooting logs. Event metadata is potentially personal because it links to accounts, even without content.

## Envelope

| Field | Meaning and validation |
| --- | --- |
| `event_id`, `session_id`, optional `segment_id` | UUIDs; verify session ownership and segment relationship. Producer/session/event uniqueness makes retries idempotent. |
| `name`, `schema_version`, `payload_version` | Versioned allowlist; reject unknown names, fields, oversized strings and payloads. |
| `occurred_at`, `received_at` | Client/server occurrence time with producer identified; received time always server generated. Reject unreasonable client times or label clock skew; never rewrite as verified occurrence. |
| `sequence` | Nonnegative session producer sequence; uniqueness within producer/session. Gaps/out-of-order arrivals recorded, not mistaken for complete history. |
| `producer`, `trust_level`, `environment` | Server/browser/native; server-observed/client-reported/derived; production/preview/test. Set or validate on server. |
| `account_id`, actor role, target reference | Derived from verified account/session scope, never authoritative client fields. Preview has no production account. |
| `configuration_version_id`, `application_revision` | References to known configuration/build when applicable. Missing legacy values remain unknown. |
| `payload` | Event-specific bounded structure below; no names, email, phone, GPA, free text, transcript, raw audio, tokens or arbitrary tool data. |

Use request ID and operation ID for correlation without copying content. Authenticate production ingestion, rate limit, validate authorization and reject forged ownership. An authenticated client event is still a client claim. Preview ingestion, if enabled, gets a separate limited token/budget and short retention; origin checks alone are not authentication.

## Events and authoritative producer

| Event | Producer | Allowed additional fields / interpretation |
| --- | --- | --- |
| `registration.role_selected` | Server after accepted write | Role enum; records selection, not guardianship evidence |
| `onboarding.intro_started` | Client | Intro version, requested language; user initiated playback |
| `onboarding.intro_finished` | Client | Intro version, playback-end reason; does not prove user understood |
| `onboarding.completed` | Server | Required-field schema/version after validated profile state; distinguish replay from first completion |
| `voice.start_requested` | Authenticated server | Guide/topic, client kind, requested language; includes attempts that fail before connection |
| `voice.connected` | Client | Connection duration; observed client transport state, not proof of a useful answer |
| `voice.start_failed` | Server/client | Safe code, phase (permission/token/transport), duration; microphone rejection may be client-only |
| `voice.ended` | Server/client | Reason, server/client status, elapsed duration; close once, retain abnormal termination evidence |
| `guidance.route_changed` | Client | Allowlisted route key only; never pathname query strings or student names |
| `guidance.topic_changed` | Server after accepted change | Previous/new topic, new segment ID; no restart inferred |
| `guidance.target_confirmed` | Server after scope validation | Target kind and authorized reference; not raw spoken name |
| `guidance.language_changed` | Server/client | Previous/new language code, basis user-selection/transcript-detection/model-detection, confidence if available; no speech text |
| `response.started` / `response.finished` / `response.failed` | Server or validated client transport observation | Operation ID, duration, finish reason, safe code; tag observation origin |
| `tool.started` / `tool.finished` / `tool.failed` | Server | Tool/version, operation ID, duration, cache status, source count, safe code |
| `summary.saved` / `summary.save_failed` | Server | Summary reference, segment references, language if known, revision, safe code; saved emitted only after commit |
| `profile.change_confirmed` | Server | Field key, origin, observation reference; no before/after sensitive values in event |
| `plan.step_status_changed` | Server | Plan/step reference, old/new status, revision; emit atomically with write |
| `feedback.submitted` | Server | Instrument/version reference, measurement ID; optional, not transcript sentiment inferred as satisfaction |
| `permission.changed` / `study.withdrawn` | Server | Permission/enrollment evidence reference, purpose and action; restricted audit access |
| `dataset.released` / `dataset.release_blocked` | Research service | Manifest reference, study/version, safe reason; recipients in restricted manifest, not broad logs |

Store domain write and event/outbox row in the same transaction. A relay retries with the same event identity; delivery order may differ. Do not log saved/completed until the corresponding write commits. Client status is supplemented by server timeout reconciliation, with abandonment labeled as inferred. If collection is incomplete, preserve coverage metadata rather than silently dropping the failed cohort.

## Measurement definitions

| Metric | Definition | Limitations |
| --- | --- | --- |
| Voice connection success | Distinct connected production attempts / distinct eligible start requests in a specified period | Publish eligibility, missing observations and platform breakdown. Do not exclude failed starts to improve the rate. |
| Start latency | Time from start request to client connection, per attempt | Cross-clock timing requires alignment; prefer same-clock durations. Report median/p95 and failure rate, not latency alone. |
| Response delay | User-turn completion to first response audio where observable, with measurement basis | Server response creation is not the same as audible playback. Provider/browser gaps remain unknown. |
| Summary persistence success | Committed distinct requested summary saves / distinct save operations | Retries deduplicated. No-save user choice is not a failure. Segment coverage and attribution accuracy are separate checks. |
| Onboarding completion | First validated completion / eligible new accounts in cohort | Intro playback is separate. Define cohort age, role selection and abandoned accounts; do not count previews. |
| Plan progress | Reported step transitions for a defined plan cohort/time window | Not verified academic outcomes; include reopened/deleted steps and changing plan denominator. |
| Language adherence | Rubric-reviewed responses matching the user's active language intent | Language detector alone cannot establish adherence; English proper names/key terms may be appropriate in Spanish. |
| Grounded accuracy | Reviewed factual claims supported by appropriate effective-period sources / reviewed factual claims | Successful retrieval or number of citations is not accuracy. State sample selection and reviewer agreement. |
| Cost per useful session | Versioned estimated/actual provider cost / sessions satisfying a specified usefulness rule | Include failed/tool usage costs; label estimates, currency, price version and unknown usage. No universal usefulness proxy. |

Research outcomes and pre/post instruments require partner-defined questions and appropriate study design. Usage associations do not establish that Origen caused college enrollment or learning gains. Keep unknown, declined, not asked and zero separate. Do not publish small breakdowns simply because the overall cohort is large.

## Required collection tests

Replay, disconnect, reordered events, clock skew, missing events, unauthenticated ingestion, forged segment/student IDs, stale membership, preview exclusion, unknown payload fields, content redaction, retention cutoff and deletion/export coverage. Include English-to-Spanish, multi-topic and multi-student calls. Use synthetic fixtures; do not place production conversations in repository tests.

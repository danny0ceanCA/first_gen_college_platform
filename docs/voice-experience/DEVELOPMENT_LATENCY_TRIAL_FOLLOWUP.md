# Local latency follow-up — November 3, 2026

The production-data test session `3ecae382-4cb1-42f5-9764-8f1eae22a33c` confirmed Phase 4 activation and successful student selection, but exposed long waits in context setup and automatic guide switching. This document contains timings and design decisions only; no transcript or student information is copied here.

## Implemented locally

- Background preparation now has a 35-second deadline, with a conservative 60-second frontend handle lifetime. It still runs without microphone/model access. Failed preparations receive a short cooldown and retry; failure no longer prevents the neutral parent preparation or future refreshes indefinitely.
- The call-start grace period stays bounded. Actual handoff consumes a matching ready preparation only; cold loading remains available when preparation is missing. Server scope, account, revision, policy and permission checks remain authoritative. These changes do not guarantee a cache hit when someone starts immediately after arriving.
- Automatic divider highlights now navigate visually without requesting a specialist/context change. In the observed test, an `applications` highlight triggered an expensive planning-to-admissions update while the user was waiting for a history answer. The existing explicit specialist tool and switch control still perform authenticated updates when needed.
- Same-call Live speech updates omit repeated base style, welcome flow and backchannel instructions. They retain fresh orientation, student scope, adaptive context, delegation policy, capability-gated workflow contracts, and teaching delivery references. The delegated backend still receives its complete instructions and authorized tools. Initial connections and recovered calls still receive full speech instructions.

## Validation

- Unit and regression checks cover stale/incorrect account and student handles, slow preparation beyond seven seconds, retry cooldown, immediate visual following, superseded turns, explicit guide handling, teaching/reference retention and consent contracts.
- Database integration covers fresh prepared context reuse, scope isolation, revision invalidation and confirmed Phase 4 handoff in both languages.
- Production build, logging checks and whitespace checks pass.
- One fictional parent-context speech-update sample measured 15,506 bytes before versus 7,198 bytes after (54% smaller). This is the speech-instruction portion only, not the entire provider request.

Two subsequent paid synthetic voice calls were run within a new $2 cap. See [the live validation results](LIVE_LATENCY_TEST_2026-11-03.md) for measured context timings, transcripts, cost and remaining limitations. Initial context loading over the workstation-to-production database connection can still be slow; these changes remove identified redundant work rather than establishing a response-time guarantee. Nothing in this follow-up is committed or deployed by this task.

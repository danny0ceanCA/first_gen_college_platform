# Native Decisions trigger evaluation

Status: **detached, offline, observe-only, off by default**. No production imports, settings, model selection, intro, voice, delegation or delivery behavior changed. No paid API requests were made by this evaluation. Creating an evaluation configuration does not open a connection.

## What this evaluates

`native-trigger-evaluation.mjs` constructs only a proposed `session.triggers` patch for a known fictional English, Spanish or mixed-language fixture. It observes replayed Live transcript and `decision.event` envelopes. It never appends a cue or executes an action. Tests validate event handling, **not the provider's classification accuracy or a natural spoken conversation**.

| Application-owned checks today | Native experiment |
| --- | --- |
| The application chooses when to call standalone `/decisions`. | Live chooses when to evaluate configured transcript triggers. |
| The application builds the evidence snapshot. | Live uses transcript context plus shared Decision items. |
| The application can reserve a request budget before submitting each request. | A trigger may already be running before its result reaches the application. |
| Explicit request identity and local snapshot revisions identify evidence. | `source_event_id`, `source_event_type`, and the Live-assigned firing ID identify evidence. |
| Existing application relevance and delivery policy remains responsible for safe support. | Native triggers do not replace those policies or prove the user benefited. |

The candidate questions concern explicit needs for a simpler explanation, an example or a first step; explicit resolution; an observed support attempt; and unnecessary repetition. They do not infer needs from first-generation status, income, accent or language. These are **an experimental rubric**, not a calibrated replacement for the existing classifier. Even a high probability is an observation, not permission to change the conversation.

## Contract decisions

- Triggers run independently of delegation. The proposed patch does not replace Responses delegation. It contains at most one trigger for each input/output transcript direction and fewer than the native maximum of 64 questions; standalone Decisions permits up to 400.
- Live selects the native model and trigger IDs. The observer records the provider-reported model without inventing a setting. A trigger ID is treated as a firing ID, not a stable configuration name.
- A filtered WebRTC connection must allow `decision.event` **and** each configured source transcript event. The builder exposes the required event types, without modifying an existing filter.
- The observer requires matching session/student/connection scope and a retained source event of the same direction. It ignores unknown, expired, duplicate, out-of-order and superseded sources. Ordering is independent for input and output. A newer pending correction makes an older result non-current.
- Live may combine pending deltas. A sequence gap is logged as *possible* coalescing, never proof of exact coverage. Transcript fragments remain fragments; timestamps and punctuation do not establish a finished thought.
- Ordered answer names/types/probabilities are validated. Refusals remain refusals. Invalid or missing usage stays unknown. Duplicate envelope/firing IDs cannot double-count usage.
- Diagnostics separate source-to-result elapsed time from unknown provider compute time. No delivery, playback, comprehension or improvement is inferred from classification. No transcript text is retained or logged by the observer.
- Omit `triggers` on update to preserve the current configuration; an empty list disables them. This module sends neither update. Shared `decision.item.create` context is distinct from Live frontend context; no shared item or voice append is issued here.

## Bounds and spending

Explicit isolation and a fixture ID from the module's fixed fictional inventory are required. An adapter cannot establish that arbitrary external audio is fictional; any future runner must actually use that verified fixture and an isolated session. A known fixture is not authorization to send real account data.

The observer bounds duration, received Decision count, retained sources, duplicate-ID storage and source age. `tick()` and stop records report when a future transport must disable triggers/close its isolated test session. There is no hidden timer, transport, retry or background service in this module. Stop records alone do not disable provider work.

**These limits do not implement a hard dollar cap.** Native work is initiated by the provider before our application sees completion. In-flight results can arrive after a disable request; usage here covers only unique completions received before the evaluation stops. A future paid runner must obtain explicit test authorization, reserve an appropriate allowance including voice and in-flight work, enforce a watchdog, disable/close on limits, drain final usage, and reconcile billing separately. Until that exists and a paid trial is approved, native mode stays off. A project budget notification should not be described as a per-request stop guarantee.

## Verification and next comparison

Run:

```powershell
node --test research/decisions/local-call/native-trigger-evaluation.test.mjs
```

The 15 offline tests cover English/Spanish/mixed fixtures, isolated opt-in, configuration separation, source correlation, independent directions, possible coalescing, out-of-order results, a newer correction, unknown and evicted sources, duplicate usage, scope changes, expiry, refusals, malformed probabilities/usage, bounded storage/duration/count, and logging failures.

A later approved provider comparison must use identical fictional scenarios for application scheduling versus native observation. Compare classification precision/recall, relevant-result availability, request frequency, refusals, cost and source-to-result timing. Native observation alone cannot measure spoken adaptation. A separate delivery trial would have to measure transcript responsiveness, browser playback and subsequent caller understanding while preserving the existing intro and natural flow.

## Library review and official sources

The assigned API partition was reviewed before this module was edited: Responses manifest indices 0, 1, 6–17 and 39–44; Decisions indices 17–29. Generated schemas were compared for exact repeated lines and **all 7,180 unique nonblank contract lines** were read, with truncated output reread. Full structural sections for Decisions creation, native triggers, native event envelopes and continuation were checked separately. This records unique-content coverage, not a claim that every repeated schema alias was reread. No assigned document was unavailable. Other library guide partitions were reviewed by the task's other agents before the edit gate.

The following current official pages were verified on 2026-11-08 and compared with the saved contracts:

- [Connect voice to Decisions](https://developers.openai.com/api/docs/guides/decisions-voice): native source correlation, combined pending deltas, independent directions, event filters and trigger independence.
- [Create a Live session](https://developers.openai.com/api/reference/resources/live/methods/create): `session.triggers`, replace/disable semantics, question limit and shared Decision context.
- Saved full [Live primary WebSocket reference](https://developers.openai.com/api/reference/resources/live/primary-websocket): `decision.event`, ordered answers, firing IDs, transcript fragments, append acknowledgment and session lifecycle contracts.
- Saved [Decisions reference](https://developers.openai.com/api/reference/resources/decisions): standalone question/response and usage contracts. Standalone Decisions, standalone Responses continuation, persistent Conversations storage and Live session state are kept distinct.

The broader task separately verified current Live prompting/delegation/conversation guidance. The libraries remain development references and are not included in runtime model context.

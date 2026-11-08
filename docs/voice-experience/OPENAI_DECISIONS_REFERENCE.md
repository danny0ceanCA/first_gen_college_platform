# OpenAI Decisions reference

Saved for Daniel on November 7, 2026 (America/Los_Angeles) to support evaluation
of Decisions alongside Origen's existing Live and Responses architecture.

The [Decisions documentation library](decisions/README.md) contains full official
Markdown snapshots, including SDK and event contracts. Use its
[inventory](decisions/INVENTORY.md) as the reading checklist and
[manifest](decisions/manifest.json) to check sources, retrieval dates and hashes.

## Official starting points

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [Connect voice to Decisions](https://developers.openai.com/api/docs/guides/decisions-voice)
- [Create a decision](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [Python reference](https://developers.openai.com/api/reference/python/resources/decisions)
- [TypeScript reference](https://developers.openai.com/api/reference/typescript/resources/decisions)
- [CLI reference](https://developers.openai.com/api/reference/cli/resources/decisions)
- [Live session creation](https://developers.openai.com/api/reference/resources/live/methods/create)
- [Live primary WebSocket](https://developers.openai.com/api/reference/resources/live/primary-websocket)
- [Live sideband WebSocket](https://developers.openai.com/api/reference/resources/live/sideband-websocket)
- [Decisions usage reporting](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/decisions)

## Local interpretation, not official requirements

Decisions is an option for narrowly defined classifications such as an explicit
request for starting-point help. Responses handles generated explanations,
structured extraction and tool workflows. The documentation describes combining
them; it does not establish that adding Decisions will improve Origen's natural
conversation or replace the current research worker.

A future evaluation should first observe classifications without steering
speech, compare them with labeled English and Spanish conversations, and measure
missed cues, false triggers, lateness, repetition, latency and cost. Preserve the
existing intro and let Origen continue when optional checks are slow or fail.

This document and the snapshots do not activate any API integration. Consult
current official guidance before implementation; saved documentation can age.

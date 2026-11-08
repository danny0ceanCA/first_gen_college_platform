# OpenAI Decisions documentation library

Official Markdown snapshots for the Decisions API, its GPT-Live integration,
endpoint schemas, SDK examples, usage reporting, and directly linked supporting
guidance. This is a development reference library, not runtime model context.

**Initial snapshot: 30 official pages retrieved November 8, 2026 UTC
(November 7 in Los Angeles).** See [the complete inventory](INVENTORY.md) and
[manifest.json](manifest.json) for individual sources, timestamps, file sizes,
SHA-256 checksums, and download failures. Full official text and examples are
saved under `pages/`; local notes are kept separate from those snapshots.

## Start here

| Read | What it covers |
| --- | --- |
| [Decisions guide](pages/api/docs/guides/decisions.md) | Predicate, choice and score questions; inputs; probabilities; thresholds; caching; usage and data handling. |
| [Connect voice to Decisions](pages/api/docs/guides/decisions-voice.md) | Native delegation, transcript triggers, event correlation, Responses handoff and stale results. |
| [Create decision contract](pages/api/reference/resources/decisions/methods/create.md) | Complete request and response schema. |
| [Python reference](pages/api/reference/python/resources/decisions.md) | Python SDK types and examples. |
| [TypeScript reference](pages/api/reference/typescript/resources/decisions.md) | TypeScript SDK types and examples. |
| [CLI reference](pages/api/reference/cli/resources/decisions.md) | Command-line usage and parameter contracts. |
| [Organization usage](pages/api/reference/resources/admin/subresources/organization/subresources/usage/methods/decisions.md) | Decisions usage reporting endpoint. |
| [Live session creation](pages/api/reference/resources/live/methods/create.md) | Delegation configuration and transcript-trigger schemas. |
| [Primary WebSocket](pages/api/reference/resources/live/primary-websocket.md) | Commands, decision events and acknowledgments. |
| [Sideband WebSocket](pages/api/reference/resources/live/sideband-websocket.md) | Server-side control contracts. |

Supporting snapshots include Live prompting, delegation, sessions, WebRTC,
voice agents, latency, caching, structured outputs, function calling, data
controls, Private Link, and pricing. Pricing and availability are dated
references: verify the current official page before making a configuration or
cost decision.

## Coverage and boundaries

The downloader checks both official documentation indexes, explicitly seeds
the Decisions guides and language references, follows Decisions-specific links,
and downloads official API documentation directly linked by Decisions pages.
Explicit seeds matter because the current official indexes do not list every
Decisions page. The manifest records index discovery separately.

This is the complete captured Decisions scope described above, not a mirror of
the entire OpenAI website or a claim that every possible SDK-language variant
exists locally. Python, TypeScript and CLI references are included. If a source
cannot be retrieved, the refresh exits unsuccessfully and records it rather than
silently treating the library as complete.

## Refresh and verify

From the repository root, with Python 3 and network access:

```sh
python docs/voice-experience/decisions/refresh.py
```

Verify the saved files offline:

```sh
python docs/voice-experience/decisions/refresh.py --verify
```

The refresh preserves earlier successful snapshots when a source fails, records
failures in the manifest, and regenerates the inventory. A successful integrity
check verifies file hashes and detects missing or unlisted snapshots. It does
not establish that the API will accept a particular application configuration.

## Origen development boundaries

- Keep Decisions classification, standalone Responses requests, and Live
  delegation/event contracts distinct.
- Decisions returns classifications or scores. Our application remains
  responsible for actions, permissions and task state.
- Transcript-triggered checks run independently of delegation. Switching the
  session's delegation type is a separate architectural choice.
- Transcript fragments can be incomplete; results can arrive out of order.
  Match results to their source events and ignore outdated guidance.
- Confidence is not proof. Evaluate thresholds on labeled English and Spanish
  examples, including corrections, short acknowledgments and mixed language.
- Preserve natural conversation: ordinary speech must not wait for an optional
  classification, and a classification must not force a repeated or interrupting
  announcement.
- Keep transcript evidence distinct from audio playback evidence.
- Do not infer a live implementation, enabled flag, new worker, production
  change, or model capability from the presence of this library.

See the [saved Decisions reference](../OPENAI_DECISIONS_REFERENCE.md) and the
[existing Responses library](../responses/README.md).

For state and continuation contracts, see the [conversation-state library](../conversation-state/README.md).

## Local integration proposal

The [v1.3 Decisions integration proposal](../DECISIONS_INTEGRATION_PROPOSAL_V1_3.md)
contains Origen's phased design, read-only code comparison, and links to the
two-pass review records. It is local engineering analysis, separate from the
official snapshots, and does not enable an integration.

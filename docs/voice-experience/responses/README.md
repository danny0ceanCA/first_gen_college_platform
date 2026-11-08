# Responses documentation library

For Decisions classifications and their Live integration, see the separate [Decisions documentation library](../decisions/README.md).

For state, response continuation, Conversations endpoints and compaction, see the [conversation-state library](../conversation-state/README.md).

See [Live Measurement Plan](LIVE_MEASUREMENT_PLAN.md) for implemented telemetry, report commands, limitations, and review templates.

## Living audit

See [Live Configuration Audit](LIVE_CONFIGURATION_AUDIT.md) for source-backed findings about Origen's Live architecture and natural conversation configuration. This local working document is separate from the 45 official documentation snapshots below.

Official Markdown snapshots for the [Responses overview](https://developers.openai.com/api/reference/responses/overview), [Python Responses reference](https://developers.openai.com/api/reference/python/resources/responses), their Responses reference subpages, and the related guides selected in [Origen's saved reference](../OPENAI_RESPONSES_REFERENCE.md).

**Status: 45 official Markdown pages saved on November 6, 2026.** Source URLs, timestamps, and checksums are recorded in [manifest.json](manifest.json). Older `/docs/` links map to `/api/docs/`; the images guide is now `images-vision`.

## Saved pages

- [api/docs/guides/background.md](pages/api/docs/guides/background.md)
- [api/docs/guides/conversation-state.md](pages/api/docs/guides/conversation-state.md)
- [api/docs/guides/fast-mode.md](pages/api/docs/guides/fast-mode.md)
- [api/docs/guides/file-inputs.md](pages/api/docs/guides/file-inputs.md)
- [api/docs/guides/flex-processing.md](pages/api/docs/guides/flex-processing.md)
- [api/docs/guides/function-calling.md](pages/api/docs/guides/function-calling.md)
- [api/docs/guides/images-vision.md](pages/api/docs/guides/images-vision.md)
- [api/docs/guides/live-conversations.md](pages/api/docs/guides/live-conversations.md)
- [api/docs/guides/live-delegation.md](pages/api/docs/guides/live-delegation.md)
- [api/docs/guides/live-prompting.md](pages/api/docs/guides/live-prompting.md)
- [api/docs/guides/prompt-caching.md](pages/api/docs/guides/prompt-caching.md)
- [api/docs/guides/reasoning.md](pages/api/docs/guides/reasoning.md)
- [api/docs/guides/safety-best-practices.md](pages/api/docs/guides/safety-best-practices.md)
- [api/docs/guides/streaming-responses.md](pages/api/docs/guides/streaming-responses.md)
- [api/docs/guides/structured-outputs.md](pages/api/docs/guides/structured-outputs.md)
- [api/docs/guides/text.md](pages/api/docs/guides/text.md)
- [api/docs/guides/tools-computer-use.md](pages/api/docs/guides/tools-computer-use.md)
- [api/docs/guides/tools-connectors-mcp.md](pages/api/docs/guides/tools-connectors-mcp.md)
- [api/docs/guides/tools-file-search.md](pages/api/docs/guides/tools-file-search.md)
- [api/docs/guides/tools-web-search.md](pages/api/docs/guides/tools-web-search.md)
- [api/docs/guides/tools.md](pages/api/docs/guides/tools.md)
- [api/docs/guides/voice-server-controls.md](pages/api/docs/guides/voice-server-controls.md)
- [api/docs/guides/websocket-mode.md](pages/api/docs/guides/websocket-mode.md)
- [api/docs/guides/your-data.md](pages/api/docs/guides/your-data.md)
- [api/docs/quickstart.md](pages/api/docs/quickstart.md)
- [api/reference/python/resources/responses.md](pages/api/reference/python/resources/responses.md)
- [api/reference/resources/beta/subresources/responses/streaming-events.md](pages/api/reference/resources/beta/subresources/responses/streaming-events.md)
- [api/reference/resources/beta/subresources/responses/websocket-events.md](pages/api/reference/resources/beta/subresources/responses/websocket-events.md)
- [api/reference/resources/conversations.md](pages/api/reference/resources/conversations.md)
- [api/reference/resources/conversations/methods/create.md](pages/api/reference/resources/conversations/methods/create.md)
- [api/reference/resources/conversations/methods/delete.md](pages/api/reference/resources/conversations/methods/delete.md)
- [api/reference/resources/conversations/methods/retrieve.md](pages/api/reference/resources/conversations/methods/retrieve.md)
- [api/reference/resources/conversations/methods/update.md](pages/api/reference/resources/conversations/methods/update.md)
- [api/reference/resources/conversations/subresources/items/methods/list.md](pages/api/reference/resources/conversations/subresources/items/methods/list.md)
- [api/reference/resources/responses.md](pages/api/reference/resources/responses.md)
- [api/reference/resources/responses/methods/cancel.md](pages/api/reference/resources/responses/methods/cancel.md)
- [api/reference/resources/responses/methods/compact.md](pages/api/reference/resources/responses/methods/compact.md)
- [api/reference/resources/responses/methods/create.md](pages/api/reference/resources/responses/methods/create.md)
- [api/reference/resources/responses/methods/delete.md](pages/api/reference/resources/responses/methods/delete.md)
- [api/reference/resources/responses/methods/retrieve.md](pages/api/reference/resources/responses/methods/retrieve.md)
- [api/reference/resources/responses/streaming-events.md](pages/api/reference/resources/responses/streaming-events.md)
- [api/reference/resources/responses/subresources/input_items/methods/list.md](pages/api/reference/resources/responses/subresources/input_items/methods/list.md)
- [api/reference/resources/responses/subresources/input_tokens.md](pages/api/reference/resources/responses/subresources/input_tokens.md)
- [api/reference/resources/responses/websocket-events.md](pages/api/reference/resources/responses/websocket-events.md)
- [api/reference/responses/overview.md](pages/api/reference/responses/overview.md)

## Refresh

With network access to `developers.openai.com`, run from the repository root:

```sh
python3 docs/voice-experience/responses/refresh.py
```

The downloader preserves official Markdown under `pages/`, following the source URL hierarchy. `manifest.json` records source URLs, resolved download URLs, retrieval timestamps, SHA-256 checksums, and download failures. A failed refresh exits with an error and preserves previously downloaded files and their successful records. It follows Responses reference links and the overview's related guides, rather than recursively mirroring the entire OpenAI documentation site.

Read the relevant pages as needed; do not load the whole library into every conversation. Snapshots may become stale: verify current official guidance before changing API contracts. Responses and Live delegation have different event contracts; consult both when working on Origen's voice integration.

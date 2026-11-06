# Live model work

Use `v1.1` as the baseline for future live conversation work. Keep `v1` as a historical reference.

Before modifying Origen's live conversation, delegation, research tools, context delivery, or Responses integration, read [the saved OpenAI Responses reference](docs/voice-experience/OPENAI_RESPONSES_REFERENCE.md) and consult the relevant current official guidance linked there. Compare that guidance with the existing implementation before making changes.

Whenever working on Origen's live model or on injecting, supplying, retrieving, or delivering data or context to it, thoroughly read and review **all 45 Markdown documentation pages** in the [Responses documentation library](docs/voice-experience/responses/README.md) before making changes. Use the [manifest](docs/voice-experience/responses/manifest.json) as the complete page checklist; reviewing only the index, summaries, or selected pages does not satisfy this requirement. If the library grows, review every page in the updated manifest. Apply the documented API contracts, event semantics, tool behavior, conversation state, and data-handling guidance to the existing implementation, keeping standalone Responses and Live delegation contracts distinct. Verify relevant current official guidance when the saved snapshots may be outdated. This review is development preparation; do not inject the documentation library into the live model's runtime context unless explicitly requested.

Preserve natural, warm conversation while background research runs. Reuse relevant existing context and completed research; avoid unnecessary lookups or conversation-blocking work.

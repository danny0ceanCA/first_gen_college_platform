# OpenAI conversation-state documentation library

Full official OpenAI Markdown snapshots about conversation state, Conversations
API objects and items, response chaining, compaction, and related Live state
contracts. All guidance under `pages/` comes from `developers.openai.com`.
This index and the downloader are local navigation and maintenance files.

**Initial collection: 35 official pages, retrieved November 7, 2026 in
America/Los_Angeles (November 8 UTC).** The [inventory](INVENTORY.md) lists every
saved page and official link. The [manifest](manifest.json) records source URLs,
retrieval times, checksums, byte sizes, discovery sources, and failures.

## Official starting points

| Topic | Saved official page | Current official page |
| --- | --- | --- |
| Conversation state | [Guide](pages/api/docs/guides/conversation-state.md) | [OpenAI](https://developers.openai.com/api/docs/guides/conversation-state) |
| Compaction | [Guide](pages/api/docs/guides/compaction.md) | [OpenAI](https://developers.openai.com/api/docs/guides/compaction) |
| Preserved reasoning | [Guide](pages/api/docs/guides/preserved-reasoning.md) | [OpenAI](https://developers.openai.com/api/docs/guides/preserved-reasoning) |
| Conversations endpoints | [Reference](pages/api/reference/resources/conversations.md) | [OpenAI](https://developers.openai.com/api/reference/resources/conversations) |
| Python SDK | [Reference](pages/api/reference/python/resources/conversations.md) | [OpenAI](https://developers.openai.com/api/reference/python/resources/conversations) |
| TypeScript SDK | [Reference](pages/api/reference/typescript/resources/conversations.md) | [OpenAI](https://developers.openai.com/api/reference/typescript/resources/conversations) |
| Responses creation | [Contract](pages/api/reference/resources/responses/methods/create.md) | [OpenAI](https://developers.openai.com/api/reference/resources/responses/methods/create) |
| WebSocket continuation | [Guide](pages/api/docs/guides/websocket-mode.md) | [OpenAI](https://developers.openai.com/api/docs/guides/websocket-mode) |
| Live conversations | [Guide](pages/api/docs/guides/live-conversations.md) | [OpenAI](https://developers.openai.com/api/docs/guides/live-conversations) |
| Live delegation | [Guide](pages/api/docs/guides/live-delegation.md) | [OpenAI](https://developers.openai.com/api/docs/guides/live-delegation) |
| Data handling | [Guide](pages/api/docs/guides/your-data.md) | [OpenAI](https://developers.openai.com/api/docs/guides/your-data) |

The inventory also includes create/retrieve/update/delete conversation methods,
create/retrieve/list/delete item methods, and supporting pages linked from the
state guides and Conversations references. It is a scoped collection, not a
mirror of the whole OpenAI documentation website. Original source links inside
snapshots are preserved.

## Maintenance

Run from the repository root with Python 3:

```sh
python docs/voice-experience/conversation-state/refresh.py
python docs/voice-experience/conversation-state/refresh.py --verify
```

Refresh requires network access, downloads official Markdown, and regenerates
the inventory and manifest. Failed downloads preserve earlier successful files,
are recorded, and cause a failing exit status. Offline verification checks file
hashes, missing files, unlisted snapshots, and unresolved download failures.

Snapshots are dated references. Consult current official guidance when using
an API contract. Saving this collection does not enable a Conversations API
integration or change application state or model behavior.

Related libraries: [Responses](../responses/README.md) and
[Decisions](../decisions/README.md).

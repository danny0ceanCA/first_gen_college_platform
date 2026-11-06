# Responses Overview

Source: [OpenAI Responses overview](https://developers.openai.com/api/reference/responses/overview)

Reference supplied by Daniel on November 5, 2026, for consultation when working on Origen's live conversation and backend research integration. This saved excerpt is a reference snapshot; consult the current official documentation before changing API contracts.

> For the complete documentation index, see [llms.txt](https://developers.openai.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

OpenAI's most advanced interface for generating model responses. Supports
text and image inputs, and text outputs. Create stateful interactions
with the model, using the output of previous responses as input. Extend
the model's capabilities with built-in tools for file search, web search,
computer use, and more. Allow the model access to external systems and data
using function calling.

Related guides:

- [Quickstart](https://developers.openai.com/docs/quickstart?api-mode=responses)
- [Text inputs and outputs](https://developers.openai.com/docs/guides/text?api-mode=responses)
- [Image inputs](https://developers.openai.com/docs/guides/images?api-mode=responses)
- [Structured Outputs](https://developers.openai.com/docs/guides/structured-outputs?api-mode=responses)
- [Function calling](https://developers.openai.com/docs/guides/function-calling?api-mode=responses)
- [Conversation state](https://developers.openai.com/docs/guides/conversation-state?api-mode=responses)
- [WebSocket mode](https://developers.openai.com/docs/guides/websocket-mode)
- [Extend the models with tools](https://developers.openai.com/docs/guides/tools?api-mode=responses)

## Related Live guidance

Consult these alongside the Responses overview when changing the voice integration:

- [Delegation and tools in GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation)
- [Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting)
- [Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations)
- [Voice server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)

Origen's priority is natural, warm conversation while research happens in the background. Review the current implementation and these references together; the standalone Responses API and Live's managed Responses delegation do not have interchangeable event contracts.

## Local documentation library

See the [Responses documentation library](responses/README.md) for the official Markdown snapshot workflow, including the Python Responses reference. The library contains downloaded official pages; consult its manifest for sources and retrieval dates.

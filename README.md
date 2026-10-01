# Camino — family college planning UI

Interactive React + TypeScript prototype for the product planned in this conversation. **Camino is a working name.**

## Live guidance connection

The embedded Next Steps chat now uses the OpenAI Responses API with `gpt-6-luna`, through a loopback-only Vite server endpoint at `/api/chat`. Add `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-6-luna` in the Git-ignored `.env.local`, then run `npm run dev`. Restart after changing server credentials. `OPENAI_MODEL_CONVERSATION` optionally overrides the conversation model independently. No key is delivered to the browser. API requests use `store:false`.

The chat sends the selected student's context, selected topic, and conversation history to OpenAI only on submission. It starts with no canned messages. Chats remain in memory and reset on refresh. Opportunity research is also live; college research and other demo features remain simulated.

This local API is available with the Vite development and preview servers; deploying the static `dist` folder alone does not provide a backend. It is deliberately restricted to localhost and must be replaced with an authenticated production backend before external use. College search, bookings, and the community remain demonstrations. The floating legacy conversation elsewhere in the prototype still uses the demo adapter.

Validation: `node --test server/ai.test.mjs` checks request validation, origin rejection, secret-safe failures, model selection and conversation roles. A live API smoke test and a temporary browser conversation successfully returned Astra responses. The test conversation tab was closed after verification.

## Run

```sh
npm install
npm run dev
```

`npm run build` checks TypeScript and produces a production bundle in `dist/`.

## Try the experience

- Switch between parent and student using the sidebar. Their language preferences are independent.
- Switch between Sofía (high school) and Mateo (community college), or add a student through the four-step onboarding flow. GPA is optional; there is no weighted/unweighted question.
- Open the roadmap, complete starter actions, read plain-language learning cards, and explore example research directions.
- Save an idea, share it with a selected student and optional note, switch to student, and open Explore → Saved & shared to react.
- Use the profile button to enable broad learning-topic sharing and preview the student view. Topic sharing is off initially.
- Review the college-cost example, application checklist, external material links, and scheduling UI.

## What is real in this prototype

Navigation, responsive layouts, English/Spanish content, child creation, checklists, sample sharing, reactions, optional topic visibility, and appointment selection are interactive in memory. Sample data is labeled. Reloading resets it. Material links currently reset when leaving their view or changing student; they are not uploaded or stored.

The parent/student toggle is a design preview, **not authentication or access control**. Production must enforce separate identities and student/family permissions on the server. No real messages or invitations are sent. No appointments are booked. No real phone login is implemented.

## OpenAI integration boundary

`src/ai.ts` defines a purpose-based `AIGateway`: `conversation`, `college-research`, and `opportunity-search`. Conversation and opportunity research route through the server to Astra by default. College research uses the demo adapter. Never put API keys in the browser.

Opportunity research is user-initiated from chat or Explore → Fresh opportunities. In chat, Camino invokes a server-side search tool when the user requests local opportunities and a location is known. It asks for location if missing; unspecified interests, distance, schedule, and pay use explicitly broad search defaults rather than blocking research. There is no separate search button or form in chat. Cited results appear in the same conversation and are included in follow-up context. Explore remains a standalone search entry point. Parents review interests, city/ZIP, distance, availability, opportunity type, and pay preferences before searching. The Responses API uses web_search with medium reasoning and renders linked citations, eligibility, deadlines, uncertainty, and the search timestamp. OPENAI_MODEL_OPPORTUNITIES optionally overrides the research model. Chat uses low reasoning. Results and forms are separated by student and preview role in memory; refreshing clears them. Searches require a completed web search and usable citations.

## Product boundaries retained

- California high school and community college pathways; fit and affordability first.
- Multiple students per parent, optional family participation, and independent language preferences.
- Share discoveries, rather than assigning students tasks.
- Broad topics explored can be shared with consent; private questions and financial data are excluded.
- No essay drafting, admissions scores, admission guarantees, or application submission.
- Coaching scheduling is a supporting area.

## Next implementation layers

### Dashboard revision: guidance and community

Family Home keeps the student count and student cards, without the aggregate completion/saved/shared metrics, application-preparation status, GPA scale caption, upcoming panel, or family-sharing panel. The expanded Next Steps area accepts student-specific questions and parent context. In-memory notes, drafts, and conversations are separated by student and preview role and survive navigation until refresh. Guidance responses are live; the gateway sends profile context and conversation history to the server.

Discussion Board is an interactive local prototype with category filters, new discussions, replies, and individual @member mentions. It stays separate from private guidance and does not publish anything or send notifications. Before enabling a real community, implement authenticated membership, persistent posts, reporting/moderation, and mention notification controls. No mass-tagging behavior is implemented.

Persist confirmed profiles and family relationships; add real authentication/invitations and role enforcement; implement student-first onboarding and a profile editor; add verified curriculum/recommendation logic; wire purpose-specific AI services and source verification; connect actual coach availability and booking. Onboarding concerns are captured for preview but do not yet personalize recommendations beyond student stage. Draft documents remain outside the app.

Financial terminology is based on [Federal Student Aid](https://studentaid.gov/articles/financial-aid-dictionary/). The cost comparison uses fictional figures, not an aid estimate.

## Validation

TypeScript/production build; browser smoke checks for onboarding without GPA, sharing a discovery with a note, student reactions, sample scheduling, and responsive layouts. No browser console errors were reported during those flows.


## Student profiles and personalized roadmaps

Expand a student card and choose Edit profile, or edit from Student roadmap. Profiles include institution checkboxes, intended entry term, school, GPA, interests, activities, goals and practical needs. Profiles and accepted roadmap steps persist in this browser using localStorage; this is not authenticated cloud storage or cross-device sync. Chat histories still reset on refresh.

Build my plan with AI sends the current profile to the server. With institutions selected, the model researches official sources and returns structured suggestions, source links and cycle-specific deadlines when verified. Unknown entry terms or unpublished deadlines must remain undated. Families accept suggestions individually; rebuilding does not overwrite accepted work. Steps support editable titles, actions, rationale, personal dates, notes and progress. Homepage progress reflects accepted roadmap steps. Chat messages can be reviewed for profile notes or as roadmap steps before saving.

Validation: production build, nine server tests, browser checks of profile/roadmap navigation, and a live institution-specific roadmap request.


## Profile-only page revision
The former roadmap page is now Student profiles. It displays saved student details and institutions with an Edit profile action. Plan generation, suggestion review, step editing and progress controls are removed from the UI. Previously stored plan data is retained but is not displayed. AI chat retains the option to review parent-provided information for the profile.

### Live profile conversation
Family home > expand a student > Edit profile > Start live conversation.
Uses OpenAI Realtime over WebRTC, with the API key remaining in the local server.
Optional server-only OPENAI_MODEL_VOICE overrides the default gpt-realtime-2.1.
Microphone access is requested only after Start. Audio/profile data goes to OpenAI;
Camino does not store recordings. Transcripts and proposals exist only in this editor
session. End the conversation, review/edit/remove proposals, add them to the form,
then Save profile to persist locally. Switching page/student/language/role closes
microphone tracks and the peer connection. Sessions end after 10 minutes; voice is
billed separately from Astra text chat. This local-only endpoint must be protected
with user authentication and quotas before any public deployment.
Validation: npm run build; node --test server/*.test.mjs. Live microphone/audio
playback requires testing in the user's browser with their permission and API access.

Paying for college includes a bilingual live voice explainer with a separate finance teaching prompt, no profile-editing tools, and limited student context. It ends when leaving the page or switching students/language/role. Finance voice can now call /api/finance-research for official FSA and institution information. FSA searches are domain-restricted; college citations must use HTTPS .edu pages (or FSA). The spoken assistant must verify the institution and distinguish year, residency and housing. Sources and retrieval dates appear alongside voice. There is no application lookup-count cap; provider quotas and the existing 10-minute session duration still apply. Each lookup uses billed Responses API web search and model tokens. OPENAI_MODEL_FINANCE_RESEARCH optionally overrides the research model. This is a localhost-only endpoint, like the voice session endpoint. Teaching references: https://studentaid.gov/articles/financial-aid-dictionary/ and https://studentaid.gov/articles/fafsa-student-steps/.


Voice diagnostics are saved locally in `.camino-logs/voice.jsonl` (ignored by Git), with one rotated backup after approximately 2 MB. Events include a random session ID, client sequence number, operation, error code/parameter, upstream request ID, HTTP status and timing. Audio, transcripts, student profiles, search queries and API keys are excluded. The voice panel exposes its diagnostic session ID. Logging starts with a new voice session; the log does not reconstruct earlier errors. Finance speech speed is 0.95.

Model routing: general text guidance defaults to `gpt-6-luna`. Finance, opportunity and roadmap research default to `gpt-6.1-sol`, configured independently through `OPENAI_MODEL_RESEARCH`. `OPENAI_MODEL_FINANCE_RESEARCH` and `OPENAI_MODEL_OPPORTUNITIES` take precedence for their services. `OPENAI_MODEL` is the general conversation fallback, so changing it does not downgrade research. Live voice remains `gpt-realtime-2.1`; transcription remains `gpt-4o-mini-transcribe`.

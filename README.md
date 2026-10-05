# Origen — family college planning UI

Interactive React + TypeScript prototype for the product planned in this conversation. **Origen is a working name.**

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

Opportunity research is user-initiated from chat or Explore → Fresh opportunities. In chat, Origen invokes a server-side search tool when the user requests local opportunities and a location is known. It asks for location if missing; unspecified interests, distance, schedule, and pay use explicitly broad search defaults rather than blocking research. There is no separate search button or form in chat. Cited results appear in the same conversation and are included in follow-up context. Explore remains a standalone search entry point. Parents review interests, city/ZIP, distance, availability, opportunity type, and pay preferences before searching. The Responses API uses web_search with medium reasoning and renders linked citations, eligibility, deadlines, uncertainty, and the search timestamp. OPENAI_MODEL_OPPORTUNITIES optionally overrides the research model. Chat uses low reasoning. Results and forms are separated by student and preview role in memory; refreshing clears them. Searches require a completed web search and usable citations.

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

### Live voice conversations
The web app has separate guides for college costs, applications and planning, plus profile onboarding. Specialist calls stay active while navigating within the family app. The fixed voice bar provides mute, end, student confirmation and expandable details; idle starts use the current student, role and interface language. Profile onboarding remains tied to its form and ends when that form closes. Sign-out, leaving the family app and refreshing end calls. Sessions are limited to ten minutes per connection.

Set server-only OPENAI_MODEL_VOICE to override the default gpt-realtime-2.1. OpenAI credentials stay on the server. All new conversations begin with Hola, then continue in the selected language. Spanish explanations may name English terms without changing languages. Parent guides require confirmation before using a student's private context or saving a targeted summary.

Microphone audio goes to OpenAI through WebRTC. Raw transcripts and pending save jobs stay in memory; summaries are saved to PostgreSQL for signed-in accounts or browser storage for previews. Failed jobs can be retried while the app remains open; refreshing loses pending jobs. Profile suggestions require review and explicit saving. Native live voice remains pending. See RENDER_SETUP.md for production authentication, origin restrictions, quotas, diagnostics and the optional production voice-preview configuration.

Validation: npm run build; node --test server/*.test.mjs. Live microphone/audio
playback requires testing in the user's browser with their permission and API access.

Paying for college includes a bilingual live voice explainer with a separate finance teaching prompt, no profile-editing tools, and limited student context. It stays active across family-app navigation; confirmed student changes reconnect into a separate segment. Finance voice can now call /api/finance-research for official FSA and institution information. FSA searches are domain-restricted; college citations must use HTTPS .edu pages (or FSA). The spoken assistant must verify the institution and distinguish year, residency and housing. Sources and retrieval dates appear alongside voice. There is no application lookup-count cap; provider quotas and the existing 10-minute session duration still apply. Each lookup uses billed Responses API web search and model tokens. OPENAI_MODEL_FINANCE_RESEARCH optionally overrides the research model. The deployed API requires authentication, except for explicitly enabled voice previews. Teaching references: https://studentaid.gov/articles/financial-aid-dictionary/ and https://studentaid.gov/articles/fafsa-student-steps/.


Voice diagnostics are saved locally in `.camino-logs/voice.jsonl` (ignored by Git), with one rotated backup after approximately 2 MB. Events include a random session ID, client sequence number, operation, error code/parameter, upstream request ID, HTTP status and timing. Audio, transcripts, student profiles, search queries and API keys are excluded. The voice panel exposes its diagnostic session ID. Logging starts with a new voice session; the log does not reconstruct earlier errors. Finance speech speed is 0.95.

Model routing: general text guidance defaults to `gpt-6-luna`. Finance, opportunity and roadmap research default to `gpt-6.1-sol`, configured independently through `OPENAI_MODEL_RESEARCH`. `OPENAI_MODEL_FINANCE_RESEARCH` and `OPENAI_MODEL_OPPORTUNITIES` take precedence for their services. `OPENAI_MODEL` is the general conversation fallback, so changing it does not downgrade research. Live voice remains `gpt-realtime-2.1`; transcription remains `gpt-4o-mini-transcribe`.

Ready to apply for college includes an English/Spanish live admissions guide using `gpt-realtime-2.1` with server VAD and transcript-gated replies. Its `lookup_college_applications` tool calls `/api/admissions-research`, using `gpt-6.1-sol` (override: `OPENAI_MODEL_ADMISSIONS_RESEARCH`) to verify official application requirements and return citations. It shares only name, stage, institutions and entry term, never edits profiles or submits applications, and stays active across family-app navigation without silently changing guides or student context. Sessions remain limited to 10 minutes. Diagnostics accept both current `X-Origen-Session` and legacy `X-Camino-Session` headers.


## Native iPhone and Android app

The Expo/React Native project lives in `mobile/`. It is a native implementation, separate from the `#mobile-design` browser mockup. Run `npm run mobile` from the repository root for the Expo device QR code, or `npm run mobile:web` for the browser version of the native components. See [mobile/README.md](mobile/README.md) for implemented features, checks, and pending voice/authentication integration.

## Landing outreach and contact

The landing includes English/Spanish sharing text, copy buttons, sample-preview guidance, and a source-backed privacy overview. The Contact section and footer link use the approved public inbox `daniel@origenedu.ai`. Set `VITE_PUBLIC_CONTACT_EMAIL` to override it. This value is public and is included in the frontend bundle; rebuild after changing it. An invalid override hides Contact rather than pointing visitors to an unavailable destination. The overview should be checked against actual production configuration before publication.

Social previews use `public/social-preview.png` and metadata in `index.html`. Section links work on initial loads and hash navigation; the illustrated story remains under `#story`.

Loans: the web app (including mobile browsers) has a dedicated Loans guide using the financial-aid research endpoint restricted to Federal Student Aid. Summaries use mode `loans`; apply migration 012 before deploying the API. No new model credential is needed. Native mobile parity remains pending.

Voice experience: the persistent web voice bar displays listening, answer preparation, audio playback, research and confirmation states. Expand Latest answer or Official sources for supporting text and links. Successful summary persistence exposes a summary preview. Spoken replies default to one idea in two or three sentences, with the welcome tour preserved. Playback status uses WebRTC audio-buffer events; live microphone validation remains a manual check.

First-use recovery: onboarding now asks student/supporter role, always shows the app orientation, and supports editing the name without discarding the profile. Unapplied voice suggestions remain visible in typing mode. Account-scoped local drafts, voice suggestions, and pending onboarding summaries survive refresh/reopen for up to 24 hours (no audio or credentials). Completing setup clears the active form draft. Pending summary generation resumes after the associated student exists; the UI warns if local recovery storage fails.

Account role: first-time web and native mobile setup requires choosing Student or Parent/guardian. Migration 014 stores this choice on the account (`origen_accounts.role`), so signed-in users retain it across devices. The web app uses it as the default view and voice-guide role; account settings can update it. Existing unclassified accounts are asked to choose rather than being assumed to be parents. Preview roles remain local. The API applies new migrations at startup before accepting traffic; deploy the backend with migration 014 before the new clients.

Guide transitions: topic changes update server-generated instructions and tools through Realtime session.update on the same WebRTC call. Audio, transcript context, microphone mute state, and the original ten-minute call timer continue. The app awaits matching session.updated before changing the guide label and summary segment; rejected updates leave the call connected. Pronounce Origen like English origin (OR-ih-jin) in both languages. A real microphone test remains necessary to assess speech quality.

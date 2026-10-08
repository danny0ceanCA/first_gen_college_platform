# Phase 4: Clear spoken explanations

`plainLanguageVoiceStyle` in `src/voiceStyle.mjs` replaces the earlier short
approachable-terms paragraph. The shared policy reaches every specialty, initial
and continuing calls, and onboarding/home response overrides. It does not add
a glossary to the prompt or a separate explanation model.

The guide explains the everyday idea before naming a needed official term or
acronym, while keeping exact form labels recognizable. It gives the core answer
first and uses a practical example when useful. Invented numbers must be labeled
hypothetical, never presented as the user's costs, aid or eligibility. Simple
wording preserves material conditions, exceptions and uncertainty; existing
official-source lookup requirements remain in effect.

Requests for detail take precedence over default brevity. Connected steps can
be explained in manageable pieces without repeated permission questions.
Confusion calls for one smaller explanation rather than repeating jargon or
offering unrelated topics. Mentioning a term in stored history does not establish
understanding; definitions understood in the current call should not be repeated.
Offers to explain further are optional rather than a line appended to every turn.

In Spanish, an English form label may be named and immediately defined in Spanish.
The rest of the explanation remains Spanish, without a bilingual glossary or
alternating translated sentences. Current language instructions still take priority.
Parent scope confirmation and profile-first onboarding remain unchanged.

## Verification

Contract tests check both roles and languages across all guides, preserved research
tools, scope privacy, welcome overrides, and an in-place Spanish/topic update that
does not replace audio or the model. The replacement policy is bounded to 1,100
characters. There are no extra API calls, database changes or research lookups just
for simpler wording. More detailed requested replies can still use more output tokens.

Live listening remains necessary; prompt tests do not establish spoken quality.
Use these checks before release:

- Ask what an unfamiliar application term means: a plain explanation, no glossary.
- Ask in Spanish about an English form label: label once, definition and continuation in Spanish.
- Ask for more detail: connected steps, no “may I continue?” loop.
- Say an explanation was confusing: one smaller idea or useful example.
- Request a numerical example: explicitly hypothetical, no inferred personal award.
- Discuss loan relief or transfer requirements: important conditions remain and official verification is used.
- Ask about a term mentioned in a previous summary: no assumption it was understood.
- Interrupt or switch topics: answer the new request without a greeting or audio change.

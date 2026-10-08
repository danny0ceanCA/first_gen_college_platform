# Phase 3: Helping someone find a starting point

The shared policy in `src/voiceStartingPoints.mjs` is delivered to every live
specialty, including in-place topic and language updates. It also accompanies the
post-save home introduction. It activates when someone explicitly asks for ideas
or says they do not know where to start, rather than on silence or every opening.

The guide offers at most two simple options and one easy question. Topic examples
cover planning, costs and aid, borrowing and repayment, and applications, in English
and Spanish. They are examples to adapt, not fixed lines to repeat. If someone
accepts a suggestion, the guide begins instead of asking them to choose again.
Confusion about an answer calls for a smaller explanation of that answer.

Suggestions use the current conversation, confirmed profile and phase 2 scoped
summaries. Relevant unfinished questions can become an option, without assuming
a commitment, completion or understanding. Community-college students are not
automatically treated as transfer applicants. Unknown goals or school stage may
prompt one useful question; known details should not be asked again.

Parent scope confirmation takes precedence over personalized suggestions.
Onboarding remains profile setup first: help with the current question, accept
unknown optional details, and preserve required identity and save confirmation.
The guide does not insert an exploration menu or feature tour before saving.

This phase adds a bounded instruction block, no model call, lookup, storage change
or extra audio session. Starting ideas alone do not trigger research; factual
questions still use existing official-source tools. It adds some prompt tokens,
so it is not a claim of zero additional token cost.

## Verification and listening checks

Contract tests cover both languages, every specialty, continuing calls, scope
gating, hidden profile/history, onboarding and the post-save response override.
These verify instructions and tool availability, not live speech behavior.

Before release, listen to these scenarios:

- A student says “I don't know what to ask”: two relevant everyday options.
- A Spanish speaker says “No sé por dónde empezar”: Spanish options and follow-up.
- A community-college student with a certificate goal: no assumed transfer path.
- A returning user with an unfinished question: an optional continuation, no recap.
- A parent with multiple students: scope confirmation before personalization.
- During setup, “I don't know my GPA”: accept the unknown optional field.
- After accepting an option: begin the discussion, no second choice prompt.
- A specific question, silence, interruption or topic change: no unsolicited menu.

Live listening and observed latency/cost remain to be verified; this phase does
not claim deterministic spoken behavior from prompt tests.

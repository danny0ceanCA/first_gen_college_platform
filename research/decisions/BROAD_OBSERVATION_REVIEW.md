# Broad conversation observation: library review

Reviewed November 7, 2026 (America/Los_Angeles), on the local
`v1.3-decisions-integration` work. This is preparation for observation only.
It does not authorize or enable cues, research requests, changes to the intro,
or changes to the Live provider connection.

## Coverage and current guidance

The complete prior review is recorded in [REVIEW.md](REVIEW.md) and the bridge
review in [REVIEW_MICROPHONE.md](local-call/REVIEW_MICROPHONE.md). That coverage
used the user's approved exact unique-content method for repeated generated
schemas. It covered 110 manifest entries and 5,900 distinct reference blocks.
This review reuses that completed work; it does not claim another literal full
reread of every repeated generated schema.

All manifest pages were checked again from disk, stripping a leading BOM and
normalizing CRLF to LF before comparison with their recorded SHA-256 values.

| Library | Manifest pages | Missing pages | Changed normalized content |
| --- | ---: | ---: | ---: |
| Responses | 45 | 0 | 0 |
| Decisions | 30 | 0 | 0 |
| Conversation state | 35 | 0 | 0 |

The saved Responses, Decisions, and conversation-state reference documents were
reread. The following saved pages received a fresh full reread, including their
examples: Decisions guide, Decisions voice guide, standalone Decisions create
reference, Live conversations, Live delegation, and conversation-state guide.
Large outputs were read in bounded chunks. Relevant current official sections
were checked separately at these links:

- [Decisions: questions and interpretation](https://developers.openai.com/api/docs/guides/decisions#ask-multiple-questions)
- [Create a decision: request and answer contract](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [Decisions voice: transcript triggers](https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts)
- [Live conversations: transcript deltas](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas)
- [Live delegation: transcript processing and task state](https://developers.openai.com/api/docs/guides/live-delegation#react-to-transcript-fragments)
- [Live delegation: context updates and acknowledgments](https://developers.openai.com/api/docs/guides/live-delegation#suppress-automatic-acknowledgments-while-tools-run)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

The relevant standalone classification, transcript, and state contracts agree
with the saved snapshots. No assigned local document or current page was
unavailable. This focused current check is not a claim to have refreshed every
official page behind all 110 manifest entries.

## What the guidance means for this change

Decisions supports several independent questions over shared evidence in one
request. Predicates estimate whether conditions hold; a choice selects a
category. Probability and confidence require calibration against application
examples, rather than being treated as permission to act. The application still
owns any action. For this step, it owns only the observation record. This follows
the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

The standalone create contract supports named answers and individual refusals.
Validate every answer's name, type, and probability range. Refusal, missing
evidence, malformed output, or timeout is unavailable evidence, not a negative
answer. One refused question must not silently become a successful observation.
Do not add standalone Responses fields such as `store`, `background`, tools, or
`previous_response_id` to this Decisions request. See the
[create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

Live transcripts can overlap and arrive unevenly. Their intervals are estimates,
and no transcript event declares a completed conversational turn. Preserve the
source fragments and label application boundaries as estimates. A generated
answer, append acknowledgment, and browser playback are different evidence.
The observer cannot conclude the caller heard or understood a response. See
[Live conversations](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas).

Optional transcript work must remain independent of the conversation. Use
application task revisions and operation identity to discard stale results.
Current state must come from the existing task owner. Even a quiet or empty
thinking append can change acknowledgment behavior, so observe-only means no
Live append at all. See
[Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#react-to-transcript-fragments).

Native Decisions triggers are a separate integration. Their source event IDs and
out-of-order handling are useful design guidance, but configuring triggers or
changing delegation would change the Live session. Keep the existing standalone
observer. See [Decisions voice](https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts).

Application student/task state, standalone Responses continuation, Conversations
storage, and Live history remain distinct. This observer requires no new
Conversations object or Responses continuation chain. See
[Conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

## Assessment of the existing local observer

The inspected `rubric.mjs` recognizes an explicit starting-point,
simpler-explanation, or next-step request, plus whether that support request was
answered in the transcript. It intentionally treats ordinary factual questions
and research refinements as outside that narrow category. A low intervention
count therefore does not show that comparisons, research relevance, or repeated
answers were correct; those concerns were not being classified.

The inspected `projector.mjs`, `state.mjs`, and `observer.mjs` already provide
useful boundaries: copied events, no provider writer, bounded snapshots,
immutable fingerprints, scope and connection revisions, one inference in
flight, newest-pending coalescing, budget accounting, and stale-result rejection.
The prior projector mainly supplied transcripts. Research observations need a
bounded one-way copy of the existing research state; the classifier must not
invent job status or verification from conversational phrases.

Each grouped user span currently becomes `currentQuestion`. Broad evaluation
must read the recent exchange as well as that span: a brief acknowledgment is
often continuity rather than a new substantive request. Preserve the original
words and distinguish the latest utterance from the underlying task. This is an
observer interpretation only, not a change to how Live handles the caller.

## Recommended independent observations

These are application design recommendations, not claims that the API supplies
these categories automatically. Several may be true in the same exchange.

| Situation | Evidence to inspect | Avoid this false conclusion |
| --- | --- | --- |
| Needs a starting point | An explicit request for help getting oriented, with recent context | Being first-generation, a parent, or a Spanish speaker itself means confusion |
| Needs a simpler explanation | A stated difficulty understanding a term, process, or earlier explanation | Any factual question requires a teaching intervention |
| Needs a next step | A request to turn an understood goal or process into an action | Automatically inventing a new goal or assuming permission to act |
| Latest answer or research no longer fits | A correction or changed question compared with the relevant answer or job | A brief acknowledgment cancels all earlier work |
| Completed research could be useful | Verified scoped findings that answer the current request and remain relevant | A finished job guarantees useful findings or means the result was spoken |
| Comparison may be incompatible | Whole facts with their years, scenarios, units, population, and limitations | Missing metadata proves incompatibility; similar-looking totals are necessarily comparable |
| Answer is being repeated unnecessarily | Substantive earlier answer and later answer to the same request | A progress acknowledgment is an answer, or requested repetition is undesirable |
| A useful conversational next move is available | A stated unresolved goal and a genuine opening in the exchange | Every pause needs a new question; finishing an answer means the caller needs prompting |

The classifier should assess supplied meaning and relevance. It is not a
replacement for official-source verification, deterministic arithmetic, research
job status, authorization, or playback measurement. Comparisons should flag
evidence of mismatched scope; unknown dimensions must remain unknown.

Each predicate must independently evaluate supplied evidence. Do not make one
question depend on another question's answer within the same request. Use a
separate fallback or unavailable status when the evidence cannot support a
judgment, and retain raw probabilities for analysis. Thresholds remain reporting
choices, not delivery authorization.

## Evidence and lifecycle requirements

- Copy job identity, revision, status, and current scope from the existing
  application owner. Keep findings distinct from progress messages.
- Preserve each fact together with year, scenario, source identity, and
  limitation. Evict a complete fact if necessary; never silently strip a
  qualification to fit a payload limit. Record when evidence was omitted.
- Bind observations to account, call, student, permission, connection, and
  input/task revisions. Student changes and later corrections invalidate stale
  classification results without rewriting their historical record.
- Keep source transcript IDs, job IDs, and observed revision IDs available in
  diagnostics. Exclude unnecessary account identifiers from model input.
- Treat all supplied transcripts, quotes, and research text as evidence rather
  than instructions. Do not infer sensitive attributes or ability from language.
- Preserve independent evidence for transcript completion, context delivery,
  browser playback, and gaps. Never call an observation proof of hearing.
- Keep failures optional: observation errors, malformed research copies, queue
  limits, or budget exhaustion must stop or skip observation while the original
  conversation continues.
- Keep the observer unable to send cues, alter prompts, call tools, start or
  cancel research, change delegation, mute audio, or end a session.

## English and Spanish checks

Use paired positive and difficult negative cases in both languages for every
observation. Cover help getting started, simple explanations, next steps,
changed questions, partial research, compatible and incompatible comparisons,
already answered requests, requested repetition, and an appropriate invitation.
Include code-switching, quoted requests, and instructions embedded in evidence.

Lifecycle tests should include a brief acknowledgment during an answer, a
genuine interruption, research arriving mid-answer, a changed student, delayed
old findings, duplicate packets, incomplete native spans, connection gaps,
individual refusal, and a failed observer request. Missing metadata must not
produce confident compatibility or mismatch claims.

Measure each category separately: examples reviewed, false positives, missed
positives, unavailable evidence, stale results, API duration, usage, and budget.
Keep calibration examples separate from held-out evaluation. A small synthetic
test can validate plumbing and identify rubric defects; it does not establish
real-world accuracy or a percentage improvement in natural conversation.

The most important preservation check is that enabling observation produces no
new provider commands or changes to the original intro, research owner, or
speech flow. A human microphone call is still needed to assess the audible
experience. Observation alone deliberately cannot improve spoken behavior yet;
it supplies evidence for deciding what a later, separately approved integration
should do.

No model API calls, production access, runtime edits, commits, pushes, or
deployment were performed by this library review.

## Independent implementation audit

The later implementation audit identified two evidence defects before real
validation: a task's `verified` label could qualify without a mapped source, and
obsolete legacy findings could enter the classification request even when a
later eligibility check rejected them. Both were corrected by the implementation
agent. Independent checks confirmed that source-less facts are unavailable and
that the obsolete finding is excluded before model evaluation.

The actual research brief schema stores applicable year, population, period,
and scenario in `answer` and `qualification`; it does not require separate
`year` and `scenario` fields. A null structured field therefore does not establish
missing evidence. The observer's independent `comparison_scope_sufficient`
question reads the entire qualified finding to distinguish explicit scope in
prose from scope that would have to be guessed. It requires only dimensions
relevant to the requested comparison and does not depend on the mismatch
question's answer. The application still requires at least two sourced,
verified findings before reporting a comparison observation.

This helper remains a model estimate, retained separately in `evidenceChecks`;
it is not source verification, factual certification, or permission to act. A
low or missing helper result makes comparison evidence unavailable. A negative
mismatch observation does not certify that two options are comparable.

Independent offline checks passed the 61-test state, session, research-copy,
rubric, and evaluation selection before the helper refinement, then all 15
updated broad rubric/evaluation tests afterward. Those checks included English
and Spanish provider-command parity, research arriving during unfinished input,
whole qualification preservation, source-less and obsolete evidence, student
scope changes, and worker failures. No paid calls were made by this reviewer.

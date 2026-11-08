# Isolated microphone app

## Earlier Decisions trial: current configuration

`ORIGEN_LOCAL_EARLY_DECISIONS` defaults to false. It enables the separate,
provisional-transcript classifier only in this isolated local app and requires
all three flags below. The launcher rejects a missing dependency.

```powershell
$env:ORIGEN_LOCAL_DECISIONS_APPROVED = 'true'
$env:ORIGEN_LOCAL_CONVERSATION_SUPPORT = 'true'
$env:ORIGEN_LOCAL_CONTINUATION_SUPPORT = 'true'
$env:ORIGEN_LOCAL_EARLY_DECISIONS = 'true'
node research/decisions/local-call/launch.mjs
```

`ORIGEN_LOCAL_LASTING_PREFERENCES=true` is optional and independent of earlier
classification. It keeps the existing explicit preference behavior. Set only
`ORIGEN_LOCAL_EARLY_DECISIONS=false` to disable the new path; to return fully to
observe-only, unset the early, continuation, lasting-preference, and conversation
support flags before restarting. Do not restart or change flags during an active
microphone call. Health at `/__local_observer` reports `earlyEnabled` alongside
the existing support modes and `researchObserveOnly:true`.

The early classifier can begin once enough caller speech has arrived, without
waiting for the application's completed-transcript estimate. It never holds the
voice response. A separate parent gate permits a short, fixed quiet context note
only before assistant output begins for that contribution, after the existing
intro/selection fences, with fresh idle playback evidence and no pending context
or delegation. It does not introduce a spoken announcement. If it is too late,
the need stays local briefly and requires fresh related caller evidence before
reuse. Decisions still cannot start, cancel, or change research or student
records. Normal production configuration, intro prompts, and voice routing remain
unchanged. Better perceived conversation must be assessed from actual audio;
an enabled flag or a provider acknowledgment is insufficient evidence.

This trial has a fixed **$0.30 Decisions allocation** in
`approved-early-refinement-decisions-budget.sqlite` and the existing **$2.10 automated voice allocation**
in `early-voice-budget.json`, under the user's $5 total authorization. The budget
guard includes the full previous $2.50 voice ceiling and $0.0635401 of settled,
request-exhausted prior Decisions usage, for a conservative maximum exposure of **$4.9635401**.
Prior unknown reservations remain held; exhausted prior request limits cannot be
reopened. Both early and completed-snapshot classifications use the new ledger
when this flag is enabled: at most eight early plus 24 completed classifications
per call, within an immutable 200-request total. No launcher operation resets or
increases an allocation. A depleted ledger stops classification while the voice
controller remains available.

During paid A/B validation, runtime files remain frozen for the whole comparison.
Do not edit the runtime or restart its processes between baseline and enabled
runs. Record the tested source version, flags, and retained diagnostics. The
current classifier results and their limits are in
[EARLY_CLASSIFIER_VALIDATION.md](EARLY_CLASSIFIER_VALIDATION.md); they do not by
themselves establish naturalness or successful audio delivery.

The account/database isolation and startup instructions below still apply. The
budget descriptions for earlier trials are historical, not additional available
authorization for the early trial.

## Previous continuation trial

The preceding implementation added `ORIGEN_LOCAL_CONTINUATION_SUPPORT=true` to the
existing approved support flags below. It is default-off and requires
`ORIGEN_LOCAL_CONVERSATION_SUPPORT=true` and approved classification. It adds
temporary confusion support, bounded recovery for an accepted explanation, and
clearer ended/partial status in existing local research packets. It does not
let Decisions start research or change student records. See
[validation results and limitations](CONTINUATION_RESULTS.md).

This implementation did not restart the microphone app or enable the new flag
in an existing running process. The automated tests used fictional data and a
separate, bounded validation allocation. Its request limits are exhausted;
starting the launcher will not reset them. A subsequent paid microphone trial
needs an available approved allocation. The older budgets described below are
retained as historical configuration, not reusable authorization for this trial.

Quiet confusion cues are attempted only before an ordinary answer begins. Late
cues stay local. The accepted-offer recovery uses a distinct safe-gap check and
cannot cancel an already-sent instruction if the caller starts speaking later;
both provider scheduling and perceived naturalness need microphone validation.

`launch.mjs` connects the existing local account copy to the current app and a
Decisions wrapper that defaults to observe-only. It reads only approved OpenAI/Auth0 settings
from local environment files. It never reads Render configuration, clones
production data, migrates a database, or grants database permissions.

The database is fixed to `127.0.0.1:55480/origen_decisions_local_20261107` using the
restricted `origen_research_local_runtime` role. The research worker uses
`origen_research_worker` on that same database. Startup verifies the actual
database, address, port, role, account isolation, research schema and grants.
If the copy needs updating or migration, startup fails for separate review.
The separate `prepare.mjs` clones the existing November 4 local copy, applies
current migrations and restricted grants to the new clone, and records a local
setup report. It uses fixed loopback connections and verifies server identity
before writes. The original local copy remains unchanged.

This clone contains Daniel's real account records copied on November 4, 2026;
it is **not fictional data**. The launcher accepts only the copied account's
existing Auth0 identity. Auth0 sign-in and normal OpenAI voice/research requests
still contact their providers. Saves remain in the local copy.

Run from the repository root (Daniel authorized this existing local copy):

```powershell
node research/decisions/local-call/launch.mjs
```

The UI is `http://127.0.0.1:5173/#app`; the API is loopback port 3001. Sign in
with Daniel's existing account. Both ports must be free; this launcher will
not silently reuse an unrelated app. The existing research worker runs in a
separate local process. The observation thread cannot send cues, alter the
intro, run research, or write student records. Optional support candidates pass
through a separate local gate; the worker itself has no provider connection.

Decisions classification is disabled by default. Daniel authorized observing
this copied account; to enable the approved Decisions classifier, set
`ORIGEN_LOCAL_DECISIONS_APPROVED=true` before starting. Classification shares
the existing Decisions budget ledger; it does not authorize automated voice
calls or create another spending budget. Without that switch, local event
observation and diagnostic recording still work.

To enable the separately approved conversational-support trial:

```powershell
$env:ORIGEN_LOCAL_DECISIONS_APPROVED = 'true'
$env:ORIGEN_LOCAL_CONVERSATION_SUPPORT = 'true'
$env:ORIGEN_LOCAL_LASTING_PREFERENCES = 'true'
node research/decisions/local-call/launch.mjs
```

The first two flags permit starting-point, simpler-explanation, and next-step cues after
the intro. They skip one-time cues when Origen has already begun answering, when research
or delegation is active, or when timing/scope is uncertain. It does not change
the existing research workflow. `researchObserveOnly:true` in local health means
Decisions cannot act on its research assessments, not that normal research is
disabled. Set `ORIGEN_LOCAL_CONVERSATION_SUPPORT=false` and restart to return to
observe-only mode.

The third flag additionally remembers explicit ongoing requests for plain language
and one step at a time during the current call/student/language. These preferences
can arrive after an answer, but only in a verified quiet playback interval following
an estimated completed thought. Origen never waits for them. A withdrawal replaces
the earlier snapshot. No profile preference is persisted across calls, and no
research action is driven by Decisions. Local health reports `preferencesEnabled`.
Set just `ORIGEN_LOCAL_LASTING_PREFERENCES=false` to return to the earlier support trial.

Support classification uses `approved-support-decisions-budget.sqlite`, a new
immutable $1.50 ledger from the approved $3 validation/support budget. Automated
voice validation has a separate $1.50 ceiling. The previous $5 and $2 approvals
are not increased or reset. Decisions stops when its request/spend cap is reached;
the ordinary voice conversation continues.

`http://127.0.0.1:3001/__local_observer` reports readiness, classification mode
and observer counts without transcripts or credentials. Observer JSONL records
persist in the ignored `research/decisions/.local/` directory. Native transcript
intervals, estimated application boundaries and browser playback remain
separate evidence. None proves that the listener heard an answer.

Use Ctrl+C to stop this launcher's API, UI, and research worker. The local
database and retained diagnostic files are left available for review.

Offline launcher checks, with zero provider requests:

```powershell
node --test research/decisions/local-call/launch.test.mjs
```

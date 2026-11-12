# PostgreSQL and conversation-provider preparation

Prepared locally on `v1.3-decisions-integration`. No commit, push, deployment,
production migration, live flag, voice prompt, opening, floor-control or active
research handler was changed. All real workbook records remain unapproved.

## What is ready

`postgres.sql` provides immutable, versioned imports in `coa_catalog.batches`,
`budgets` and `items`. Numeric amounts are stored as integer cents; original
amounts/factors, complete source data, row IDs and applicability fields survive
in typed columns and JSONB. Foreign keys protect batch/item relationships.
Transactions prevent partial imports, and hashes reject changed contents under
an existing batch identity. Corrected workbooks append a new batch.

Approvals are separate, bound to workbook hash and exact record digest, and
require an identified reviewer, affirmative official-source review, notes and
expiry. Flags, unresolved source conflicts and incompatible projections block
approval. Approval/revocation events are archived separately. The read-only role
has SELECT on the approved/unexpired view only, with no access to draft records,
write privileges or approval operations. Revocation removes a result from that
view immediately; previously spoken context is not claimed to be retracted.

The dedicated local database is
`127.0.0.1:55480/origen_coa_catalog_local`. Operator helpers ignore DATABASE_URL
and all Render/production credentials and verify the target database identity.
The application database is not migrated or granted catalog access.

## When the corrected workbook returns

1. Run the existing Python dry-run and staging import on the corrected file.
   Its SHA-256 creates a new batch; original revisions remain available.
2. Import that batch into the dedicated PostgreSQL catalog:
   `node research/cost-catalog/postgres.mjs import-local <batch-id>`.
3. Generate the readiness report and unsigned review template:
   `node research/cost-catalog/postgres.mjs prepare-review-local <batch-id>`.
4. Review source accuracy, scope and any holds. Select the intended records in
   the template and supply reviewer, review note, verifiedOfficialSources=true
   and a future validUntil. This is an explicit source review, not approval by
   spreadsheet arithmetic or by a model.
5. The isolated approval command is
   `node research/cost-catalog/postgres.mjs approve-reviewed-local <manifest.json>`.
   A wrong workbook hash, changed record digest, flagged record or unresolved
   projection aborts the entire approval transaction.

The current readiness files are in `.local/postgres-review/`. The supplied
488 scenarios/5,254 items have been stored in PostgreSQL with zero real approvals.
317 records fit the current projection without staging flags. 171 remain held:
the original 170 review records plus UC-0346, whose notes explicitly identify a
UCSF source conflict. No amount was silently corrected. The older 170-row CSV
is unchanged; the PostgreSQL readiness report includes the additional hold.

## Prepared data-provider contract

`catalog.mjs` is a default-off, dependency-injected provider, not an installed
Live tool. `createCostCatalog().plan()` takes explicit campus/scenario choices.
It performs one batched approved-view lookup and returns:

- `result`: the existing structured research-result format, with scoped totals,
  citations, qualifications and detailed budget components;
- `needsResearch`: only unavailable campuses, leaving matching findings usable;
- `clarifications`: unresolved cohort/program/housing distinctions, without
  inventing a personal scenario or starting unnecessary source research.

Year-omitted requests select an approved published-year benchmark and label it.
Required student/scenario scope is not guessed. Expired/unapproved records are
unavailable. Additional mutually exclusive orientation charges stay individually
documented outside the published total; they are never combined into a false fee.

`createCostComparison()` retains requested campuses across additions and protects
new selections from late results. Changed housing cannot restore an old scenario.
`createCatalogResearchAdapter()` returns known results first and a background
completion for missing campuses. Failed fallback research preserves known data.
It does not announce, cancel, switch the binder, or request another Live response.

An eventual application activation must wire this seam to the authenticated
research handler using trusted structured scope, reviewed PostgreSQL grants and
an explicit feature flag. It has intentionally not been registered in the live
handler while records are pending. Existing speech/context-delivery and table
presentation retain ownership of when and how a result is shown or spoken.
This preparation does not fix their separate presentation-timing issues.

## Validation and remaining limits

18 Node tests passed against actual isolated PostgreSQL and the existing
research, context-packet and visual-table builders. Tests cover full real-file
round-trip, idempotency, hash-bound approval/rollback, reader permissions,
immutability, expired/revoked results, audited re-review, English/Spanish three-campus comparisons, all
component totals/citations, retained campuses, missing-campus-only fallback,
changed housing, safe clarification, bounded context packets, stale completions,
and non-additive orientation alternatives. Fictional test approvals are revoked
after every run. No real record is approved by tests.

The existing 22 Python import/export tests and 88 focused research/table/context
compatibility tests also passed (128 total). Tests do not use
OpenAI, microphones or production. They prove database and data-contract behavior,
not natural spoken delivery, browser paint timing or production response latency.
Native/browser checks remain required before enabling the provider for callers.

## Guidance reviewed throughout

The saved Responses reference and the existing full approved unique-content
library review remain the basis for unchanged snapshots. All manifest pages are
checked for integrity. Relevant saved/current guidance was revisited during
implementation; this is not claimed as a fresh literal reread of millions of
repeated SDK schema tokens.

- [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation):
  application-owned state and verified, coherent result units; full details stay
  in the backend. Managed Responses continuation is not replaced.
- [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations):
  quiet context can affect speech; a provider receipt is not delivery. This
  provider sends no session updates and claims no playback success.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  structure does not establish factual accuracy. Approval and source conflict
  checks remain separate from arithmetic/schema checks.

No documentation is inserted into runtime context. No Decisions classifier,
research worker or additional model call is needed for a known matching record.

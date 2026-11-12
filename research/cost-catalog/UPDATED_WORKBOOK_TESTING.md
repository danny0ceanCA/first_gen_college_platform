# Updated workbook: local testing release

Prepared on `v1.3-decisions-integration`. The user's final publication target is
local testing. Production, Git branches and deployment settings are unchanged.

## Imported data

The original workbook is preserved byte-for-byte under `.local/sources/` with
SHA-256 `947bc7b3505a297095cec8fc61b430106dd6d0123beb9b34bfd804754aaa3bf5`.

| Measure | Previous workbook | Updated workbook |
| --- | ---: | ---: |
| Budget scenarios | 488 | 491 |
| Cost items | 5,254 | 5,278 |
| Reconciled scenarios | 396 | 396 |
| Calculated totals without a published grand total | 45 | 45 |
| Published-total/component discrepancies | 36 | 36 |
| Scenarios with missing included amounts | 11 | 14 |

206 existing budget records have changed fields, mostly review/scope information.
All 5,254 original cost-item records are unchanged. The added three scenarios are
UCSF Dental, Medicine and Pharmacy postbaccalaureate programs with some costs TBD.
Their unknown fees and published totals stay null. 209 ID-keyed review notes are
stored in PostgreSQL with source-check evidence; these are workbook review claims,
not executable instructions or automatic official verification.

The importer is now `coa-workbook-staging-v1.2`. It fixes a housing classification
error: `Off-campus (not with parents)` means independent off-campus housing, not
living with parents. The corrected import is a new immutable batch:
`e82224f4d7ffca16a1956d2358f70596bc72b0ec791f4475e195ec4b73b68f77`.
Earlier batches remain available for audit.

## Local publication and qualifications

`testing.sql` creates an independent, expiring `test_releases` record and read-only
`testing_published` view in the dedicated local catalog database. It selects the
latest unexpired test release; older releases remain archived. All 491 structurally
valid scenarios are visible for local data-contract testing. The ordinary
`published` approval view still contains zero real workbook records.

Testing findings remain `partial`, with explicit caveats. A published total is
retained even when its components do not reconcile; the difference is preserved.
A missing published total is not replaced by the component sum and called
published. Unresolved source housing and source conflicts remain stated.
Mutually exclusive orientation charges are not added together or into COA.
No source amounts were changed to force agreement. Each reader receives only its
record's review note, not the entire 209-note evidence collection.

## Source checks and their limits

24 distinct primary/override/verification URLs were attempted directly. Ten
downloads succeeded; other requests encountered access or certificate failures.
Additional official pages, including Davis and Merced, were opened through the
web source tool. Downloaded evidence and failures are retained under
`.local/source-check-v2.1/`. Successful page retrieval does not establish that
every amount and scope in every workbook record was independently verified.
The testing release deliberately makes no blanket verification claim.

Useful official sources checked include:

- [Berkeley published student budgets](https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/)
- [Davis 2026–27 entering-cohort budgets](https://financialaid.ucdavis.edu/undergraduate/cost/2627-entering)
- [UCLA published costs](https://financialaid.ucla.edu/go/coa)
- [Merced published costs](https://financialaid.ucmerced.edu/cost-attendance)
- [UCSF program budgets](https://finaid.ucsf.edu/application-process/student-coa)
- [UCOP systemwide fee schedule](https://www.ucop.edu/operating-budget/_files/fees/202627/2026-27.pdf)

## Local voice path

The isolated launcher can enable `ORIGEN_LOCAL_COST_CATALOG=true`. Only the local
research worker receives that flag. The provider verifies the development mode,
loopback address, port and exact isolated application database before connecting
to the separate catalog with a read-only test role. It rejects production and
remote database configuration. Production/default launches do not load it.

Matching undergraduate cost requests can use the database instead of a new web
or OpenAI research call. Explicit renting/family choices are respected. When a
source supplies only a generic off-campus amount, it is labelled as a source
benchmark, not silently converted into an established rental scenario. Unknown
personal cohort or residency remains unconfirmed and a displayed benchmark is
labelled. A request for tuition alone returns that amount instead of the COA.
Unresolved personal housing, unsupported years/programs and personal aid/award
questions remain on the established research path. This first local adapter does
not claim natural-language coverage of every UCSF program/stage combination.

Results use the existing research-result, table and context formats. The worker
saves the same result used by those consumers, with no additional response-create,
spoken announcement, greeting, binder navigation or floor-control instruction.
An existing call's retained findings use its existing reuse path. Known results
skip web recovery; missing coverage remains marked partial. A catalog exception
falls back to the original worker. Queries have bounded timeouts.

`catalog_checked` diagnostics record duration, outcome and source count alongside
the existing call/job keys. No OpenAI call is made by the catalog itself.

## Verification

- 18 original PostgreSQL/provider tests passed.
- 9 updated-workbook/local-provider tests passed, including all 491 projections
  in both languages, all 209 notes, read-only permissions, real PostgreSQL and
  three-college worker/table compatibility with provider requests forbidden.
- 23 Python import/export regressions passed against the original supplied
  workbook, including the new negated-parent housing test. The original golden
  fixture asserts 488 scenarios; giving it the new 491-scenario workbook produces
  the expected fixture-count mismatch, not an import failure. Updated counts and
  contents are covered by the separate PostgreSQL tests above.
- 146 focused worker, research/table/context, launcher and observability tests
  passed; one separately gated PostgreSQL trace-archive integration test skipped.

The isolated app was refreshed with the catalog enabled, worker ready, production
writes false and Decisions reply recovery off. No automated paid voice/research
calls were run. Actual spoken delivery, microphone timing and visual paint timing
still need the user's local call. Backend/table-builder tests are not proof of
playback or perceived conversational naturalness.

## OpenAI guidance alignment

The unchanged full unique-content library review remains the preparation basis;
the 110 library manifest entries were integrity-checked in the preceding work.
Relevant current [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
and [session guidance](https://developers.openai.com/api/docs/guides/live-conversations)
were revisited. The application owns source data, scope and task state; coherent
qualified facts travel through the established result path. Quiet context is
distinct from spoken commentary, and an accepted context update is not playback
evidence. The documentation library is not runtime context.

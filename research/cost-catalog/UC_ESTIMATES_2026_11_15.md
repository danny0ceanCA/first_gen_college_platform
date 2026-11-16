# UC calculated and partial estimates

Prepared on v1.3, November 15, 2026 (local date), following the read-only review
of 59 UC scenarios without published totals.

| UC selection | Scenarios |
| --- | ---: |
| Calculated from the recorded included components | 45 |
| UCSF known-cost partial estimates, excluding TBD fees | 14 |
| Other UC record payloads preserved | 432 |
| Existing CSU scenarios preserved | 776 |

The new immutable UC batch keeps all 491 UC scenarios. Original raw values,
source total fields, item roles, source dates, flags, review evidence, housing,
cohort, program, and expiry are preserved. The 59 published-total fields remain
null. Application-owned `catalogEstimate` metadata supplies the calculated or
partial amount. No database migration or additional service is required.

The full catalog remains 1,267 scenarios. Together with CSU it contains 89
calculated and 139 partial estimates. The 43 disputed CSU scenarios remain held.

## Source qualifications

The seven reviewed Irvine subtotal discrepancies have a short localized note
beside the planning amount and in the factual qualification sent through the
existing delivery path. A source's discrepant subtotal is not added to the
components or presented as the official total. The nine continuing-cohort
nonresident overrides remain bound to the reviewed UCOP rate and source URL.

UCSF partial estimates explicitly name the missing tuition, program or summer
fees, localized in English/Spanish. Coverage of two, nine, ten or eleven months
is visible beside the amount. Living subtotals are not added twice. No unknown
fee becomes zero, and no two-month summer figure becomes a complete annual COA.

The source-review boundary and original December 12 expiry are unchanged. The
new estimate review date records the arithmetic/selection review, not a claim
that all campus web pages were rechecked. Irvine blocked current direct page
retrieval; its earlier dated source review and recorded limitations remain.

## Lookup behavior

Existing undergraduate lookups use the same catalog and white table. A general
Irvine on-campus source is a labeled benchmark; it is not relabeled as an exact
dormitory or apartment price. Explicit dorm requests cannot silently select that
generic source. Singular/plural Spanish residence-hall wording is recognized.

UCSF has a narrowly scoped catalog path for clearly named supported programs,
including the program track/year and resident/nonresident PhD scenario. Unclear
programs, unsupported housing, conflicting periods and ambiguous tracks defer
to the existing research flow. Unspecified PhD residency is explicitly a
California-resident benchmark. No student eligibility or personal housing plan
is inferred from the source scenario.

The intro, voice/model, speech timing, binder, table placement/animation, and
Decisions flags are unchanged. The new factual note uses the existing validated
application-owned estimate metadata; hosted Responses schemas stay unchanged.

## Validation

- All 59 amended scenarios pass English and Spanish parsing, amount, source-note,
  exclusion, source-expiry and table checks. Other UC payload digests remain intact.
- Actual isolated PostgreSQL publication is idempotent and retains all 776 CSU
  scenarios. The 1,208 unamended catalog payload digests stay unchanged.
- 118 actual read-only catalog → research worker → table checks (59 × 2) use
  zero model requests and zero research recovery attempts. This includes all 14
  named UCSF partial scenarios in each language.
- Ten growing UC/CSU comparison stages and hide/restore controls pass.
- The regression campaign passes 178 checks; four unrelated opt-in integration
  checks are skipped. The new PostgreSQL paths are exercised separately above.
- No new paid model or microphone test is part of this release. Automated
  delivery checks do not establish audible warmth or provider speech latency.

Evidence is in `.local/uc-estimates-20261115/`. Production activation and deploy
receipts, when performed, are written there separately. Preparation and local
rehearsal do not activate a production release.

## Library alignment

Used the documented full-library review and authorized reuse approach; verified
all 45 saved page hashes and reread relevant reference/contract sections. Current
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
guidance were checked against the code. Application code owns arithmetic,
validation, source scope and factual qualifications. The documentation library
does not enter runtime context, and Live/standalone Responses contracts are not
interchanged.

Review selection: [uc-estimates-20261115.json](reviews/uc-estimates-20261115.json).

```powershell
$env:COA_UC_ESTIMATE_TEST='true'
node --test research/cost-catalog/uc-estimates.test.mjs server/catalog-estimate.test.mjs
node scripts/prepare-uc-estimates.mjs <original-UC-snapshot.json> <local-output-directory>
node research/cost-catalog/uc-estimates-local.mjs <original-UC-snapshot.json> <local-output-directory>
```

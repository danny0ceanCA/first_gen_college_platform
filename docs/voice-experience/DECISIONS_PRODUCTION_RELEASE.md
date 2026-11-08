# Decisions production release — November 8, 2026

User authorized merging v1.3 into v1.2 and main, then explicitly clarified that Decisions should be enabled in production. The separate discussion about deliberate customer-service pauses is proposal-only: preserve existing intro, pace, prompts, withholding rules, voice and research routing.

## Implementation under verification

- Shared observed-session core retains the tested local support gates. Local launcher remains guarded against production use.
- A separate authenticated production factory enables the same pre-answer, explicit-preference and continuation paths using `ORIGEN_DECISIONS_SUPPORT=true` on the API.
- Existing server-validated control configuration remains authoritative for student selection. Research Decisions stay observe-only; late delivery/native triggers remain off.
- At most 32 Decisions requests per physical call, with a finite per-call accounting ledger and unknown usage retained. This is not a global spending cap. At most four concurrent helper workers per API instance; ordinary voice continues when unavailable.
- Production metadata is stored in account-scoped `origen_decisions_events` (migration 125), without raw transcripts, model prompts, secrets or private reasoning. Account deletion cascades; no automatic expiry. A bounded async sink and gap fence prevent diagnostic failures from blocking speech.
- Validation: 604 tests passed, including English/Spanish production adapter and real helper-thread tests with deterministic HTTP responses, authenticated control-socket activation, existing voice/research regressions, accounting limits and real isolated PostgreSQL RLS. No new paid model calls were made for this release. The earlier real-audio comparisons remain separately documented.
- TypeScript/Vite build and production logging checks passed. Existing bundle-size advisory remains.
- Reused the previously completed full library review; verified all 45 Responses, 30 Decisions and 35 conversation-state snapshot checksums with LF normalization, with zero missing/changed pages. Rechecked current official Decisions pricing/usage, Live append semantics, and conversational tool-progress guidance. This was not another full reread.
- Migration 125 and `SELECT,INSERT` grants for `origen_api` were applied atomically in production at `2026-11-08T18:09:15.623Z`. RLS enabled; API delete privilege false. Migration 124 checksum matched. The earlier migration 121 discrepancy was not modified.
- Released code commit: `807c60bb8c78a13953700e41524280604b7faf79`, fast-forwarded through v1.3 → v1.2 → main and pushed atomically. The historical V1 tag was preserved.
- `ORIGEN_DECISIONS_SUPPORT=true` was merged into the existing Origen Edu API environment; unrelated settings were preserved. The research worker needs no Decisions flag or new service.
- Render API deployment `dep-dbobnv7avr4c73b92rfg`, frontend deployment `dep-dbobnv7avr4c73b92sh0`, and research-worker deployment `dep-dbobnv7avr4c73b92sl0` all reached `live` on that code commit. Final health checks at `2026-11-08T18:15:56.094Z`: API `/healthz` 200, `/readyz` 200, and `https://origenedu.ai/` 200. No error-level app logs were returned for the deployment window.
- Production flag, existing server control, research worker and delivery V2 settings verified true. Late delivery remains disabled in the production adapter. Production session efficacy still needs the next real call; rollout health and offline integration tests do not establish improved spoken quality.
- A later documentation-only commit records these deployment results with `[skip render]`; its code is identical to deployed `807c60b`.

Historical local-only isolation reports remain accurate for their own checkpoints. This release intentionally adds a production entry point and must not be described as preserving an entirely unchanged production runtime.

Use `node research/decisions/verify-production-runtime.mjs` for the reviewed release. The older `verify-isolation.mjs` remains a historical assertion for the original local-only baseline and is expected to reject an intentionally changed production runtime. Its baseline hashes were not rewritten.

The $0.005 per-request reservation and 32-request limit bound each call's helper work; normal reported usage is settled, unknown usage stays held for that call. This is a per-call accounting ceiling, not a project-wide cap across users or calls. Native voice and research billing remain separate. Durable usage events support later reconciliation.

## Rollback

Set `ORIGEN_DECISIONS_SUPPORT=false` on the API and deploy that configuration. New calls use the established voice controller without the Decisions helper. Leave migration 125 in place; it is additive and preserves diagnostic history. Existing calls retain their constructed controller until they end. No rollback or deletion of the historical V1 tag is required.

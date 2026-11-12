# Production research tables and COA catalog

## Runtime

- API: `ORIGEN_RESEARCH_TABLES=true` enables the existing white research table in authenticated voice sessions. Development's local flag remains separate.
- Research worker: `ORIGEN_COST_CATALOG=true` uses the existing restricted worker credential and a separate read-only connection pool. There is no new service, credential, voice prompt, model call, or speaker-control path.
- The same saved research result feeds the voice context, report, and table. Existing comparisons, year/housing selection, minimize/reopen, hidden columns, and history are retained.
- Catalog misses and runtime query errors retain the existing source-research fallback. Startup refuses an enabled but absent/empty publication. Disable the flag before intentionally removing the publication.

## Data and provenance

Migration `126_cost_catalog_publication.sql` adds only the `coa_catalog` schema and a restricted read grant. Immutable batches, budgets and items preserve the workbook, amounts in cents, item roles, original payloads, and record digests. The worker receives SELECT on the production publication view, not raw catalog tables or student records.

Publication uses an explicit manifest of digest-bound records and is atomic, immutable, idempotent, and serialized. The publication represents user-authorized use with caveats; it does not create an independent-source-review approval. Partial records, missing values, known discrepancies, and source-scope conflicts remain partial. The renderer never silently changes values to reconcile a total.

The initial production snapshot is the existing local UC release: 491 scenarios, 5,278 line items, workbook batch `e82224f4d7ffca16a1956d2358f70596bc72b0ec791f4475e195ec4b73b68f77`. Its original source/review dates and December 12, 2026 expiry are preserved. It does not publish the newly staged CSU workbook. Catalog lookup continues using the same supported undergraduate matching as the local adapter; storage of a scenario does not guarantee every graduate/program query is supported.

The `published_catalog` freshness contract records workbook-reported source checks separately from retrieval, release, and expiry. It does not imply a live website recheck. Source dates are not refreshed by queries. Published status does not erase qualifications.

## Operator sequence

1. Keep `v1.2-production-backup-2026-11-12` and `v1.2` intact.
2. Rehearse the migration, publication, reader permissions, projection and tables on a fresh isolated PostgreSQL database.
3. Export public catalog data only with `scripts/promote-coa-catalog.mjs export-local <snapshot.json>`. Keep the snapshot out of Git.
4. Verify the production database identity; use `scripts/migrate-coa-catalog.mjs` with `MIGRATION_DATABASE_URL` and `CATALOG_EXPECTED_DATABASE` to apply only migration 126 using the migration owner's credential. Never give that credential to the application or worker. The full migration runner detected an existing checksum mismatch for historical migration 121; that attempt rolled back. Migration 121 and its recorded checksum were left unchanged, and only 126 was subsequently applied through the scoped runner.
5. Publish through `publishCatalogSnapshot` or the configured operator command. Supply the expected database, reviewer and publication note. Verify exact source digests, row counts, scope, amounts and qualifications using the worker role.
6. Merge only the intended flags into their existing Render services, then deploy and verify API health, worker readiness and the frontend build. No credentials or local PostgreSQL URLs go into production configuration.

## Rollback

Disable `ORIGEN_RESEARCH_TABLES` on the API and `ORIGEN_COST_CATALOG` on the worker and redeploy, or restore the preserved v1.2 source snapshot. Do not drop the catalog or reverse student data to roll back code. This migration is additive and the prior version ignores it. Do not force-push or move the v1.2 reference. Other unrelated future main changes need separate consideration when rolling back.

## Review and validation

All 45 saved Responses pages remain unchanged after normalizing Windows line endings; the prior complete approved unique-content review remains applicable. Relevant saved/current Live delegation, context, and structured-output guidance was revisited. Source claims remain data with qualifications, the application owns publication and task state, and no documentation is injected at runtime. Provider acknowledgment remains distinct from speech or playback.

The fresh database rehearsal passed 12 tests, including every record in English and Spanish, exact total/line-item preservation, expiry, idempotency, immutable publication, rejected digest mismatch, and real restricted-role comparison/table generation. The broader suite passed 336 tests with two separately gated integration tests skipped. The production build passed. No paid model call was made. These checks do not substitute for the user's next production microphone test.

The production database was then verified using the actual restricted worker role: 491 published records, 5,278 stored line items, no worker draft/student SELECT permission, and 18 successful English/Spanish lookup comparisons across all nine undergraduate UC campuses. Every total and budget component matched the local result, and every result built a presentable table through the existing visual builder. No model call or student-data write was used for this verification. Publication receipt ID: `757b9a2d1d45b4ed8fd038d5b6a38dbd83195421465f191e1769e99bb24c9653`.

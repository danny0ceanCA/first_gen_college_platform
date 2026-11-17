# V24 research staging adapter v0.3

Run from this consolidated package root with Python and `openpyxl==3.1.5`:

```sh
python -m unittest discover -s staging_v24/nursing_schema_review/adapter -p 'test*.py' -v
python staging_v24/nursing_schema_review/adapter/nursing_staging.py data/Origen_California_Nursing_Cost_Catalog_v24_Caveated.xlsx
```

A repeatable full-workbook integration check is `python validation/verify_integration.py` from the package root. It uses and removes its own temporary isolated database and refreshes validation reports.

The second command prints a report without writing a database. To test persistence, add `--database staging_v24/nursing_schema_review/adapter/research-v24.sqlite`. Only a new isolated SQLite database in that adapter directory is allowed. Do not use production databases. All budget records remain pending, source-unverified and live-ineligible under database constraints. No database is shipped in this package.

This adapter preserves raw workbook cells and all 39 supporting sheets, while separately retaining typed JSON-normalized fields in `budgets.normalized_json` and `items.normalized_json`. Monetary normalized values use integer cents. They are not approved costs. It is a research adapter, not an application schema migration or live retrieval integration.

V24-specific behavior:
- Raw academic year, normalized display text, exact single-year key, status and dash-normalized flag are separate. Qualified/historical/multi-year labels do not become a canonical academic year.
- Explicit value representation, nullable scalar/lower/upper cents, source period, basis, caveated handling and verification note. Bounds are never automatically additive. Unknowns remain null. Formula-derived source scalars are withheld.
- Workbook caveated decisions attach to their budget and, when appropriate, exact item. Unknown references, duplicate references and live permission are rejected. Conflicting alternatives stay separately labeled text; no authoritative cost is chosen.
- Dynamic counts come from actual records, including the Los Medanos published-versus-calculated-range category.
- Legacy period, role, category and pending checks remain. Numerical reconciliation does not grant approval. Missing included amounts may also reflect period/scope withholding, not only unpublished costs.

Fresh V24 import, repeat import, full raw/normalized record comparison, database integrity and gate checks are recorded in `validation/` at the package root. Tests are synthetic behavior checks plus the real workbook integration checks. No sources were newly verified for this correction, and no application repository was edited. Source/domain/category/role and current-cohort review remain necessary before integration or publication.

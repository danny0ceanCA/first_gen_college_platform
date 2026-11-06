# Isolated admin preview

This entry renders the real `AdminDashboard` and Network Effect Architecture page using the actual admin handler and PostgreSQL repository. Its database is an in-memory PGlite instance containing fictional English, Spanish, and mixed-language records.

From the repository root:

```powershell
node research/network-effects/admin-preview.mjs
```

Open <http://127.0.0.1:8792>. The existing isolated PGlite test runtime must be present under `research/network-effects/.local/pg-test-runtime/`. The preview does not install dependencies automatically.

Options:

```powershell
# Inspect the backend-disabled state.
node research/network-effects/admin-preview.mjs --port 8793 --disabled

# Inspect read-only reviewer permissions.
node research/network-effects/admin-preview.mjs --port 8793 --read-only

# Import an existing fictional calibration report; this never runs the model.
node research/network-effects/admin-preview.mjs --report research/network-effects/.local/calibration/RUN/report.json

# Use real fictional-model outputs for Evidence and Processing as well.
node research/network-effects/admin-preview.mjs --port 8794 --report research/network-effects/.local/calibration/v12-corrected-replay.json --replay-report
```

The report path must stay inside the local calibration folder, and every case must be marked synthetic. No account data is loaded. Restarting the preview discards review changes and recreates the fictional evidence.

`--replay-report` uses the last saved pass for each source, revalidates its retained
outputs in a fresh in-memory PostgreSQL database, and records rejected cases as
failed jobs. It makes no provider calls. The original candidate, evaluation and
local safeguard replay remain separately inspectable.

Check the Evidence filters and original-source inspector, save a review, inspect Processing, and inspect Evaluations after importing a saved report. Saving a review uses the evidence revision guard; it cannot alter the reported action or outcome.

The launcher disables the repository Vite configuration and `.env` loading. It binds only to `127.0.0.1`, supplies a temporary local token in memory, permits only the admin API route, and blocks external browser connections. It never starts the student app or a live voice session, and cannot run paid extraction.

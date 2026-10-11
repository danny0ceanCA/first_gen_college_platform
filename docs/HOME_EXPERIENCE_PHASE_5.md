# Home experience — phase 5: useful takeaways

Implemented locally on October 10, 2026. This phase turns the saved work from phases 2–4 into editable, reusable documents on the home page.

## What users can make

- **Counselor meeting preparation:** a goal, selected notes, questions, actions, and sources to bring to a meeting.
- **College comparison:** up to six options with program, location, study format, cost, requirements, questions, and a source URL.
- **Application checklist:** user-entered or copied actions with completion explicitly labeled as self-reported.
- **Financial aid comparison:** up to six offers with attendance period, cost of attendance, grants, scholarships, loans, and work-study separated.

Each sheet can be saved privately, reopened, edited, deleted, printed through the browser, or downloaded as text or a standalone print-ready HTML file. The HTML has a cream and terracotta layout, comparison tables, print styles, and no external fonts, scripts, or assets. Print / save PDF opens the browser's native print workflow; it does not upload the document to a PDF service.

English and Spanish controls and document headings are supported. Changing a sheet's language changes its headings, not the user's own text. Drafts stay in memory for the current account and student/family scope. A browser unload guard warns about unfinished drafts; unsaved drafts do not survive a reload. Changing the selected student preserves that student's draft in the current page session.

## Deliberate selection and review

Nothing from a conversation or profile is added automatically. The picker starts with every checkbox off and offers only saved notebook entries and accepted actions in active plans. Importing the saved profile goal and sources requires separate choices. A person's name is optional and blank by default.

The backend rechecks account ownership, student/family scope, and saved versions when copying selected items. A changed selection produces a recoverable error instead of copying stale content. Copied action details include personal target dates, labeled as personal rather than official deadlines. Suggestions that have not been accepted are excluded.

Copied material becomes independently editable sheet content. Editing or deleting a sheet does not change its source notes, actions, or summaries. Deleting an original conversation or note does not remove an already-saved sheet; the conversation deletion confirmation explains this. Account or student deletion removes the associated sheets. Downloaded or externally shared copies cannot be recalled.

Users review the complete document and confirm its contents before saving, downloading, printing, or preparing a message. Any edit resets that confirmation. Conflicting saves preserve the draft and offer refresh/review or saving a new copy.

## Sources and comparisons

Missing information remains explicitly unknown. There is no automatic claim that entered information is verified. Source URLs must use HTTPS; imported check dates describe historical checks and do not establish current accuracy. Changing a source URL clears its recorded check date. Current requirements and deadlines still need confirmation with the institution or official source.

Aid amounts use USD. The calculation subtracts only grants and scholarships from cost of attendance. Loans and work-study remain separate. Missing cost, grant, or scholarship values prevent a net-cost calculation; entering zero is distinct from leaving a value blank. Negative results are flagged for checking. Different or missing attendance periods trigger a comparison warning. These sheets organize information entered by the user; they do not determine eligibility, affordability, or final amounts owed.

## Preparing an institutional inquiry

The separate message composer starts empty. A user can add individual questions from the reviewed sheet and edit the message before copying it. The directory opens separately with no private information in the URL. Users then paste and review the message in the existing institutional inquiry flow.

This phase does not send a message, attach a sheet, email an institution, or grant an institution access to conversations automatically. There are no public sheet links. No additional AI, transcription, or search calls are used to create these documents.

## Storage and access

- Migration **033_workspace_sheets.sql** adds account-owned sheets and content-free create-retry receipts. Deploy after the earlier migrations, including 031 and 032.
- The authenticated `POST /api/workspace-sheets` handler supports load, prepare, create, update, and delete. Every operation resolves the authenticated account and verifies the exact requested student or family scope.
- Updates and deletes require the saved version. Create receipts retain a SHA-256 digest to prevent delayed retries from recreating a deleted sheet. Receipts contain no sheet text and are deleted with the account.
- Limits include 100 saved sheets per account, 40 document entries, 20 sources, six comparison options, a 65,000-character content limit, and a 120 KB request-body limit.
- Responses use `Cache-Control: no-store`. Request logging uses the known route name and does not log the body. Saved sheets are included in the existing account export; account/student foreign keys cascade deletion.
- Exported HTML escapes user text and includes a restrictive content security policy. Print frames are removed after printing, on scope cleanup, or by a fallback timer.

These protections apply to the new sheet feature. They are not a completed application-wide privacy/security audit.

## Verification and rollout

- TypeScript and the Vite production build passed. The existing Auth0 directive and large-bundle warnings remain.
- Full server suite: **393 passed, 10 skipped, 0 failed**. After the final source-date, comparison-period, and export refinements, the six focused sheet tests passed again.
- Repository/handler tests cover account and student/family boundaries, versions, retry receipts, selected source ownership, changed selections, deletion, account export, review requirements, request limits, HTML escaping, and missing-value arithmetic.
- Synthetic Playwright checks passed on desktop, 390px, and 320px widths: all four templates, selective imports, review gates, persistence across reload, scope separation, stale-save recovery, failed-load recovery, English/Spanish, and no automatic institutional sharing. Desktop, mobile review, and exported comparison layouts were visually checked.
- A separate print check verified reviewed content reaches the print frame and `afterprint` removes it. The native print dialog was stubbed; operating-system PDF output was not exercised.
- Browser APIs used synthetic account data and simulated backend responses. Backend tests used the repository's in-memory PostgreSQL fixture. Tests requiring a dedicated real PostgreSQL instance remain skipped. No production records, microphone recordings, paid model calls, or institutional messages were used.

Evidence: `output/home-sheets-phase5-tests.txt` and `output/playwright/home-sheets-phase5-*`.

This phase has not been committed, pushed, or deployed. Deploy the backend and frontend together with migration 033 before using the feature in production.

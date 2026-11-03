# Phase 5, step 2 — Reviewed reusable actions

Implemented locally on November 2, 2026, on `codex/evidence-informed-recommendations`. This extends step 1 with a reviewed action catalog linked to the existing teaching library. Both recommendation flags remain false by default. This step adds authoring and guarded retrieval; it does not select recommendations, deliver them to voice/binder, accept student actions, or collect evaluation data.

## Authoring and publication

Open an existing saved teaching in the admin Teaching library, then **Reusable action**. Authors can start with four independently written bilingual questions: identify the responsible office, clarify a requested document, confirm submission requirements, or check a pending insurance-waiver decision. These are editable drafts, not automatically published campus policies. The coordinator workspace is unchanged.

Each action has English/Spanish action wording and explanation, goal, process, prerequisites, exclusions, review date and review-by date. General questions contain no institutional policy claims. Campus requirements additionally need an exact campus name, official domain, term, and up to eight sources with stable IDs, HTTPS URLs, exact bilingual reviewed claims, checked dates and review-by dates. A source belongs to that template's campus/term scope. Each source's version is the containing publication revision; a changed claim requires a new publication. The initial institutional-source format supports US `.edu`/`.gov` domains, with no credentials, custom ports or unrelated hosts. It is not an exhaustive international source registry.

Save, preview the exact saved action, and complete three separate review confirmations: independent authorship without private cases, equivalent bilingual meaning, and reviewed claims/scope/sources/conditions. Publication requires a current published parent teaching. A server-generated preview digest binds the saved action revision and parent teaching publication revision. Concurrent changes invalidate the preview. Saving a replacement draft preserves the live publication until the replacement is reviewed and published, explicitly revoked, or otherwise invalidated.

An ordinary admin teaching permission or coordinator reply permission cannot publish reusable actions. The HTTP route requires current admin management permission, fresh authentication for changes and a successful access audit. The database additionally requires separately provisioned, process-scoped author/publisher capabilities. An author can save but cannot publish; a publisher can review and publish without author permission. Grants expire within 90 days. Changing/revoking a grant invalidates its existing publications; restoring the grant alone cannot reactivate them. The current grant, teaching revision, publication revision, expiry and blocked-publisher status are checked on retrieval.

The editor retains wording after a failed request, supports idempotent save retries, requires reloading after a publication conflict, and lets a reviewer reload to resolve an uncertain publication response. Navigation protects unsaved action edits. The publication and action histories are separate from ordinary teaching history.

## Retrieval boundary

`createReviewedActionCatalog` is internal and account-scoped, requires the existing adult student-owned eligibility checks and recommendation flag dependencies, and returns at most 50 current reviewed entries for the requested process. More matches produce an explicit unavailable result, never a silently truncated ranking. Calls have a three-second statement budget and create no student, exposure, decision or evaluation records.

An institutional entry must match the selector's exact campus name, official domain and term. These fields describe the **reviewed policy's scope**; they are not a confirmed student campus identity, an enrollment claim or the coordinator organization's identity. Every returned entry states `applicability: not_verified`, and the catalog states `eligibility: not_assessed`. All recommendation/acceptance/publication/evaluation authority bits remain false. Institutional entries require a current official lookup. In step 3, the server must independently resolve confirmed campus/term context, verify the exact policy and applicability, and satisfy every prerequisite/exclusion before converting any entry to a recommendation candidate. A domain match or authored claim cannot perform that verification.

Step 1's scope-free source resolver now resolves only current **general-question** template references. It refuses institutional templates because it lacks verified institutional context. References are exact publication versions; replacement, revocation, expiry, parent withdrawal/republishing/archive, publisher blocking or grant changes invalidate stale reads. Already accepted student actions remain independent.

There is no model tool or student endpoint for this catalog yet. Template claims remain untrusted data, with an exported reference boundary for later integration. They are never appended to the existing ordinary teaching prompt. Tests deliberately retain instruction-like text as data without granting authority; this does not claim automated detection of private wording, equivalent translations or false policy claims. Those require the publisher's content review. No student request, notebook, selected quote, conversation, private update or coordinator reply is imported into this authoring path.

## Database and operation

Migration `115_recommendation_library.sql` adds three RLS-protected library tables, operator-only grant/restore helpers, the scoped admin command and internal catalog read. Runtime receives only the scoped command functions; raw table access, the original renamed step-1 resolver and operator helpers remain denied. Apply migration and refresh runtime grants together. Recommendation readiness verifies migration 115 and command/helper isolation in addition to the existing foundation checks.

The operator can provision an author, a publisher, or both for selected processes using the migration credential:

```sh
node scripts/provision-recommendation-library.mjs \
  '<staff Auth0 subject>' 'author,publisher' \
  'office_contact,aid_documents,insurance_waiver' '<ISO expiry within 90 days>'
```

Use `revoke` instead of the expiry to withdraw the capability. This command changes only reusable-library permission, not Auth0 roles, coordinator access or student permissions. Nothing in this implementation provisions a real user automatically. Publication does not enable recommendation flags.

The public educational drafts and their revision history follow the teaching entry's lifecycle, with cascading removal on parent deletion. Hashed staff authorship is publication provenance, not student evidence. The privacy restore procedure expires every action-library grant and removes all template publications while retaining drafts/history for renewed review. Restored data cannot reactivate an old publication or grant. Rollback should keep the compatible schema, revoke/unpublish affected entries, and leave recommendation creation off; no student action requires deletion.

## Validation

- **105 tests passed; zero skips**, covering recommendation contracts/library, existing teaching delivery and situations, sharing policy, production configuration, outcome release, response context, student follow-up, account lifecycle and operational readiness/recovery.
- **Three real-browser/database journeys passed** at 1280, 390 and 320 pixels, each reviewing English and Spanish content. They cover lost save/publication responses, conflicting edits, exact preview, scoped institutional publication, revocation, unsaved-navigation protection and horizontal overflow. Screenshots were inspected.
- TypeScript, logging-policy check, environment-excluded production build and `git diff --check` passed. Vite retains its existing large-chunk advisory.
- The release verifier/CI now includes the new server suite and the three action-library browser journeys. Its existing Phase 4 journey matrix remains separately reported. The full combined release verifier was not rerun for this step.

Local evidence: `/tmp/phase5-step2-final-tests.log`, `/tmp/phase5-step2-build.log`, and `/tmp/origen-recommendation-library-browser/results.json`. Tests used isolated local PostgreSQL, synthetic identities/policies and a local browser preview with application credentials excluded. No production migration, permission grant, publication, feature enablement, real institutional source review or live provider call was performed.

Next: step 3's deterministic eligibility filter and explainable ordering. It must use these reviewed references alongside the student's permitted context, keep verified applicability separate from catalog matching, and provide a general question or clarification when a specific requirement cannot be verified.

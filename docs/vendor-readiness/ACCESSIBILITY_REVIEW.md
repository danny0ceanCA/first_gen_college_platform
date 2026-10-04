# Preliminary web accessibility review

Review date: October 3, 2026. Scope: local web institution entry/public-page routes, synthetic public content, desktop width 1280 and mobile width 375. This is a preliminary review, not an Accessibility Conformance Report or full WCAG audit.

## Changes made

- Added a keyboard-visible skip link that focuses the current main content without changing the application's hash route.
- Updated document language when institution/public and family-app language changes.
- Darkened institution small-text styles that used muted colors against white/pale backgrounds.
- Gave repeated link-removal controls indexed accessible names in the institution editor.

## Browser evidence

`scripts/accessibility-smoke.cjs` ran in headless Microsoft Edge through the bundled Playwright runtime. Published-page content and metrics responses were intercepted with synthetic fixtures; no university content was published and no production records were used.

Four route/viewport combinations passed: one main landmark, no horizontal page overflow at tested widths, no textless/unlabelled buttons detected by the narrow check, keyboard skip link focuses main content, and English-to-Spanish switch updates document language. Results: `artifacts/vendor-readiness/accessibility-smoke.json`; screenshot: `artifacts/vendor-readiness/institution-mobile.png`.

The script needs Playwright from the environment or `ORIGEN_BROWSER_MODULE_ROOT`, and optional `ORIGEN_BROWSER_CHANNEL=msedge`. Set `ORIGEN_PREVIEW_URL` to the local preview. It is not in CI because a browser runtime has not been provisioned there. Its accessible-name check is deliberately narrow and is not a full computed-name or accessibility-tree audit.

## Remaining evaluation before an ACR

| Area | Remaining work | Status |
| --- | --- | --- |
| Text alternatives and relationships | Inspect images/SVG, form groups, headings and error associations across all screens | Not fully evaluated |
| Keyboard/focus | Authenticated staff editor, reporting, review queue, export/closure, dialogs and voice | Public skip interaction checked; broader flows pending |
| Color/contrast | Measure all rendered text/states/focus indicators with a contrast tool | Selected styles improved; full contrast evaluation pending |
| Reflow/zoom | 200%/400% zoom, text spacing and long/multilingual institution content | Two widths checked; full evaluation pending |
| Screen readers | NVDA/VoiceOver names, landmarks, forms, statuses and focus restoration | Not evaluated |
| Errors and status messages | Field-specific errors, clear instructions, asynchronous announcements | Full flow testing pending |
| Motion | Landing/story animations and reduced-motion behavior | Source has reduced-motion handling; full evaluation pending |
| AI voice alternatives | Equivalent text interaction, transcript usability, controls and assistive technology | Not evaluated |
| Mobile/native | Native Auth0, profile editing and platform assistive technology | Excluded from this review |

Do not mark WCAG criteria “Supports” from these smoke checks alone. Prepare the full ACR after criterion-by-criterion evaluation with product version/date, methods, limitations and narrative explanations. Missing evaluations must be marked accurately rather than presented as conformance.

Reference: [Davis accessible software procurement](https://accessibility.ucdavis.edu/digital/procurement).

# Latest local call review and column controls

Call `4fbf8d93-abc7-4ba6-93fa-f0dd5aebff71`, ending November 12, 2026 at 11:52 AM Pacific.

## Conversation and research

The comparison accumulated Berkeley, Davis rental, Davis family and Riverside without erasing the previous campuses. Browser DOM commits followed report receipt in 14–48 ms. Worker processing intervals were 201–454 ms. All four research jobs returned catalog data; successful retrieval does not establish correct scenario selection or spoken interpretation.

Tuition-and-fee figures were spoken for Berkeley ($18,214), Davis ($18,263) and Riverside ($16,790). The $49 difference between the Berkeley and Davis tuition/fee groupings was correctly identified. The caller's concern about cost received a supportive response and an offer to explain the items. This is consistent with the caller's improved-flow impression; transcript evidence alone cannot establish exact audio pacing, interruptions or perceived warmth.

Two material errors remain:

1. The explicit Davis **on-campus apartment** request returned rental and family findings, not an on-campus apartment budget. Origen described an on-campus alternative and then asked rent-versus-family, which did not answer the requested scenario. The provider's housing recognition currently misses this wording and treats it as unresolved off-campus scope.
2. Origen later described Riverside's $44,329 total as higher than Davis's $44,760. It is **$431 lower** in the retained data. The original Riverside component discrepancy remains a separate source caveat. This review does not alter or validate those financial records.

The generic estimate-versus-bill explanation also repeated. No conversation, housing, arithmetic or provider behavior was changed during this UI task.

## Requested column controls

Added a light × to each table column heading with English/Spanish accessible labels. A removed column is hidden in the current call's view; incoming research does not automatically restore the same column label. Restore columns makes hidden columns available again. Scope/call reset clears visibility preferences. Retained source reports and all their values remain unchanged, and these actions send no voice cues or research requests.

Browser verification covered English removal, receiving a new campus while the column stayed hidden, restoration, and Spanish removal/restoration. Automated state tests cover preservation of source evidence, hiding all columns safely, restoration and reset. All 15 state tests passed; TypeScript passed. Visibility-only render diagnostics are labeled separately and do not report elapsed time since research receipt as a new load delay.

Screenshot: `output/playwright/research-desk/column-remove-preview.jpg`.

Nothing committed, pushed or deployed.

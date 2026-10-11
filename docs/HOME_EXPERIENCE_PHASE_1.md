# Home experience — phase 1

Implemented locally on October 10, 2026.

## User experience

- Home is the first navigation destination. The heading and surrounding language work for students and parents; student accounts do not see parent-only add-student controls on home.
- A selected-person card shows the saved education stage and goal or interests. Parent accounts can switch students without mixing their discussions.
- Three suggested starting points use the education stage and most recent saved topic. These are optional navigation choices, not accepted tasks, commitments, or evidence of progress.
- One cohesive summary is visible outside disclosures. Parents with family discussions can explicitly switch between the selected student and family summary.
- Discussed topics are derived from the saved planning, finance, admissions, and loans modes. They are shortcuts to existing sections, not a new notebook or inferred topic extraction. Onboarding records do not count as topic milestones. Loading, failure, and empty states are distinct.
- New users can explore without enabling their microphone. The bottom bar explains how to talk with Origen.
- The voice start/retry controls use a terracotta Origen ring with a visible adjacent label, a localized accessible name, keyboard focus, and a minimum 52px target. Onboarding and section launchers use the same control. Mute and end retain their distinct controls.
- Home-tour copy points to Home/Inicio and the circle control. A microphone/connection error now stays visible outside the optional conversation details.

## Scope and data

No schema migration, new endpoint, or new model request is required. Existing summary generation and translation remain in place. Profile notes are displayed as entered; switching the UI language does not rewrite saved user text.

Topic metadata stays within the selected student's saved records. A family summary must be selected explicitly. Deleted history naturally removes derived topic shortcuts. A fresh user receives suggestions and an honest empty state, without invented topic activity.

The later topic notebook, editable takeaways, durable plan integration, and topic-specific voice memory remain future phases. Browser-local plan state is deliberately not presented as an authoritative home task list in this phase.

## Validation

- Production TypeScript/Vite build.
- Focused tests for topic ownership, chronological ordering, deletion, summary ownership/translation, and voice continuity/onboarding.
- Playwright checks using synthetic accounts and intercepted APIs: desktop, 390px/320px mobile, Spanish, first-time users, student/family switching, real topic navigation, history failure, and circle start/retry behavior with simulated microphone denial.
- Screenshots under `output/playwright/home-phase1-*.png` use synthetic data. No real voice/model requests were made during browser checks.

Changes have not been committed, pushed, or deployed as part of this phase.

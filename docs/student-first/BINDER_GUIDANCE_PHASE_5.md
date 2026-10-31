# Binder guidance loop — Phase 5

Implemented locally on October 31, 2026: situation-aware teaching references. This extends the existing teaching library and phases 1–4; it does not train model weights, publish educator content automatically, or change sharing permissions.

## Educator workflow

Admin → Teaching library now includes three optional fields: **Concern or misunderstanding**, **When to use this teaching**, and **When to skip the follow-up**. They complement the existing explanation, tone, conversational approach, example, follow-up, and referral fields. Preview displays the new fields. Teach Origen can capture them from the educator's interview; unsupported fields remain empty.

An optional starter menu offers eight editable, fictional drafts: college options, transfer questions, essays, and affordability, in English and Spanish. They are proposed material for the educator to adapt, not attributed quotations or approved policy. Choosing one prefills an unsaved draft. Review dates start blank. Saving, reviewing, and publishing remain distinct actions; existing teachings are unchanged.

## How Origen receives and uses it

- Existing voice starts and context updates use the latest user turn, or an explicitly selected authorized binder item when there is no user turn, as a bounded relevance query. Onboarding and unresolved student routing do not supply a situation query. The lookup does not sweep all history or unselected family material.
- Within the existing published, unexpired, language/topic/campus/year-eligible set, lexical matches against concern, use context, and keywords improve ranking before the six-reference limit. Existing research keyword eligibility remains intact. Empty queries retain the prior ranking. This is a transparent hint, not semantic understanding or proof that a student has a misconception.
- Regular voice and admin test instructions receive the structured teaching. Live's spoken delivery preferences also receive the concern, use context, optional follow-up, skip conditions, and referral alongside tone, approach, and example. Dynamic updates retain the existing bounded UTF-8 chunk transport.
- Instructions call for explaining the idea before terminology, responding to the concern actually expressed, and asking at most one useful follow-up. Already answered, declined, or irrelevant questions should be skipped. Coordinator suggestions remain optional; explored or deferred guidance is not reopened merely to apply a teaching.
- An occasional concrete application question can check understanding naturally. Retrieval, a matching phrase, discussion, or a yes is not evidence of understanding. No comprehension score or automatic progress state is added. Institutional judgment and individual financial-aid calculations remain referrals.

The existing activity log still records references supplied, not proven influence on a response. Query text is not added to that log.

## Data and rollout

Pending migration **094_teaching_situations.sql** adds optional-field constraints to draft and published JSON and replaces the existing restricted lookup function. Existing entries and revision history are preserved. It adds no runtime table grants or new public endpoints; the existing function permission is retained and PUBLIC access remains revoked.

The migration was exercised only in an isolated local PostgreSQL test schema. Production migrations, content publication, deployment, commit, and push have not been performed for this phase.

## Verification

- 52 teaching, admin voice, and student Live tests passed with no skips. They cover optional/bounded fields, old-content compatibility, interview schema, eight bilingual delivery cases, Live update chunk reassembly, actual PostgreSQL relevance ranking, draft/publication separation, unpublish, language/campus/year restrictions, and restricted runtime access.
- 59 existing binder-context, next-step, coordinator-context, feedback, follow-through, adaptive guidance, workspace, and plan tests passed with no skips using isolated PostgreSQL.
- The real teaching editor was exercised in a synthetic local browser harness: example prefill, unique new fields, failed-save preservation and successful retry, Spanish preview, and phone-width overflow check. API responses in this UI harness were simulated; database lifecycle checks used the real test database separately.
- TypeScript and the production build passed. Git whitespace checks passed.

These are delivery and behavior-contract checks. No paid live conversations were run in this phase, so natural empathy, pacing, and actual adherence have not been demonstrated by these tests. Model behavior can vary.

## Small live acceptance check before rollout

Review and publish only the sample material you want to test. Use fictional scenarios in both languages, then inspect the complete responses, not just retrieval counts:

| Situation | Desired behavior | Follow-up / boundary challenge |
| --- | --- | --- |
| “I don't know where to start choosing colleges.” / “No sé por dónde empezar a elegir universidades.” | Explain fit and offer one manageable starting point. | If a preference is already stated, use it instead of asking again. |
| “I'm not sure my classes will transfer.” / “No sé si mis materias se transfieren.” | Clarify the uncertainty and suggest a useful question for an advisor. | Preserve tentative plans; do not assert credit equivalence or calculate a pathway. |
| “I have nothing worth writing about.” / “No tengo nada que valga la pena contar.” | Acknowledge the doubt warmly, explain why ordinary experiences can matter, invite one comfortable example. | When the student supplies an example or declines, respond to that choice rather than repeating the prompt. Do not invent hardship. |
| “Why did my friend get a different aid offer?” / “¿Por qué mi amigo recibió otra oferta de ayuda?” | Explain how the college understands differing circumstances before jargon. | Refer individual amounts and eligibility to financial aid; do not request unnecessary family details. |

Also test an unrelated question, a deliberately set-aside coordinator suggestion, and a student who says “yes” without explanation. Pass only when Origen respects those choices and does not infer mastery or completion. Failure should lead to a specific retrieval, instruction, or teaching-content correction, not broader collection of personal information.

## Limits and next work

Lexical ranking can miss paraphrases, especially across accents or vocabulary; only the current topic and eligible language are searched. Existing bounded reference limits still apply. A reference arriving in a conversation does not establish that it was followed. Phase 6 can measure understanding, repetition, follow-through, and coordinator effort with a small reviewed pilot rather than expanding the data model or claiming a proprietary advantage prematurely.

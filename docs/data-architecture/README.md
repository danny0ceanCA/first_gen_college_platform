# Origen data architecture — phase 1

Design baseline: October 6, 2026. Phase 1 delivers the architecture, data dictionary, event definitions and implementation backlog. It does not create database tables, change collection, authorize research access, or train a model.

Origen already has a useful operational PostgreSQL database. The next improvement is a traceable history: which account used guidance, which student the user confirmed, which topics were discussed, which sources and model versions informed the answer, and what progress followed. Research use requires an additional permission and governance boundary.

## Deliverables

- [Architecture and collection rules](ARCHITECTURE.md): identity, conversation scope, history, research separation and lifecycle.
- [Data dictionary](DATA_DICTIONARY.md): existing tables and proposed records, including evidence limitations.
- [Event catalog](EVENT_CATALOG.md): collection contracts and defensible measurement definitions.
- [Implementation backlog](IMPLEMENTATION_BACKLOG.md): ordered work, acceptance criteria and rollout gates.
- [Phase 2 implementation and rollout](PHASE_2.md): operational history implemented in source, not deployed/enabled by this task.
- [Vendor readiness packet](../vendor-readiness/ASSESSMENT_PACKET.md): institution operations, procurement, privacy and security evidence.

## What the review established

The baseline covers migrations 001–014 and their account, history, planning, institution, voice and logging handlers. This is a source-based design review; this phase does not inspect individual production records or verify provider agreements and backup settings.

Accounts have unique internal UUIDs and Auth0 subjects. Students have account-scoped identifiers, with explicit family links. Summaries have topic labels and optional student scope. Plans have version checks. Institution reporting has separate aggregate counters. These are sound foundations, but current plan/profile updates overwrite earlier values, and summaries do not have explicit model, prompt, session or language columns. Operational diagnostics are not a durable research event history.

## Decisions for the next implementation

1. Keep operational records, model evaluation and authorized research datasets separate, even if initially hosted in the same PostgreSQL instance.
2. One voice session may span topics and confirmed student scopes. Changing topic must not require restarting the session. Attribute each saved result to its actual scope.
3. Preserve the distinction between what a user reports, what AI proposes, what the user confirms, and what an official source establishes.
4. Collect structured, minimal events and version references before considering transcripts. Do not add raw audio retention.
5. Institution membership does not grant access to family records. Research requires study-specific permissions and reviewed exports.
6. Improve prompts, source retrieval and tools through evaluations first. Training datasets require their own permission and provider review; collecting data does not automatically train models.

## Roadmap and completion gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| 1 — design | This documentation and implementation contracts | Source inventory and references checked; proposed collection clearly separated from current behavior |
| 2 — reliable history | Sessions, segments, minimal events, configuration versions and durable AI/tool provenance | Scope, retry, deletion and access tests pass; notices and retention adopted |
| 3 — progress | Profile/plan history, optional feedback, defined outcomes and measurement instruments | Reported versus verified outcomes distinguished; denominator and missingness documented |
| 4 — model evaluation | Synthetic test suite, versioned evaluation runs, quality/cost/latency comparisons | English/Spanish, topic changes, student changes and source accuracy evaluated |
| 5 — research controls | Studies, permission history, restricted participant mapping and governed datasets | Partner protocol and required reviews settled before research collection/access |
| 6 — operational readiness | Access review, restore/deletion exercises, accessibility and provider evidence | Evidence supports contractual commitments |
| 7 — paid pilot | Scoped agreement, baseline measurements, agreed deliverables | Sponsor, budget, scope, approvals and success criteria agreed |
| 8 — recurring offering | Repeatable service and reporting | Demonstrated value and sustainable support/costs |

Phase 1 is complete when these design documents are checked. Later implementation has not started merely because it is specified here. Partner decisions may refine the design without blocking the documentation.

## Research and revenue preparation

A useful discovery conversation with a prospective partner can begin now using a synthetic demonstration and this architecture. Clarify the research question, population, outcomes, protocol, budget and acceptable data access before promising a dataset. Potential paid deliverables include implementation/support, institution pages, approved aggregate reports and a separately governed evaluation pilot. This is not a plan to sell private student conversations, nor a guarantee of research funding.

UC Davis's [California Education Lab](https://education.ucdavis.edu/california-education-lab) is relevant to college preparation and transitions. The partner should determine whether an activity needs research review using its [IRB guidance](https://irb.ucdavis.edu/IRB-submissions/do-i-need-irb-review/) and [privacy guidance](https://irb.ucdavis.edu/project-guidance/privacy-and-confidentiality/). Procurement, security, accessibility and research approval are separate decisions; this packet claims none of them.

Open decisions: accountable privacy/data owner; adopted retention schedule; adult/minor and multi-person permission rules; pilot population and outcomes; hosting/backup evidence; approved researchers; permitted model-improvement uses; and withdrawal handling after a dataset has been released.

Phase 3 source implementation and rollout: [PHASE_3.md](PHASE_3.md). Collection remains disabled until the documented staging and ownership gates are met.

Phase 4 evaluation framework and acceptance limits: [PHASE_4.md](PHASE_4.md). Actual model-response evaluation and human release approval remain pending.

Phase 5 synthetic governance sandbox: [PHASE_5.md](PHASE_5.md), with a [partner protocol worksheet](PARTNER_PROTOCOL_WORKSHEET.md). Live research remains unavailable pending partner decisions and review.

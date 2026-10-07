# Data dictionary

Source baseline: migrations 001–014 and `server/database.mjs`, October 6, 2026. Proposed table names below are design names, not existing SQL objects. PostgreSQL `timestamptz` values represent instants; serialize UTC. A date without time, such as a plan due date, is not an instant.

## Current records

PK means primary key. Composite keys and foreign keys must remain account-scoped. Except where stated, current personal records have no adopted automatic inactivity expiry. Application access is through authorized handlers, not direct institution SQL access.

| Table / grain / key | Columns and meaning | Provenance, access and lifecycle |
| --- | --- | --- |
| `origen_accounts`: one account; PK `id` UUID | `auth0_subject` unique text; `first_name`, `email` text; `role` nullable parent/student; `welcome_heard_at`, `voice_used_at` nullable first-use timestamps; `created_at`, `updated_at` | Verified auth subject; contact/profile and role selections. First-use timestamps do not prove introduction comprehension or completion. Private account. Account lifecycle handler performs eligible closure; issuer is not a column today. |
| `origen_students`: one account-local profile; PK `(account_id,id)` | `account_id` UUID FK; `id` text; `name`, `stage`, `interest`, `gpa`, `color`, `institutions`, `entry_term`, `school`, `activities`, `goals`, `needs`, `notes` text; `created_at`, `updated_at` | User-reported/confirmed information; fields overwrite. Explicit links share academic fields; private needs/notes/history stay scoped. Account/student deletion cascades. No verified age, enrollment or GPA evidence. |
| `origen_conversation_summaries`: one saved summary; PK `(account_id,id)` | `account_id` UUID FK; `id` text; `student_id` nullable text composite FK; `mode` text; `summary` text; `sources` JSON array; `conversation_at`, `created_at` | AI-generated/imported text, not ground truth. Null student means private family-wide scope. Sources include validated title/URL/checkedAt where supplied. Conversation date is client supplied and validated; creation is database time. Cascades on account/student deletion. No explicit session, language or model version. |
| `origen_local_imports`: one device-type import receipt; PK `(account_id,source)` | `account_id` UUID FK; `source` web/mobile; `imported_at` | Migration receipt, not user activity. Account cascade. |
| `origen_history_imports`: one history-import receipt per account; PK `account_id` | `account_id` UUID FK; `imported_at` | Import deduplication. Account cascade. |
| `origen_student_links`: one explicit owner/member association; PK `id` UUID | `owner_account_id`, `member_account_id` UUID; `owner_student_id`, `member_student_id` text; `member_role` parent/student; `created_at` | Both student composite FKs cascade. Distinct accounts; unique owner/student/member-account and member-account/member-student. Does not grant research consent or merge private histories. |
| `origen_family_invites`: one sharing invitation; PK `id` UUID | `owner_account_id` UUID, `student_id` text composite FK; `target_role`; unique `token_hash` text; `expires_at`, `consumed_at`, `revoked_at`, `created_at` | Hash instead of raw token. Seven-day default expiry; hourly expired-record cleanup in API. Student cascade. Raw invite URLs on devices require separate cleanup. |
| `origen_plans`: one current plan; PK `(account_id,id)` | `account_id`, `id` UUID; nullable `student_id` text; `title`, `goal`; `category`, `status`; positive integer `version`; `created_at`, `updated_at` | Private user/AI-assisted plan. Account/student FKs cascade. Version is optimistic concurrency, not an immutable revision history. |
| `origen_plan_steps`: one current step; PK `(account_id,plan_id,id)` | `account_id`, `plan_id` UUID; `id` text; nonnegative integer `position`; `title`, `action`, `notes`; `status`; nullable `due_date` date | Position unique within plan. Plan FK cascades. Step completion is reported progress, not proof of admission or requirement fulfillment. Updates replace current step records. |
| `origen_plan_sources`: one ordered step reference; PK `(account_id,plan_id,step_id,position)` | `account_id`, `plan_id` UUID; `step_id` text; `position` integer; `title`, `url` | Step FK cascade. Reference is not independent verification of a requirement. |
| `origen_plan_conversations`: one plan/summary association; PK `(account_id,plan_id,summary_id)` | `account_id`, `plan_id` UUID; `summary_id` text | Plan and summary FKs cascade. Update can replace these associations. |
| `origen_institution_representatives`: one representative identity; PK `auth0_subject` | `auth0_subject`, `first_name`, `work_email`, `job_role` text; `created_at` | Separate from family accounts. Private staff metadata. Does not include issuer today. Institution closure needs separate handling. |
| `origen_institutions`: one institution page; PK `id` UUID | unique `slug`; `verification_status`; `status`; positive `revision` integer; `draft` JSON object; `published` nullable JSON; `published_revision` nullable integer; `created_at`, `updated_at`, `published_at` | Draft restricted to staff/reviewers; published approved snapshot public. Revision control is not a complete immutable content archive. |
| `origen_institution_members`: one staff membership; PK `(institution_id,auth0_subject)` | `institution_id` UUID FK; `auth0_subject` text representative FK; `role` owner/editor | Both FKs cascade. Membership grants institution management/reporting, not family access. |
| `origen_institution_reviews`: one review decision; PK `id` UUID | `institution_id` UUID FK; `revision` integer; `reviewer_subject`, `action`, `note` text; `created_at` | Actions verify/publish/request-changes. Institution cascade. Review notes must exclude confidential documents. Retention and staff governance remain to adopt. |
| `origen_institution_metrics`: one institution/month/metric counter; composite PK | `institution_id` UUID FK; `month` text YYYY-MM at handler level; `metric` page_view/link_click; `count` nonnegative bigint | Aggregate accepted requests, not unique people; no visitor IDs. Member reports use previous completed UTC month; counts below 10 withheld. Current and previous 11 calendar months retained through cleanup. Institution cascade. |
| `origen_closed_accounts`: one closed-subject receipt; PK `subject_hash` | SHA-256 subject hash text; `closed_at` | Prevents valid-token recreation after closure. Pseudonymous retained exception, no configured expiry. Not a research identity. |
| `origen_subject_locks`: one durable subject lock key; PK `subject_hash` | Subject hash text | Coordinates lifecycle writes; survives deletion, no configured expiry. Not an activity log. |
| `origen_schema_migrations`: one applied migration; PK `name` | `name`, `checksum` text; `applied_at` | Created by migration runner. Integrity/deployment metadata, not user data. Applied migrations must not be edited. |

### Current enums and limits

- Student stage: empty, 9th grade, 10th grade, 11th grade, 12th grade, Community college, College. Stage alone is not an age check.
- Summary mode: profile, finance, admissions, planning, loans. These are current topic identifiers; support navigation is not another stored enum automatically.
- Plan category: education, courses, transfer, degree, career, financial, other. Plan status: active/archived. Step status: not-started/in-progress/complete.
- Institution verification: pending/verified. Publication state: draft/submitted/changes-requested/published.
- Account subject: 1–255 characters; account contact name up to 100 and email up to 320. Student ID: 1–128; name: trimmed 1–100. GPA is text up to 30; interest and other academic/private text fields up to 2,000; color up to 40.
- Summary SQL permits trimmed text up to 12,000; generated handler summaries are bounded more tightly (4,000 characters). Do not assume generated output and import limits are identical.
- Plan titles: 1–200; goal/action/notes up to 4,000. Step-source title: 1–300; URL up to 2,000. Review note: 1–2,000.

### Outside PostgreSQL

Transient microphone audio goes through WebRTC/OpenAI, and transcripts support guidance/summary generation. Preview/device storage holds additional copies. Diagnostic logs contain allowlisted technical metadata, with local size rotation; they have no database session FK or reliable research denominator. Provider retention and backups require verification. OpenAI `store:false` is not evidence of universal zero retention.

## Phase 2 schema supplement

Migration [015](../../server/migrations/015_guidance_history.sql) implements a subset of the design below. See [phase 2 behavior and rollout](PHASE_2.md). Collection is disabled by default; these tables are created on migration, not by this documentation.

| Current phase 2 table | Key and fields / distinction |
| --- | --- |
| `origen_account_identities` | PK issuer/subject; account UUID FK, created time. Explicit single-issuer mapping; no automatic email linking. |
| `origen_representative_identities` | PK issuer/Auth0 subject; representative FK, created time. Separate from family identities. |
| `origen_ai_configurations` | Hash key; requested model, operation, prompt/tool hashes, policy version, application revision, creation time. No personal instructions. |
| `origen_guidance_sessions` | PK account/session UUID; stored actor role or unknown, initial language, start/end/activity times, end reason, monotonic next ordinal. Production authenticated metadata only. |
| `origen_guidance_segments` | PK account/segment UUID; session FK, ordinal, topic, target kind, nullable student FK/pending onboarding ID, configuration reference/state, start/end times. Prepared versus browser-applied distinguished. |
| `origen_guidance_events` | PK account/event UUID; session/segment FKs, producer, name, nullable browser sequence, occurrence/receipt times, version, typed payload. Committed local outbox. |
| `origen_ai_executions` | PK account/execution UUID; session/segment/configuration references, operation/status, timing, safe request/error IDs, nullable token usage and resolved provider model. Unknown audio usage/cost not inferred. |
| `origen_tool_calls` | PK account/execution; execution FK, name/version/status, retained source count and JSON source references. Separate `origen_source_references` is still proposed; no query/text bodies. |
| `origen_summary_segments` | PK account/summary/segment; summary/segment FKs, language, summary-configuration reference. Display text stays in existing summaries; translations/revision history are later work. |
| `origen_guidance_summary_intents` | PK account/summary; session FK, segment IDs, pending student ID, language/configuration. Reconciles when a reviewed new profile and summary are saved; metadata expires with session. |

Dependent operational records cascade on session expiry/account closure; student-scoped segment references cascade on student removal. Configuration/identity records have their separate reproducibility/lifecycle rules. Account export includes relevant configurations. This supplement does not claim a deployed migration or active collection.

## Proposed records — implementation contracts

All proposed personal records inherit authenticated ownership, explicit sensitivity and lifecycle coverage. UUID keys, server creation time and schema versions are preferred. JSON is acceptable for tightly validated versioned structures, not arbitrary transcripts or sensitive argument dumps. Foreign keys must prevent cross-account attribution.

| Proposed record / grain | Minimum fields | Constraints / purpose |
| --- | --- | --- |
| `origen_account_identities`: one verified issuer/subject | `id`, `account_id`, `issuer`, `subject`, `created_at` | Unique `(issuer,subject)`; account FK. Identity linking requires proof, never matching email alone. |
| `origen_guidance_sessions`: one call | `id`, nullable `account_id`, `environment`, `actor_role`, `started_at`, `ended_at`, `last_activity_at`, `end_reason`, `initial_language`, `client_kind`, `schema_version` | Environment production/preview/test; no account for preview. Role snapshot and first-use marker separate. End reasons completed/disconnected/failed/abandoned, without fabricating completion. |
| `origen_guidance_segments`: one effective topic/target interval | `id`, `session_id`, `ordinal`, `topic`, `target_kind`, nullable target account/student pair, `confirmation_event_id`, `started_at`, `ended_at`, `configuration_version_id` | Unique session/ordinal. Target unresolved/family/student; student composite FK and verified access required. Immutable completed boundaries; no cross-scope transcript reuse. |
| `origen_summary_segments`: one summary attribution | `account_id`, `summary_id`, `segment_id`, `summary_revision_id` | Link existing summary composite key to authorized segment(s). Legacy summaries may remain unlinked. |
| `origen_summary_revisions`: one permitted text/translation revision | `id`, summary composite key, `revision`, `language`, `origin`, `configuration_version_id`, `created_at`, `supersedes_id`, `text` | Translation references source revision; preserves meaning and provenance. Restricted content, not routine telemetry. Keep one current display summary while preserving permitted lineage. |
| `origen_guidance_events`: one allowlisted event | Envelope from event catalog; typed `payload`, `payload_version`, `producer`, `trust_level` | Unique producer/session/event key. Server validates scope. Client-reported facts labeled accordingly; bounded size and retention. |
| `origen_ai_configurations`: one immutable configuration version | `id`, `model_id`, `prompt_version`, `prompt_hash`, `tool_schema_version`, `retrieval_policy_version`, `language_policy_version`, `application_revision`, `created_at` | No secrets/user data in prompts registry. Preserve permitted configuration artifact for reproducibility. |
| `origen_ai_executions`: one response operation | `id`, `session_id`, `segment_id`, `configuration_version_id`, `operation`, `status`, `started_at`, `finished_at`, `upstream_request_id`, safe error code, nullable token/audio usage and cost estimate | Unknown usage stays null, never zero. Currency, price-version and estimate basis required. No response text by default. |
| `origen_tool_calls`: one tool invocation | `id`, `execution_id`, `call_id`, `tool_name`, `tool_version`, `status`, timing, safe error code, `cache_status`, `source_count` | Unique invocation key. No raw arguments/results in analytics; permitted typed query category only. |
| `origen_source_references`: one source/version used | `id`, `tool_call_id`, `url`, `publisher`, `title`, `fetched_at`, nullable `effective_period`, nullable content/version hash, `availability_status` | URL/title scrubbed of personal queries and credentials. Distinguish unknown effective period from current verified policy. References do not prove answer accuracy. |
| `origen_profile_observations`: one accepted/rejected field proposal | `id`, account/student pair, `field`, typed before/after value, `origin`, `confirmation_status`, actor ID, segment ID if applicable, `observed_at` | Origin user-reported/AI-proposed/imported/verified-source. Sensitive values private; do not export automatically. Preserve provenance; no retroactive invented history. |
| `origen_plan_revisions` / `origen_step_transitions`: one plan snapshot / transition | Plan composite key, revision and snapshot; step stable ID, before/after status, actor, origin, segment if applicable, time | Atomic with current-plan write. Snapshot FK independent of replaceable current step rows. Reported completion distinguished from independently verified outcome. |
| `origen_measurement_definitions` / `origen_measurements`: one instrument version / response | Definition ID/version, question/scale/unit, purpose; response ID, account/student or study participant scope, instrument version, value, source, measured_at, missingness reason | Optional questions; no unvalidated claim of learning improvement. Explicit declined/not-asked/unknown distinct from zero. |
| `origen_studies` / `origen_study_enrollments`: one protocol version / enrollment | Study ID, purpose, protocol version, review status/reference, permitted fields/uses, retention; enrollment ID, participant ID, status, enrolled/withdrawn times | Separate research service privileges. Enrollment cannot bypass reviewed permission for every affected data subject. |
| `origen_permission_events`: one grant/revoke decision | `id`, subject scope, purpose, study if applicable, notice/version, action, actor/authority basis, language, server time | Append-only evidence with controlled correction. Separate product/research/model-improvement purposes. No default opt-in. |
| `origen_study_identity_map`: one restricted participant mapping | Study/enrollment participant ID, account/student references, mapping version, created_at | Separate grants/storage boundary; no researcher default access. Define linked-person deduplication and withdrawal before use. |
| `origen_evaluation_cases` / `origen_evaluation_runs` / `origen_evaluation_ratings` | Case/version, synthetic or permitted dataset provenance, rubric/version; run/config/version/time; rating dimension, evaluator, score, evidence reference | Synthetic default. Distinguish automatic scoring from human review; preserve reviewer disagreement. No personal excerpts without separate authorization. |
| `origen_dataset_releases` / `origen_data_access_audits` | Study, release/version, query hash, field list, interval, recipient, permission check time, checksum, counts/exclusions; actor, action, resource, result, time | Export manifests and audits are restricted. Re-check permissions per release. Track withdrawal handling and permitted use limits. |

Session/history retention follows the proposed schedule in [architecture](ARCHITECTURE.md). Study and training records cannot be collected merely because their names appear here; complete the corresponding review gates first.

## Phase 3 additive source (migration 016; collection off by default)

| Table / grain | Fields and provenance | Lifecycle / access |
| --- | --- | --- |
| `origen_profile_observations`: one accepted changed academic field | UUID id; account/student; field; previous nullable and reported text values; user-reported/imported/linked-account origin; server recorded_at. Names/colors/private notes/needs omitted. | Private canonical account history; student/account cascade; 90-day cleanup. Reported GPA/school remain unnormalized. |
| `origen_plan_revisions`: one accepted plan version | Account/plan/version composite PK; JSON snapshot with stable step IDs and sources; server recorded_at. No summary contents copied. | Same save transaction; plan/account/student cascade; 90-day cleanup. |
| `origen_step_transitions`: one step state change in a revision | UUID; account/plan/version FK; stable text step_id; added/removed/status-changed; previous/reported statuses. No FK to replaced current step row. | Revision cascade; same private account scope. Completion is reported, not verified. |
| `origen_measurement_definitions`: one versioned instrument definition | Definition ID/version PK; bilingual question, named choices, service purpose, validatedResearchInstrument=false. | Nonpersonal deployment configuration; new meanings require new versions, not silent edits. |
| `origen_progress_reports`: one optional feedback submission or reported milestone | Account/report UUID PK; optional account-local student; kind; definition/version for feedback; answered/declined/unknown; nullable categorical value; language; optional reported occurrence date; server recorded_at. | Idempotent account-scoped ingestion, 1,000 retained submissions cap; account/student cascade; 90-day cleanup. No verified flag or external source claim. Unobserved exposure remains unknown, not zero/declined/not-asked. |

These five new tables bring source schema inventory to 34 tables including migration bookkeeping (baseline 19 + phase 2 ten + phase 3 five). Readers/export are account-scoped; ordinary institution membership provides no access. Phase 3 implementation and rollout limits: [PHASE_3.md](PHASE_3.md).

Phase 5 adds a separate nine-table in-memory synthetic research lab, not production records or migrations. Study versions, recipient grants, participants, restricted mappings, permission events, measurements, manifests/membership and audits are described in [PHASE_5.md](PHASE_5.md). The live schema count remains 34.

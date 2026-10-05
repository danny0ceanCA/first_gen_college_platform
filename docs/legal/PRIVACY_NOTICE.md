# Origen Privacy Notice

**Recommended version for owner and independent review — not yet published.** Version: recommended-2026-10-04. Effective date: [publication date]. Responsible operator: [full legal name and business address]. Privacy contact: [confirmed email]. This version reflects source code reviewed on October 4, 2026; production configuration and provider retention must be verified before publication. See REVIEW_GUIDE.md for a focused review checklist.

## 1. Scope and plain-language overview

This Notice explains personal information handled through Origen's website, applications, public preview, and available college-guidance features. We use account, student, and conversation information to provide the features you request. AI guidance involves sending relevant information to OpenAI. Live voice sends microphone audio to OpenAI. A family link or institution registration does not automatically expose private conversations to a school or other family member.

You can browse public information without creating a family account. Public preview profiles may use fictional examples. Preview information you add may stay in your browser; shared-device users could see it. Do not put confidential information into a preview. Available features and account controls may differ between the web application and native mobile releases.

## 2. Information we collect and where it comes from

| Category | Examples and source | Purpose |
| --- | --- | --- |
| Account and authentication | Name, email, identity-provider account identifier, sign-in status, and authentication information returned by the configured login provider; information you or the provider supply | Sign-in, account access, support, account security |
| Student and family planning | Student name, educational stage, school, GPA, interests, activities, goals, practical needs, notes, selected institutions and terms; supplied by you or an authorized linked participant | Personalized guidance, profiles, plans, requested family collaboration |
| Conversations and AI context | Questions, messages, selected profile details, relevant past summaries, recent conversation context, generated answers, plans, and summaries | Answering questions, continuity across guides, saving useful planning history |
| Live voice | Microphone audio, speech recognition text, AI voice responses, and session context while you use voice | Live guidance and subsequent summary generation |
| Experience markers | App-visit and voice-use indicators and whether the welcome introduction has been heard; stored in account records or browser storage as applicable | Avoiding repeated introductions and maintaining continuity |
| Family links | Invitation and membership information, linked record identifiers, selected shared academic fields | Establishing and managing requested links |
| Institutional information | Representative name, work email, role, affiliation, membership, page submissions, public contact information, review actions and notes | Affiliation review, page management and publication |
| Technical and usage information | Request timing, safe error codes, diagnostic information, browser storage, aggregate institution view/click counts; providers may also process IP addresses, device and request metadata | Operating, securing, troubleshooting and measuring the service |
| Support communications | Information you send when asking for help or exercising a privacy request | Responding, verifying authority and resolving the request |

Not every category is collected in every session. Voice is optional. Browser permission is required to access your microphone. We do not need tax documents, Social Security numbers, account passwords, bank-account numbers, payment-card details, or confidential medical records to provide college guidance. Avoid entering them, including in free-text fields or spoken questions.

## 3. How we use information

We limit access to people and providers who need information for an authorized purpose. We do not treat information supplied for guidance as permission to publicly endorse Origen, contact a school on your behalf, or send marketing. Any optional marketing permission must be separate from account registration and can be withdrawn. A request to an external school or other recipient must make the recipient and intended information clear before transmission.

We use information to provide and personalize requested guidance; maintain profiles and plans; generate and save summaries; remember relevant context across specialized guides; avoid repeating welcome explanations; manage authorized family links; review and publish institutional pages; authenticate accounts; respond to support and privacy requests; prevent misuse; diagnose failures; and meet legal obligations.

We do not promise that generated guidance or summaries are accurate. You can review and correct supported records. Origen is not intended to make binding admissions, credit, employment, or financial-aid eligibility decisions. No institution receives your private profile or conversations solely because you browse its page.

## 4. AI processing and microphone use

OpenAI provides AI text, voice, and summary processing. Depending on the feature, relevant profile details, questions, conversation context, previous summaries, and tool inputs are transmitted to OpenAI. Starting live voice transmits microphone audio and session context. Speech recognition may misunderstand names or statements. Generated summaries describe the discussion and may contain errors; they are distinct from a verbatim transcript.

The reviewed application stores conversation summaries for account history rather than raw microphone recordings in its own account database. To recover an interrupted save, conversation text and its student/general-family context may be kept in this browser for up to 24 hours from the latest checkpoint and sent for summary generation. These temporary records are removed after a successful save; they can be accessible to another person using the same browser. They are scoped to the signed-in account or the preview. This does not mean audio or transcripts are never processed or retained by a provider. Some requests use a setting that disables stored responses; that setting alone does not establish zero retention, exclusion from every provider log, or a particular training policy. Provider terms, actual project settings, and any applicable retention exceptions must be verified before we publish specific promises about them.

The application may use previous summaries and account experience markers to continue a discussion without repeating the same explanations. Stop a voice session or revoke microphone permission in your browser/device settings to stop further capture. Stopping does not recall information already transmitted. You can use available nonvoice features instead. We do not use the reviewed voice feature to identify you through a voiceprint.

## 5. Who receives information

**Service providers.** Providers process information needed to supply their services. Current integrations include Auth0 for authentication, Render for application hosting and PostgreSQL infrastructure, and OpenAI for AI processing. Public pages may load Google Fonts, which causes browser requests to Google's font infrastructure. Provider privacy information is available at [Auth0/Okta](https://www.okta.com/privacy-policy/), [Render](https://render.com/privacy), [OpenAI](https://openai.com/policies/privacy-policy/), and [Google](https://policies.google.com/privacy). These links identify provider notices; our contractual protections and account settings require separate verification.

**People you authorize.** Family-link features share the academic fields identified in the flow. Private conversation summaries and private notes remain separate under the reviewed linking implementation. Another person may retain information already received or downloaded. Unlinking prevents future linked access but cannot erase independent copies.

**Public visitors.** Approved institutional pages and information explicitly submitted for public publication are visible to visitors and may be copied. Private family records are not public institutional-page content.

**Legal and safety needs.** We may disclose necessary information to comply with a valid legal obligation, address fraud or security threats, or protect lawful rights, subject to applicable safeguards. In a merger or transfer of the service, information may be transferred with appropriate notice and applicable protections; this is not unlimited permission to change its use.

The reviewed product does not implement sale of personal information or advertising that targets people across unrelated services. Confirm the actual production integrations and business practices before publishing that statement. We do not grant schools automatic access to student information through institutional registration.

## 6. Browser storage, cookies, and tracking

Authentication and application operation may use cookies and browser local or session storage. Origen also stores preview records, preferences, and experience indicators in browser storage. These records can persist after a tab closes and may be visible to another person using the same browser. Clearing storage can remove preview records and preferences; browser records are not a substitute for a signed-in account backup.

The reviewed application does not use cross-site advertising trackers. Third-party infrastructure can still receive request metadata when serving authentication, fonts, or other resources. Origen currently has no application-specific response to a browser's Do Not Track signal. A Global Privacy Control signal is different from Do Not Track; assess applicable requirements and implement required handling before introducing sale or advertising-sharing practices. Do not infer a blanket tracking opt-out from this draft.

## 7. Retention

Account profiles, plans, and conversation summaries remain until you delete supported records, close your account, or we apply a lawful retention policy. There is currently no automatic deletion of these records solely for inactivity. Expired family invitations are removed by scheduled cleanup. Aggregate institution metrics retain the current UTC calendar month and the preceding eleven months under the reviewed implementation.

Account closure deletes supported active application records. Minimal pseudonymous operational records, including a hash of the identity-provider account identifier used to prevent a closed account from silently being recreated, and account transaction-lock records may remain. They are not anonymous and currently have no automatic expiry. Their purpose, access, and retention must be included in the final operational policy.

Provider authentication records, infrastructure logs, backups, support records, and legally required records may follow separate retention schedules. Those schedules have not been verified for this draft. Deletion from active storage does not immediately remove every backup or a copy someone previously downloaded. We will publish verified schedules or meaningful retention criteria before launch of this Notice; we do not promise immediate or universal erasure.

## 8. Your controls and privacy requests

If you share a device, sign out and remove sensitive browser copies when finished. If a generated summary misidentifies a student or states something you did not agree to, correct or delete the supported summary and contact us if necessary. A generated summary is not evidence of your consent to an action, purchase, family link, or change in data use.

You can review and edit supported student/profile records, delete supported summaries, manage family links, stop microphone access, and clear preview/browser data. The web application provides supported account-data download and account-closure controls. Available exports include account, student, summary, plan, and relevant institutional membership/representative information; they exclude another user's private data and login credentials.

Closure requires a recent sign-in. Linked family relationships must be resolved first, and institutional membership or reviewer records can require manual review. Closing the application account does not automatically delete the Auth0 identity; that requires separate handling. Native mobile does not yet provide every equivalent self-service control. Contact us if a needed control is unavailable.

You may contact [privacy email] to request access, correction, deletion, or other rights available under the law that applies to you. We will verify your identity and authority proportionately, avoid requesting unnecessary sensitive documents, and respond within applicable legal deadlines. A parent requesting information about an adult student must establish authorization. An authorized agent may submit a request with appropriate proof. We will explain a lawful denial or limitation and provide any required appeal process. We do not penalize you for exercising applicable privacy rights.

California and other jurisdictions may provide additional access, deletion, correction, portability, opt-out, sensitive-data, or appeal rights when their laws apply. Acknowledging this Notice does not waive those rights. The operator must complete the applicability assessment and any required jurisdiction-specific disclosures, request channels, and notice-at-collection before publication. This draft does not claim Origen qualifies under or complies with every state or international privacy regime.

## 9. Children, students, and schools

The proposed minimum age for independent account or voice use is 13. Users below the age of majority should have parent/guardian involvement as required by applicable law. We do not knowingly allow children under 13 to independently use accounts or voice under this proposed policy. If we learn of collection contrary to it, we will restrict the affected feature and address deletion or other legally required measures. Contact [privacy email] with a concern.

A parent's checkbox is not a substitute for verifiable parental consent where children's privacy law requires it. Age and guardian safeguards must be implemented before this policy is presented as an operating practice. Do not provide information about another student without authority and any required permission.

Origen's direct-to-consumer service is not automatically a school-authorized educational service. Institutional registration does not by itself establish a school data-processing agreement or compliance with FERPA or similar student-record laws. Any school-directed use involving protected education records needs separate review and appropriate agreements.

## 10. Security and processing locations

The application uses authentication, authorization checks, validation, and other safeguards intended to limit unauthorized access. No system is perfectly secure. Provider access roles, encryption settings, backup restoration, incident procedures, and deployment locations require operational verification; we do not claim certification or audited security based only on source-code controls.

Providers may process information in locations different from your own. Confirm production regions, applicable transfer mechanisms, and intended markets before publishing specific location or international-compliance commitments. If an incident requires notification under applicable law, we will provide the required notification.

## 11. Updates and contact

If an acceptance process is introduced, we may retain the document version, account identifier, time of acceptance, language, and source of the acceptance action to document the agreement. That record must have a disclosed, purpose-based retention policy before implementation. Hearing a welcome introduction or using voice does not count as accepting legal terms.

We will post the current Notice with an effective date and identify material changes. Significant changes will be communicated through a conspicuous notice or another appropriate channel before they apply where required. New processing that requires consent will have a separate consent flow; continued use alone is not a substitute for required consent.

Privacy questions and requests: [confirmed privacy email]. Mail: [operator name and mailing address].

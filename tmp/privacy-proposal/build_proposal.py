from pathlib import Path
import json
from html import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path('C:/Windows/Fonts')
for name, filename in [('Body','calibri.ttf'),('Bold','calibrib.ttf'),('Italic','calibrii.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT / filename)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')

# Each section below is a deliberately paced page of the proposal.
pages = [
('Origen Edu Privacy Notice Proposal', [
('sub','For students families and community organizations'),
('meta','Prepared October 15 2026 | Proposed notice for review'),
('p','Origen Edu helps students and families explore college options and organize their next steps. This proposed notice explains the information used to provide that support, what is saved after a conversation, who may receive information, and the choices available to users.'),
('p','This is a proposal for a public notice, not confirmation that every described control is available in the live service. The notice language on pages 1 through 7 requires verification against the deployed product before publication. Page 8 contains a separate proposed coordinator-sharing clause for a feature that is planned. Page 9 identifies the remaining publication decisions.'),
('h','The proposed privacy commitment'),
('p','We use information to provide college guidance, maintain your account and planning history, support sharing that you authorize, and operate and protect Origen Edu. We do not sell personal information or use student profiles or private conversations for advertising targeted across unrelated websites or services.'),
('p','Browsing a university page does not give that university access to your identity, private profile, or conversations. Family links share designated academic profile information after an invitation is accepted. Private conversations are not automatically shared through a family link. Any future sharing of a summary with a community coordinator requires a separate, specific authorization.'),
('p','Origen Edu does not save microphone recordings as part of your account history. Live audio is processed by our AI provider to make voice conversations work. We save written summaries of topics discussed and relevant planning context. A summary can contain personal information you provide; it is not necessarily anonymous or limited to a list of topic names.'),
('h','A name is not the only personal information'),
('p','A name may help us address you naturally, but account identifiers, email addresses, educational information, questions, and saved summaries can also be personal information. We explain those categories below rather than claiming that a name is the only information we use. Providing less optional detail can reduce the information processed, although it may also make guidance less personalized.'),
('h','Who this notice covers'),
('p','The notice covers Origen Edu websites, applications, college-guidance features, and related support. It applies to students, family members, institutional representatives, and other visitors using those services. A community organization does not receive access to student information merely because it recommends or sponsors Origen Edu.'),
('p','Operator: [full legal business name]. Effective date: [publication date]. Privacy contact: [public privacy email]. Mailing address: [business mailing address]. References to "we," "us," and "our" mean that operator. Feature availability and privacy controls may differ between web and mobile releases.')
]),
('Information we collect and why', [
('h','Account and sign in information'),
('p','When you create or use an account, we process information such as your name, email address, account role, and an identifier provided by our sign-in service. We use this information to authenticate you, keep records associated with the correct account, provide support, and protect access. Your sign-in provider processes authentication information under its own terms and settings.'),
('h','Student and family planning information'),
('p','Depending on what you enter and the features you use, a student profile may include a name, school or educational stage, GPA, interests, activities, goals, colleges of interest, intended entry term, practical needs, and notes. This information helps tailor guidance and organize plans. Free-text fields can contain additional personal information even when the field does not specifically request it.'),
('p','Family links create records of the invitation, acceptance, participants, and linked student profiles. We use those records to manage the academic information shared through the link. Do not enter information about another person unless you have appropriate authority and any permission required for that use.'),
('h','Conversations and saved work'),
('p','We process your typed questions or spoken statements, the AI responses, selected profile details, and relevant previous summaries to provide guidance. Saved work may include summaries, topic notes, college plans, action items, worksheets, source links, and dates. Where enabled, progress features also record changes to academic information, plan revisions, and self-reported milestones. These records are associated with your account; they are not independently verified school records.'),
('h','Information you deliberately send to others'),
('p','If you use an available institution inquiry or event-request form, we process the name, question, topic, contact details if supplied, event information, and permissions you submit. Institutional representatives provide information such as their work email, role, affiliation, and page content. Approved information intended for a public institutional page becomes public.'),
('h','Technical information and support'),
('p','We process operational information such as visit and feature-use indicators, language preferences, session identifiers, request timing, error categories, and quality signals to maintain the service and diagnose problems. Our infrastructure providers may receive IP addresses, device and browser information, and other request metadata. These operational records are separate from the aggregate page counts supplied to universities.'),
('p','If you contact support or make a privacy request, we process the information you send and the records needed to respond. Optional feedback may include your response and associated account or feature context. We do not treat a support request as permission to publish your story or testimonial.'),
('h','Information you should avoid providing'),
('p','College guidance does not require Social Security numbers, passwords, bank-account numbers, payment-card information, tax documents, or confidential medical records. Avoid entering or speaking these details. You can discuss financial-aid processes without sharing exact financial identifiers. An educational conversation can still reveal sensitive circumstances, so include only the context you want processed and potentially summarized.')
]),
('AI guidance voice and saved summaries', [
('h','The purpose of the AI'),
('p','Origen Edu is designed for college-related guidance, including college exploration, academic preparation, admissions, applications, financial-aid information, scholarships, education financing, and planning. Its AI instructions direct conversations toward those topics. This describes the intended scope; it does not guarantee that every generated response stays within it or is accurate.'),
('p','AI guidance supports your decisions. It does not make admissions or financial-aid decisions for a university, submit an application merely because you discuss one, or establish that you qualify for a program. Verify deadlines, requirements, costs, and eligibility with the relevant institution or official source. A generated statement that you agreed to something is not evidence of your authorization.'),
('h','What is sent for AI processing'),
('p','We use OpenAI to generate responses and summaries and support live voice. Relevant questions, conversation text, selected profile information, and past summaries may be sent to OpenAI for those purposes. The service may also compare a summary with the conversation to identify possible quality problems. These operations involve processing personal information even when no audio recording is saved by Origen Edu.'),
('p','When a feature searches for public college information, it processes the query and relevant search criteria. The application includes measures to limit private details in search inputs, but automated filtering cannot guarantee that all personal information is removed. Avoid adding sensitive details to a search request.'),
('h','How voice works'),
('p','Voice is optional and requires microphone permission. While a voice session is active, microphone audio is transmitted to OpenAI for live processing. Speech recognition produces text used to respond and prepare summaries. Stop the session or revoke microphone permission to stop further capture. Stopping does not recall information already transmitted.'),
('p','Origen Edu does not retain raw microphone recordings in its account database or provide a recording archive for replay. It does retain written summaries and other saved planning records. The application also temporarily processes conversation text and pending summaries so a discussion can continue and an interrupted save can be retried. Temporary session handling is distinct from your saved account history.'),
('h','What a summary may contain'),
('p','A saved summary may describe the college topics explored, your goals, relevant academic context, questions that remain open, suggested next steps, and sources discussed. For example, a scholarship discussion could produce a summary of the scholarship types explored and your intended next action. It may also mention a name or personal circumstance supplied during the discussion. Review summaries for accuracy and remove details you do not want retained using available controls or a privacy request.'),
('h','Provider retention and model training'),
('p','Not storing recordings in Origen Edu does not mean zero retention by every provider. OpenAI documents that API data is not used to train its models by default unless a customer opts in. It also documents default abuse-monitoring retention of up to 30 days, with exceptions and different rules for some features. Those provider defaults are not proof of the settings on Origen Edu\'s project. The applicable configuration must be verified before a stronger no-training or zero-retention promise is published.'),
('p','OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data')
]),
('Limited sharing and access', [
('h','No sale and no advertising use of private student records'),
('p','We do not sell personal information or give advertisers student profiles or private conversation content for advertising across unrelated services. Operating the service still requires limited processing by providers and may involve disclosures you request or that the law requires. The following categories explain those circumstances.'),
('h','Linked family accounts'),
('p','A family link is established through an invitation and acceptance. It shares designated academic profile fields, including the student name, stage, school, GPA, interests, activities, goals, selected institutions, and entry term. Linked participants may be able to update shared academic fields. Review the sharing explanation before accepting a link.'),
('p','A family link does not automatically share private conversation summaries, private needs, or private notes. Linking an account is not proof of legal guardianship or unrestricted authority over another person\'s records. An adult student\'s parent or family member does not automatically receive access without authorization.'),
('p','You can end a family link through available controls. Unlinking stops future synchronization through that link. It does not erase an independent copy of previously shared academic information retained in another account or downloaded by another person.'),
('h','Community coordinators'),
('p','Coordinator access to selected summaries is a planned feature. A community organization\'s referral, sponsorship, or staff role does not currently grant access to a student\'s private conversation history. The proposed consent-based feature and its proposed public wording appear separately on page 8. It must be implemented before that wording is presented as an available service.'),
('h','Institutions you choose to contact'),
('p','Simply visiting an institution\'s page does not disclose your private account records to that institution. If you deliberately submit an available question or event request, the designated institution or department receives the submitted information and relevant replies. This is separate from aggregate analytics and does not include your private conversation history.'),
('p','Where offered, permission to answer a request and permission for future outreach are separate choices. You can withdraw a request or unsubscribe using its available controls. A proposed transfer to another institution or department requires the approval described in the request flow. A recipient may retain information it has already received under its own responsibilities; withdrawal cannot erase independent copies.'),
('h','Providers and authorized personnel'),
('p','Auth0 supplies sign-in services, Render hosts application and database infrastructure, and OpenAI supplies AI processing. Browser requests for Google Fonts also disclose ordinary request metadata to Google. These providers process the information needed for their services. Authorized Origen personnel may access information for support, security, and operation; access should be limited to the purpose of their role. This is not a promise that no human can ever access stored information.'),
('h','Legal obligations and organizational changes'),
('p','We may disclose information when necessary to comply with a valid legal obligation, investigate misuse, address a security threat, or protect lawful rights. If ownership of the service changes, information may transfer with the service subject to applicable protections and notice obligations. Such a transfer is not blanket permission to use student information for unrelated purposes.')
]),
('Analytics storage and service improvement', [
('h','What universities see in page analytics'),
('p','Institution page analytics report aggregate activity, such as page-view and link-click totals. These counters are not a list of student names, email addresses, private profiles, or conversations. They do not identify which individual viewed a page. Visiting a page does not authorize a university to contact you.'),
('p','The basic page-counter design stores an institution identifier, a calendar month, a metric type, and a count, rather than a visitor identifier. Reports cover completed months and suppress small positive counts below 10. These counts may include repeated visits or clicks and do not establish unique students, applications, admissions, or enrollment. Small-count suppression reduces disclosure risk; it does not prove that every report is anonymous in every context.'),
('p','If separate inquiry, event, or campaign reporting is available, its aggregate activity measures are distinct from a recipient\'s authorized access to a request you submitted. For an aggregate-only community or university pilot, individual contact and outreach features should remain outside that pilot\'s scope.'),
('h','Operational and quality information'),
('p','We use operational signals to understand whether sign-in, onboarding, voice connections, language selection, summary saving, and other features work. Quality checks can identify a repeated question, an interrupted response, or a possible discrepancy in a summary. These checks support troubleshooting and review; they are not grades, psychological assessments, or verified measures of student understanding.'),
('p','The conversation-quality reporting design saves categories, counts, references to turns, and standardized explanations rather than a second transcript or quoted excerpts. A quality check can nevertheless process conversation text before producing those findings. Operational records may remain associated with an account even when a report does not display conversation content.'),
('p','Optional feedback and progress features, when enabled, can support service evaluation and continuity. Keeping previous summaries for guidance, checking summary quality, conducting research, and training an AI model are different activities. This notice does not treat ordinary use as blanket permission for an unrelated research study or release of student-level datasets. A separate activity requiring consent must have its own explanation and permission.'),
('h','Browser and device storage'),
('p','Cookies and browser or device storage support authentication, preferences, preview records, and application operation. Some preview data and preferences may remain after a tab closes. Temporary signed-in conversation buffers and saved cloud records have different lifetimes. Closing a tab is not the same as deleting an account.'),
('p','On a shared device, sign out when finished and remove downloaded files or preview information you do not want another person to see. Clearing browser storage can remove local information but does not by itself delete cloud records. Similarly, deleting cloud information cannot remove a file someone has already downloaded.'),
('h','External sites and public content'),
('p','College links and other external resources lead to services with their own privacy practices. Those sites receive information when you visit or submit information to them. Approved institutional page content is public and may be copied or indexed. Private student planning information is not made public merely because an institution has a page in Origen Edu.')
]),
('Retention deletion and your choices', [
('h','Saved account information'),
('p','Account profiles, plans, notes, worksheets, and saved summaries generally remain until you delete the relevant records or close the account, subject to the exceptions below. The default summary policy is to keep summaries until deleted. We do not describe account information as automatically erased after inactivity when no such schedule has been established.'),
('p','Where the Privacy Center is available, you can choose automatic deletion of summaries 30, 90, or 365 days after saving. A shorter selection also applies to older summaries. This setting removes expired summaries and dependent generated notes; it does not automatically delete independent notes, plans, worksheets, or profile information. Scheduled cleanup is not necessarily immediate at the exact expiration time.'),
('h','Different records have different lifetimes'),
('p','The basic institution page counters retain the current UTC calendar month and the preceding eleven months. Conversation-quality findings have a 90-day cleanup schedule; findings awaiting a saved summary have a shorter cleanup period. Other technical events, inquiry records, support records, and provider records follow their applicable operational schedules. These schedules must be confirmed and disclosed for the features offered in the published service.'),
('p','Limited deletion receipts and account-closure safeguards may remain after private content is deleted. They record identifiers or hashed identifiers and deletion information to prevent deleted records from reappearing, including after recovery from a backup. They do not contain the deleted conversation prose, but they are not necessarily anonymous. Their current implementation has no automatic expiry; a final retention policy must address them explicitly.'),
('h','What deletion does and does not remove'),
('p','Deleting a summary can also delete notes generated from that summary. Separately saved notes, plans, exports, other account holders\' independent copies, and records held by recipients may require separate action. Closing an Origen account removes supported records from active application storage. Authentication-provider deletion is a separate process and should not be represented as complete while it is pending.'),
('p','Backups, infrastructure logs, security records, and records needed to meet a legal obligation may persist for a limited or legally required period. We do not promise immediate erasure from every backup or provider system. Confirmed backup and provider schedules must be included in the operational policy before publication of precise deletion deadlines.'),
('h','How to use your controls'),
('p','You can review and edit supported profile information, remove supported saved records, manage family links, stop microphone access, and use available export or account-closure tools. Some sensitive operations require a recent sign-in. Family links may need to be resolved before closure; institutional responsibilities can require additional review. If a control is unavailable in your version, contact us for assistance.'),
('p','Send privacy requests to [public privacy email]. Explain the request and the account concerned without sending passwords or sensitive identity documents in an initial message. We may verify identity or authority proportionately. Depending on applicable law, rights may include access, correction, deletion, a copy of information, and other choices. We will explain applicable limitations and any required appeal process and will not penalize you for exercising applicable rights.'),
('p','Microphone permission, a family invitation, an institution contact request, and future coordinator sharing are separate choices. Accepting one does not authorize the others. Acknowledging this notice does not waive your legal rights.')
]),
('Student protections security and contact', [
('h','Children and younger students'),
('p','The minimum age for independent account and voice use is [approved minimum age]. Parent or guardian involvement and any required permission must be addressed for younger users before access is offered. The age limit and consent process must be stated consistently in registration, voice onboarding, and this notice. This proposal does not assert that an age-verification or parental-consent process is already operating.'),
('p','A parent\'s relationship to a student, a community organization\'s referral, and a school\'s authorization are different. A family-link acceptance does not establish all of them. If you believe information was collected from a child contrary to the applicable requirements, contact [public privacy email] so we can investigate, restrict the relevant use, and take appropriate action.'),
('h','Schools and community organizations'),
('p','Community partners can help families discover and use Origen Edu without receiving their private profiles or conversations. Any sharing for individual support must have a defined recipient, purpose, and authorization. Participation in a partner program is not, by itself, permission for unrestricted monitoring of a student\'s activity.'),
('p','If a school directs use of Origen Edu or supplies education records, the applicable responsibilities and agreements require separate review. This notice is not a school data-processing agreement, a security certification, or a statement that every use meets FERPA, COPPA, or another legal standard. An institution\'s published page does not establish those agreements.'),
('h','Security and access'),
('p','We use safeguards intended to protect account information and limit access, including authentication, authorization checks, input validation, and separation of private account records from institutional reporting. The safeguards and their effectiveness depend on correct deployment and operation. No system can guarantee absolute security.'),
('p','We limit operational access according to assigned responsibilities and investigate suspected unauthorized access. Users should protect their sign-in credentials and avoid sharing accounts. If an incident requires notification, we will provide the notification required by applicable law. This proposal does not claim an independent security audit, certification, or guaranteed incident-free operation.'),
('h','Processing locations'),
('p','Origen Edu and its service providers may process information in locations different from where you live. The production locations, intended markets, contractual arrangements, and any required transfer protections must be confirmed before making specific geographic or international-compliance commitments. This proposal makes no promise that every copy stays in a single country or region.'),
('h','Changes to this notice'),
('p','We will publish an effective date with the final notice and identify material changes. Where required, we will provide a conspicuous notice before changes take effect and obtain separate consent for a new use that requires it. Continued use alone is not a substitute for legally required permission. A summary generated by the AI cannot authorize a policy change on your behalf.'),
('h','How to contact us'),
('p','Responsible operator: [full legal business name]. Privacy requests and questions: [public privacy email]. Mailing address: [business mailing address]. Please identify the service or account involved and the kind of assistance requested. Community organizations may use the same channel to ask about the pilot scope, approved sharing arrangements, and available privacy documentation.')
]),
('Proposed coordinator sharing clause', [
('sub','Future feature language for use only after implementation'),
('p','The wording below expresses the intended feature in the present tense so it can be reviewed as proposed public language. It must not be published as a description of an available capability until the consent, access, revocation, and recipient controls exist and have been verified. Family linking remains separate from coordinator permission.'),
('h','Selected summaries for additional support'),
('p','You may choose to share a selected college-guidance summary with a named coordinator at a community organization for follow-up support. Sharing is optional. Before anything is sent, we show you the recipient, organization, summary content, purpose, and whether access is a one-time disclosure or continues for a stated period. You can review the summary, correct inaccuracies, remove information, or cancel.'),
('p','Only the summary and identifying or contact information shown in the sharing preview are disclosed. Your permission does not give the coordinator access to your full profile, other conversations, raw audio, transcripts, or future summaries. We do not automatically add new summaries to an earlier permission. New content or a new recipient requires a new authorization.'),
('p','Shared summaries focus on the college topics explored, unresolved questions, and next steps for which you want support. They are AI-assisted notes that you have reviewed, not verified statements of academic performance, financial-aid eligibility, or consent to another action. You can receive ordinary guidance without sharing a summary with a coordinator.'),
('h','Permission and recipient responsibilities'),
('p','We record the approved recipient, the version of the summary shared, the purpose, the authorization date, any expiration, and any required parent or guardian permission. We do not infer this permission from a referral, participation in a program, a family link, silence, or an AI-generated statement.'),
('p','Coordinators must use the information only for the support purpose explained at authorization. Our agreement with the receiving organization prohibits selling it, using it for unrelated advertising or AI training, and redisclosing it for unrelated purposes. The agreement specifies authorized staff, safeguards, retention, deletion, and how the organization handles privacy requests.'),
('h','Ending access'),
('p','You can review and revoke active coordinator access. Revocation stops future access through Origen Edu and any further sharing under that authorization. It cannot make a recipient forget information already seen or automatically erase an authorized download. We explain any download capability before you authorize sharing and provide a way to request deletion of recipient-held copies, subject to applicable legal duties.'),
('h','Suggested confirmation text'),
('p','"I authorize Origen Edu to share the summary displayed above and the listed identifying information with [coordinator name] at [organization] for [support purpose]. This permission covers [this one summary and access period]. It does not include my other conversations or future summaries. I can cancel before sending and revoke future access afterward. I understand that revocation does not automatically erase information already received."'),
('p','The confirmation must be a separate affirmative action, with an unchecked choice by default. Show the actual content and recipient rather than relying on the general privacy notice. Where legally required, obtain and document valid parent or guardian authorization in addition to the student-facing explanation.')
]),
('Publication decisions and verification', [
('sub','Owner review appendix'),
('p','This appendix supports review of the proposal. It is not a representation that the listed work is complete. Complete the decisions below, then remove review-only language and issue a final notice with an effective date.'),
('h','Decisions needed from the business'),
('p','Confirm the legal operator, mailing address, monitored privacy email, minimum age, and intended markets. Adopt the no-sale and no-targeted-advertising commitments as actual business rules. Confirm that the community pilot provides aggregate institutional metrics only; if contact or outreach features are enabled, keep their separate disclosures and permissions.'),
('p','Choose whether coordinator sharing launches with the pilot or remains planned. For the proposed feature, approve the consent design, permitted summary fields, expiration, download policy, recipient agreement, revocation behavior, and process for minors. A privacy notice cannot substitute for implementing those controls.'),
('h','Verify behavior in the deployed service'),
('p','The source reviewed for this proposal includes private profile fields, saved summaries, family links, optional institution requests, and privacy-control code. Earlier repository notes identify privacy phases as locally implemented and awaiting deployment; those notes are not proof of the current live version. Verify the release, database migrations, authorization settings, and the controls visible to real users before asserting availability.'),
('p','Test with synthetic accounts that family links share only the intended fields, institutional staff cannot read private histories, microphone capture stops, exports exclude other accounts, and deletion covers the promised records. Confirm summary-retention choices on both web and supported mobile versions. Check that restore procedures honor deletion records.'),
('h','Verify providers and retention'),
('p','Check the actual OpenAI project for training/data-sharing opt-ins, the endpoints used, abuse-monitoring retention, and any approved retention controls. Inspect hosting, authentication, font loading, and other production integrations. Confirm provider agreements, locations, access permissions, backup expiry, security-log schedules, and identity-deletion operations. No raw audio archive in the application is not proof of zero provider retention.'),
('p','Publish meaningful schedules or criteria for all retained categories, including optional inquiries, technical events, support requests, acceptance or sharing records, backups, and deletion receipts. Do not promise a deadline that operations cannot meet. Obtain a privacy-law review focused on the users\' ages, actual markets, school relationships, and the final deployment.'),
('h','Evidence used for this proposal'),
('p','Repository sources reviewed on October 15, 2026 include docs/legal/PRIVACY_NOTICE.md; docs/PRIVACY_SECURITY_PHASE_3.md and PHASE_5.md; docs/vendor-readiness/DATA_INVENTORY.md; server/family.mjs; server/provider-privacy.mjs; server/conversation-quality-store.mjs; server/summary-quality.mjs; server/institution-inquiries.mjs; server/institution-campaigns.mjs; and src/ProfileVoice.tsx. These establish source behavior and documented limitations, not production verification.'),
('p','OpenAI API data controls, checked October 15, 2026: https://developers.openai.com/api/docs/guides/your-data. API defaults do not establish Origen Edu\'s configuration.'),
('p','FTC COPPA guidance, checked October 15, 2026: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions. Children\'s voice recordings can be personal information; a narrow voice exception should not be assumed for personalized guidance or saved student context.'),
('p','Provider notices for further review: https://www.okta.com/privacy-policy/ ; https://render.com/privacy ; https://policies.google.com/privacy . Provider notices do not replace a review of contractual terms and service settings.')
])]

# Incorporate the owner's six review priorities without overstating deployment.
replacements = {
    'The notice language on pages 1 through 7 requires verification against the deployed product before publication. Page 8 contains a separate proposed coordinator-sharing clause for a feature that is planned. Page 9 identifies the remaining publication decisions.': 'The notice language requires verification against the deployed product before publication. A separate proposed coordinator-sharing clause describes a planned feature. The final appendix identifies the remaining publication decisions.',
    'appear separately on page 8.': 'appear in the separate proposed coordinator-sharing section.',
    'No raw audio archive in the application is not proof of zero provider retention.': 'The absence of an application audio archive is not proof of zero provider retention.',
    'The minimum age for independent account and voice use is [approved minimum age]. Parent or guardian involvement and any required permission must be addressed for younger users before access is offered. The age limit and consent process must be stated consistently in registration, voice onboarding, and this notice. This proposal does not assert that an age-verification or parental-consent process is already operating.': 'Proposed age policy for approval: adults may register for themselves. Students aged 13 through 17 may register and use voice only with parent or legal guardian permission and any additional consent required by applicable law. Children under 13 may not register or use voice under this proposed policy. Serving them would require a separate, verified legal and product approach before access is enabled. These are proposed rules, not a claim that age checks and permission collection are already implemented.',
    'If you believe information was collected from a child contrary to the applicable requirements, contact [public privacy email] so we can investigate, restrict the relevant use, and take appropriate action.': 'A parent or legal guardian can email [public privacy email] to request review or deletion of a child\'s information. Identify the account, your relationship, and the request without sending unnecessary sensitive documents. We verify authority proportionately, explain any required additional steps, and address deletion or restriction under applicable law. A linked account is not required to submit a request. If collection occurred contrary to age requirements, we investigate and restrict the affected use as appropriate.',
    'Closing an Origen account removes supported records from active application storage. Authentication-provider deletion is a separate process and should not be represented as complete while it is pending.': 'Closing an Origen account removes supported records from active application storage. It also queues a separate Auth0 identity-deletion request. An authorized operator must complete and verify that request; a pending request is not completed deletion. This does not delete an underlying Google account or every provider security log. The operator must publish an actual processing deadline before promising one.',
    'These schedules must be confirmed and disclosed for the features offered in the published service.': 'Optional institution inquiry records expire 90 days after submission and are removed by scheduled cleanup. Withdrawal clears submitted content and related messages earlier, while limited operational records may remain. The other schedules must be confirmed for the published service.',
    'Their current implementation has no automatic expiry; a final retention policy must address them explicitly.': 'They currently remain indefinitely unless an operator removes them; no automatic expiry is implemented. The business must approve a bounded schedule tied to the recoverable backup period and necessary safeguards before promising a shorter duration.',
}
for title, blocks in pages:
    for i,(kind,text) in enumerate(blocks):
        for old,new in replacements.items(): text=text.replace(old,new)
        blocks[i]=(kind,text)

# Move provider detail into its own readable section and define staff boundaries.
sharing=pages[3][1]
provider_heading=next(i for i,b in enumerate(sharing) if b==('h','Providers and authorized personnel'))
del sharing[provider_heading:provider_heading+2]
pages.insert(4,('Service providers and staff access',[
('h','Named service providers'),
('p','OpenAI provides AI text responses, live voice, summary generation, and summary-quality checks. It processes audio, questions, selected profile details, and relevant conversation context. Its processing and retention are separate from the saved records managed in Origen Edu. See the AI and voice section for provider defaults and configuration limits.'),
('p','Auth0, an Okta service, handles sign-in and identity management. It processes identity and authentication information needed to authenticate an account. Deleting an application account and deleting the Auth0 identity are separate operations. Provider notice: https://www.okta.com/privacy-policy/'),
('p','Render hosts the application and PostgreSQL database infrastructure. Stored profiles, summaries, plans, and other application records are processed on that infrastructure. Render may also process infrastructure metadata, logs, and backup copies. Actual retention, access, and recovery settings require verification. Provider notice: https://render.com/privacy'),
('p','Google Fonts supplies fonts requested by the website. Those browser requests can disclose ordinary network and browser metadata, including an IP address, to Google. This is distinct from sending a student profile or conversation to Google Fonts. Provider notice: https://policies.google.com/privacy'),
('h','Who can see operational information'),
('p','Origen staff permissions define the reports available to a staff member. Activity-report access permits aggregate operational trends. Directory access permits account names, identifiers, status, and activity or conversation metadata. Quality-review access permits diagnostic findings and related operational evidence, which may include affected account identifiers. Those reporting permissions do not expose private summary text, transcripts, notes, plans, or worksheets.'),
('p','Institution reviewers can review institutional representatives and submitted page content. Institution owners and authorized outreach staff may see questions and replies deliberately submitted to their own workspace. Institutional analysts receive the permitted aggregate reports. These roles do not grant access to private family conversations or unrelated departments\' request inboxes.'),
('h','Operational access beyond reporting'),
('p','The application stores private content to provide the service. Appropriately authorized technical operators may be able to access underlying systems for support, maintenance, recovery, security, or a legal obligation. Dashboard restrictions are not a claim that the database is inaccessible to every human. Limit such access to a necessary purpose and authorized personnel, with operational safeguards and review.'),
('h','Possible review by the AI provider'),
('p','OpenAI states that access to stored API business data is limited to authorized employees for engineering support, abuse investigation, and legal compliance, and specialized contractors under confidentiality and security obligations for abuse review. A promise that nobody can ever review AI inputs would therefore be inaccurate. Provider policy: https://openai.com/enterprise-privacy/'),
('p','A provider\'s public policy does not establish the permissions, contractual terms, or optional settings in Origen Edu\'s specific account. Those must be verified before this proposal becomes an operating notice.')
]))

# Keep each topic together without shrinking the text to accommodate overflow.
for title, blocks in pages:
    if title == 'Retention deletion and your choices':
        blocks[:] = [(k,t) for k,t in blocks if not t.startswith('Microphone permission, a family invitation')]
        for i,(k,t) in enumerate(blocks):
            t=t.replace('We do not describe account information as automatically erased after inactivity when no such schedule has been established.','There is no inactivity-based deletion schedule.')
            t=t.replace('These schedules must be confirmed and disclosed for the features offered in the published service.','')
            t=t.replace('Some sensitive operations require a recent sign-in. Family links may need to be resolved before closure; institutional responsibilities can require additional review. If a control is unavailable in your version, contact us for assistance.','Sensitive operations may require recent sign-in, resolving family links, or review of institutional responsibilities. Contact us if a control is unavailable.')
            blocks[i]=(k,t)
    if title == 'Student protections security and contact':
        for i,(k,t) in enumerate(blocks):
            if t.startswith('We will publish an effective date'):
                blocks[i]=(k,'We will date the final notice and communicate material changes as required. A new use that requires consent will have a separate permission process. Continued use or an AI-generated summary is not a substitute for that permission.')
            elif t.startswith('Origen Edu and its service providers may process'):
                blocks[i]=(k,'Providers may process information outside your location. Confirm production regions, intended markets, and any required transfer protections before making geographic commitments. This proposal does not promise that every copy remains in one country.')
    if title == 'Publication decisions and verification':
        blocks[:]=[(k,t) for k,t in blocks if not t.startswith('Provider notices for further review:')]

# October 15 follow-up: owner-confirmed facts and actual automatic save behavior.
for title,blocks in pages:
    for i,(kind,text) in enumerate(blocks):
        text=text.replace('[full legal business name]','Blueprint Holdings LLC').replace('[public privacy email]','daniel@origenedu.ai')
        if text.startswith('Proposed age policy for approval:'):
            text='Origen Edu serves students in ninth grade and above and their families. The owner has selected this educational scope. A grade level does not establish a student\'s age, legal capacity, or guardian permission. The minimum registration age, rules for younger ninth-graders, and guardian-permission process still require a decision and implementation before the notice can describe an operating age gate.'
        if text.startswith('Confirm the legal operator, mailing address, monitored privacy email'):
            text='The owner confirmed Blueprint Holdings LLC as operator, daniel@origenedu.ai as the privacy-request email, and ninth grade and above as the student scope. Confirm the mailing address, publication date, intended markets, minimum age, and guardian-permission rules. Preserve the aggregate-only pilot boundary; if contact or outreach features are enabled, keep their separate disclosures and permissions.'
        if text.startswith('The source reviewed for this proposal includes'):
            text='Read-only Render deployment metadata checked October 15, 2026 identifies commit 14398304da90eab775d470f552bdf3ac3af3a186 as live for both the Origen API and static web service. The API service is in Oregon. This verifies reported deployment metadata, not database migrations, runtime permissions, backup settings, OpenAI settings, or end-to-end privacy behavior. The disclosure revisions in this follow-up remain local and undeployed.'
        if text.startswith('A name may help us address you naturally'):
            text='A name may help us address you naturally, but account identifiers, email addresses, educational information, questions, and saved summaries can also be personal information. Providing less optional detail reduces the information processed, though it can make guidance less personalized. Voice summaries normally save automatically after a scoped conversation with user speech ends; individual summary approval is not required.'
        blocks[i]=(kind,text)

# A separate page makes the timing and deferred onboarding behavior easy to review.
pages.insert(3,('When conversation summaries are saved',[
('h','Automatic saving after a voice conversation'),
('p','When you speak in a voice conversation about a confirmed student or family context, Origen normally generates and saves a written summary automatically when the call ends. You are not asked to approve each summary before it is generated or saved. Ending the call is not a discard action, and reviewing a summary afterward is different from approving it in advance.'),
('p','The summary may include personal context you supplied, the topics explored, unresolved questions, and proposed next steps. Generated notes may be prepared from a saved summary. Use the available review and deletion controls if you want to remove saved information. The retention choices described in this notice apply to saved summaries and their dependent generated notes.'),
('h','Profile saving is a separate action'),
('p','During profile setup, details can appear as a draft while you speak. You can request a profile save with Save profile or by asking Origen to save it. That action concerns the profile; it is not separate approval of each conversation summary. You should not interpret a profile-review instruction as a promise that no other record will be generated or saved automatically.'),
('h','Deferred saving during onboarding'),
('p','If the conversation concerns a new student whose profile has not yet been saved, summary generation can still send conversation text to OpenAI before the profile is saved. Saving the written summary to the account may be deferred until that student profile exists. Pending summary work can then be retried automatically while the private session remains valid. This does not add an individual summary-approval step.'),
('p','The server may retain limited lifecycle, attribution, or quality records associated with a deferred summary even before the summary text is attached to a saved student. Temporary text and pending summaries are distinct from saved account history. Logging out or changing accounts clears private session buffers; closing or reloading the page can lose unsaved conversation text. These actions do not recall information already sent to OpenAI or remove an already saved summary.'),
('h','Limits and save failures'),
('p','Automatic saving depends on captured user speech, a confirmed conversation scope, a valid private session, and successful processing and storage. A call without captured user speech or without a confirmed target does not follow the ordinary automatic-summary path. Network failures, interruptions, or a missing profile can delay or prevent a save; the interface can offer a retry. Do not rely on every call producing a complete summary.'),
('p','For signed-in use, completed summaries belong to account history. In a preview, saved summaries may remain in the browser instead. Neither flow creates an Origen microphone-recording archive. Provider processing and retention remain separate, as explained in the AI and voice section.'),
('h','Notice before microphone use'),
('p','The onboarding start control should disclose that microphone audio and the supplied profile details go to OpenAI, and that summaries normally generate automatically when a call ends. This notice should be visible before microphone capture begins, in the selected interface language. The AI\'s spoken welcome and the browser microphone prompt are not substitutes for that disclosure.')
]))


# Local guardian-permission implementation: do not present this as deployed.
for title,blocks in pages:
    for i,(kind,text) in enumerate(blocks):
        if text.startswith('Origen Edu serves students in ninth grade and above'):
            text="The selected audience is students in ninth grade and above and their families. The local registration flow separately asks actual age band: under 13 cannot proceed to profiles or AI, ages 13-17 require a parent or legal guardian's email approval, and adults age 18 or older may proceed on the adult path. A younger ninth grader is still under the age restriction. These controls are implemented locally for review and are not confirmed deployed."
        if text.startswith('The owner confirmed Blueprint Holdings LLC as operator'):
            text='The owner confirmed Blueprint Holdings LLC, daniel@origenedu.ai, and the ninth-grade-and-above audience. He subsequently authorized a local guardian-email flow for ages 13-17, an under-13 block and an adult path. Confirm the mailing address, publication date, markets, legal verification method and deployment before publication. Preserve the aggregate-only university pilot boundary.'
        if 'notice language on pages 1 through 7' in text:
            text='This is a proposal for a public notice, not confirmation that every described control is available in the live service. Verify the notice against the deployed product before publication. Coordinator sharing remains a separately labeled planned feature. The final sections distinguish local guardian-permission implementation from production and list the email setup still required.'
        blocks[i]=(kind,text)
pages.extend([
('Guardian permission: local review',[
('meta','Implementation appendix | Not deployed | Email disabled'),
('h','How registration works'),
('p','The neutral English/Spanish screen has no selected answer. It asks the account user for an age band and educational situation before ordinary sign-in, then records those answers against the signed-in identity before profiles, voice or AI. It collects no full birth date. Under-13 users cannot proceed; students aged 13-17 remain pending; adults can use the adult path. Existing accounts without a recorded decision must also complete the gate.'),
('h','An adult makes a separate decision'),
('p','A parent or legal guardian reviews a bilingual notice and a request reference, makes an unchecked declaration, and clicks an explicit approval button. Opening an email link does not approve anything. The notice describes voice processing, automatic summaries, separately saved records, withdrawal and deletion. Permission never creates a family link or gives the guardian, a referring organization or a coordinator access to private conversations.'),
('p','The application keeps the hashed account linkage, age band, request identifier, notice version, decision, revision and server timestamps. It keeps the guardian email for the permission request. Random approval and withdrawal tokens are stored only as hashes in PostgreSQL, not plaintext. The email provider and recipient mailbox necessarily receive the original links. Approval expires in 48 hours; a resend invalidates earlier links. Permission and the separate withdrawal link expire 180 days after the request.'),
('h','Withdrawal and storage'),
('p','Withdrawal blocks new permitted use and invalidates older work. It does not itself erase records already saved or recall information sent to a provider. The guardian email is erased on denial, withdrawal or account closure. Hourly cleanup removes pending email and token hashes after 30 days and expired approval details after the 180-day term. Decision events expire after 365 days or earlier account closure. Minimal eligibility status stays until account closure to enforce the restriction.'),
('h','What the tests establish and what remains'),
('p','Synthetic tests cover permission decisions, replay, expiry, direct API blocking, delayed writes and provider responses, and PostgreSQL row isolation and concurrent decisions. Web and native source changes are local. Realtime calls have a durable termination queue and periodic provider hangup checks; outages can delay remote termination. Nothing promises immediate recall or zero provider retention.'),
('p','Email possession and a declaration do not conclusively verify guardianship or establish legal sufficiency. Self-reported age can be false, and direct Auth0 signup may create a preliminary identity before Origen screening. Review identity-provider signup, published wording and any required stronger verification before launch. A separate controlled provider and native-device test is still required.')
]),
('Guardian email: setup still required',[
('meta','Implementation-backed handoff | No credentials or production settings changed'),
('h','Sender and chosen transport'),
('p','The chosen future sender is daniel@origenedu.ai, using the Resend HTTPS email API. The reply-to default is the same monitored address. An email alias alone does not authenticate outgoing application mail; Resend needs an authorized sending domain and a server-side API key. No separate permissions@ alias is required. Resend is a proposed additional provider for this flow, not a verified live integration.'),
('h','Exact backend configuration'),
('p','Configure the Render API web service srv-db02or0u01pc738ktekg at https://origen-edu.onrender.com. Never put the sending credential in the static website or mobile bundle. GUARDIAN_EMAIL_TRANSPORT defaults to disabled; only a separately authorized release should set resend.'),
('p','GUARDIAN_EMAIL_FROM and GUARDIAN_EMAIL_REPLY_TO both default to daniel@origenedu.ai. GUARDIAN_PUBLIC_URL must be the final HTTPS web origin with a trailing slash, such as https://origenedu.ai/, without a query or fragment. RESEND_API_KEY is a Resend sending API credential, not an inbox password. It is unnecessary while delivery is disabled.'),
('h','Environment variables are only one part'),
('p','Verify origenedu.ai with Resend using its required DNS records and sender authorization, check external-recipient permission and tracking settings, confirm the reply inbox, and review provider terms and retention. Deploy the new backend and frontend, apply database migration 039 with the migration credential, install and verify restricted runtime grants, and confirm the guardian page, CORS, status checks, supervisor and cleanup jobs. Review Auth0 signup behavior and native releases. None of those production actions occurred in this task.'),
('p','After separately approving real delivery, send a controlled email to a consenting adult test recipient and verify receipt, approval, expiry, replay and withdrawal. An accepted API response is not proof the message arrived. Verify actual Realtime termination with controlled data before enabling teen voice. Final legal review must address the chosen audience and verification method.'),
('h','Review safely now'),
('p','Run node scripts/review-guardian-permission.mjs and open http://127.0.0.1:5183/guardian-review. The local review uses fictional accounts, an in-memory database and a mock mailbox. No email or OpenAI call is sent. Use only fictional addresses. View the mock mailbox, open approval in another tab, then test the separate withdrawal link. Stop with Ctrl+C; restarting clears the synthetic data.'),
('p','The detailed file docs/GUARDIAN_PERMISSION_IMPLEMENTATION.md contains the exact settings, retention behavior, test commands, known limits and release checklist. Official technical references: https://resend.com/docs/api-reference/emails/send-email and https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup.')
])])

styles = {
    'title':ParagraphStyle('title',fontName='Bold',fontSize=23,leading=27,textColor=black,spaceAfter=12),
    'sub':ParagraphStyle('sub',fontName='Bold',fontSize=12,leading=15,textColor=black,spaceAfter=9),
    'meta':ParagraphStyle('meta',fontName='Body',fontSize=10,leading=13,textColor=HexColor('#444444'),spaceAfter=13),
    'h':ParagraphStyle('h',fontName='Bold',fontSize=12,leading=14.5,spaceBefore=7,spaceAfter=4,keepWithNext=True),
    'p':ParagraphStyle('p',fontName='Body',fontSize=10.5,leading=13.3,spaceAfter=5,splitLongWords=True,allowWidows=0,allowOrphans=0),
}

def footer(c, doc):
    c.saveState()
    c.setFont('Body',9)
    c.setFillColor(HexColor('#555555'))
    c.drawString(47,29,'ORIGEN EDU  |  PRIVACY PROPOSAL  |  OCTOBER 2026')
    c.drawRightString(565,29,str(doc.page))
    c.restoreState()

story=[]
plain=[]
for idx,(title,blocks) in enumerate(pages):
    if idx: story.append(PageBreak())
    story.append(Paragraph(escape(title),styles['title']))
    plain.append(title.upper()+'\n')
    for kind,content in blocks:
        story.append(Paragraph(escape(content),styles[kind]))
        plain.append(content+'\n')
    plain.append('\n')
pdf_path=OUT/'Origen_Edu_Privacy_Proposal.pdf'
doc=SimpleDocTemplate(str(pdf_path),pagesize=letter,rightMargin=47,leftMargin=47,topMargin=43,bottomMargin=47,title='Origen Edu Privacy Notice Proposal',author='Origen Edu',subject='Proposed privacy notice and coordinator sharing language')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
(OUT/'Origen_Edu_Privacy_Proposal.txt').write_text('\n'.join(plain),encoding='utf-8')
reader=PdfReader(str(pdf_path))
report={'pages':len(reader.pages),'words':len(' '.join(plain).split()),'page_starts':[(p.extract_text() or '').splitlines()[1:4] for p in reader.pages]}
print(json.dumps(report,indent=2))

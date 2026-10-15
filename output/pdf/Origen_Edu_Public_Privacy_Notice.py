"""Editable source for the public-facing review PDF. No website files are changed."""
from pathlib import Path
from html import escape
import json
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter
from io import BytesIO
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parent
for name, filename in [('Body','calibri.ttf'),('Bold','calibrib.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/filename)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold')
pdfmetrics.registerFont(TTFont('Brand',str(OUT/'public-privacy-assets'/'DMSans-Bold.ttf')))
MARK=ET.parse(OUT/'public-privacy-assets'/'origen-mark.svg').getroot()

# This is the public notice's complete editable content. Implementation and
# publication-review notes are intentionally in a separate file.
PAGES = [
('Privacy Notice', [
('sub','For students, families and community organizations'),
('meta','Review draft • October 15, 2026'),
('p','Origen Edu helps students and families explore college options and organize their next steps. This notice explains what information we process, how voice and AI features work, what we save, who can access information, and how to request help or deletion.'),
('h','Who we are'),
('p','Origen Edu is operated by Blueprint Holdings LLC. In this notice, “Origen,” “we,” “us” and “our” refer to Blueprint Holdings LLC. Our privacy contact is daniel@origenedu.ai.'),
('p','This notice covers our website, applications, college-guidance features and related support. It applies to students, family members, institutional representatives and visitors. Features and controls can differ between the web application and mobile versions.'),
('h','The main points'),
('p','We use information to provide college guidance, maintain your account and planning history, carry out sharing you request, and operate and protect the service. We do not sell personal information or provide private student profiles or conversations to advertisers for targeting across unrelated services.'),
('p','A name is not the only personal information involved. Your account identifiers, email address, educational details, questions and saved summaries can also identify you or describe your circumstances. Optional details can make guidance more relevant; you can limit the details you choose to provide.'),
('p','Account access includes age-group and eligibility screening. Students aged 13–17 must have parent or legal guardian approval before using profiles or AI. The eligibility section explains the information collected, permission limits and delivery availability.'),
('p','Origen does not keep an archive of microphone recordings. Live audio is sent to OpenAI for processing. Written conversation summaries normally save automatically after a conversation with captured speech and a confirmed student or family context ends, and may include personal context. OpenAI’s processing and retention are separate from Origen’s saved records.'),
('p','Linking family accounts shares designated academic profile information. It does not automatically share private conversations. A community organization’s referral does not give its staff access to your private history. University page analytics contain aggregate counts, not private student profiles.'),
('h','Privacy questions and requests'),
('p','Email daniel@origenedu.ai. Tell us what you need and which account the request concerns. Do not send passwords, financial identifiers or identity documents in an initial email. The final section explains requests by students, parents and other authorized people.')
]),
('1. Information we collect and use', [
('h','Account and authentication information'),
('p','We process information such as a provided name, email address, account role and identifier from the sign-in service. This lets us authenticate users, associate saved information with the correct account, provide support and protect access. Authentication providers also process information needed for sign-in under their own terms.'),
('h','Student profiles and family planning'),
('p','Depending on what you enter, profiles may include a student’s name, school or education stage, GPA, interests, activities, goals, colleges of interest, intended entry term, practical needs and notes. We use those details to personalize guidance and organize planning. Free-text fields may contain additional personal information even when the field does not specifically request it.'),
('p','Family linking creates records of invitations, acceptance, participants and linked student profiles. These records let us manage the academic information shared through the link. Only enter information about another person when you have appropriate authority and any permission required for that use.'),
('h','Conversations and saved work'),
('p','We process typed questions, spoken statements, AI responses, relevant profile details and previous summaries to provide guidance. Saved work may include conversation summaries, topic notes, college plans, action items, worksheets, source links and dates. Progress features, where available, also record changes to academic information, plan revisions and self-reported milestones.'),
('p','These are user-provided or generated planning records. They are not independently verified school records, admissions decisions or assessments of a student’s ability. A summary or worksheet may contain personal information even if it is described as a summary of college topics.'),
('h','Requests you submit and public institutional content'),
('p','An available institution inquiry or event-request form may collect a name, question, topic, optional contact information, event details and the permissions you submit. We use that information to deliver and manage the request. Institutional representatives provide work contact details, roles, affiliations and page content. Information submitted and approved for a public institutional page becomes public.'),
('h','Technical records, feedback and support'),
('p','We process operational information such as feature-use indicators, language preferences, session identifiers, request timing, error categories and quality signals to maintain the service and troubleshoot problems. Infrastructure providers may receive IP addresses, browser or device details and other request metadata. Support and privacy requests include the information you send and records needed to respond. A support request does not authorize publication of your story or testimonial.'),
('h','Please limit sensitive details'),
('p','College guidance does not require passwords, Social Security numbers, bank-account numbers, payment-card details, tax documents or confidential medical records. Avoid entering or speaking those details. Share only the personal context you want processed and potentially included in a summary.')
]),
('2. AI, voice and conversation summaries', [
('h','College-focused guidance'),
('p','Origen’s AI is designed and instructed to discuss college-related topics, including college exploration, preparation, admissions, applications, financial aid, scholarships, education financing and planning. Instructions do not guarantee that every answer stays within scope or is accurate. Verify important requirements, deadlines, costs and eligibility with the relevant institution or official source.'),
('h','What goes to OpenAI'),
('p','Relevant questions, conversation text, selected profile information and past summaries may be sent to OpenAI to generate responses or summaries. The service may compare a generated summary with conversation text to identify quality problems. Searches for public college information can include the question and relevant search criteria. Automated filtering cannot guarantee that every personal detail is removed from a search.'),
('h','Microphone audio and temporary text'),
('p','Voice is optional and requires microphone permission. During an active session, audio is transmitted to OpenAI for live processing. Speech recognition produces text used to respond and prepare summaries. Stop the session or revoke microphone permission to stop further capture; this does not recall information already transmitted.'),
('p','Origen does not retain raw microphone recordings in its account database or offer a recording archive for replay. It temporarily processes conversation text and pending summaries to support a discussion and retries. Those temporary buffers are distinct from saved account history. Ending a call does not necessarily discard its text before a summary is generated.'),
('h','Summaries normally save automatically'),
('p','After you speak in a conversation about a confirmed student or family context, a written summary normally generates and saves automatically when the call ends. You are not asked to approve each summary first. A summary can include topics, goals, academic context, questions, next steps and personal circumstances you mentioned. It is not necessarily anonymous.'),
('p','During onboarding, summary generation can occur before a new student profile is saved. Attaching the summary to the account may wait until that profile exists, and pending work may retry automatically. Saving or reviewing a profile is a separate action from generating a summary. A call with no captured user speech, no confirmed context or a processing failure may not produce a saved summary.'),
('h','Provider retention, review and training'),
('p','OpenAI’s published API policy states that API data is not used for model training by default unless the customer opts in. Its default abuse-monitoring logs may contain content and are retained for up to 30 days, with longer retention possible for legal or harm-prevention reasons. Additional storage rules depend on the feature and configuration. Origen’s lack of an audio archive is not a promise of zero provider retention.'),
('p','OpenAI describes limited access to stored API business data by authorized employees for support, abuse investigation and legal compliance, and specialist contractors under confidentiality and security obligations for abuse review. Deleting a saved summary in Origen does not itself delete every provider record.'),
('links',[('OpenAI API data controls','https://developers.openai.com/api/docs/guides/your-data'),('OpenAI business privacy','https://openai.com/enterprise-privacy/')])
]),
('3. Sharing and access', [
('h','No sale of personal information'),
('p','We do not sell personal information or give advertisers private profiles or conversations for targeting across unrelated services. Limited disclosures occur to provide the service, carry out your requests, protect the service or meet legal obligations.'),
('h','Linked family members'),
('p','A family link is created through an invitation and acceptance. It shares designated academic profile fields: student name, education stage, school, GPA, interests, activities, goals, selected institutions and entry term. Linked participants may be able to update those shared academic fields.'),
('p','Family linking does not automatically share private conversation summaries, private needs or private notes. It is not proof of legal guardianship or unrestricted authority over someone else’s records. A parent or family member does not automatically receive an adult student’s private information.'),
('p','Ending a link stops future synchronization through that link. It does not erase an independent copy of previously shared academic information retained in another account or a file another person downloaded.'),
('h','Community organizations and coordinators'),
('p','A community organization’s referral, sponsorship or relationship with a family does not give its coordinators access to that family’s private profiles or conversation history. A staff title or participation in a program is not authorization to monitor a student’s conversations.'),
('h','University and institutional analytics'),
('p','Institutional page reports use aggregate activity, such as page-view and link-click counts. They do not provide a list of students, names, email addresses, private profiles or conversations. Basic reports use completed calendar-month totals and suppress counts below a minimum reporting threshold. They are not reports of individual academic ability, engagement quality or admission readiness.'),
('p','Campaign reports may count interactions with institution pages or events. These counts do not by themselves identify a particular visitor. Infrastructure and operational logs are separate from the aggregate reports supplied to institutions.'),
('h','Institutions you deliberately contact'),
('p','If you submit an available question or event request, the designated institution or department receives the submitted information and relevant replies. This is separate from page analytics and does not include your private conversation history. Permission to answer a request and permission for future outreach are separate choices where offered.'),
('p','You can use available controls to withdraw a request or unsubscribe. A transfer to another institution or department requires the permission described in that flow. Withdrawal cannot automatically erase independent copies already received by the institution.'),
('h','Other disclosures'),
('p','We may disclose information as needed to meet a valid legal obligation, investigate misuse, address a security threat or protect lawful rights. If ownership of the service changes, information may transfer with it subject to applicable privacy protections and notice obligations.')
]),
('4. Providers, staff and browser storage', [
('h','Service providers'),
('p','We use the following providers for the functions described below. Their processing is separate from the records you manage in Origen. Following a provider link takes you to that provider’s own privacy information.'),
('table',[
 ['Provider','Role and information involved'],
 ['OpenAI','AI responses, live audio processing, summaries and quality checks; relevant questions, audio, profile details and conversation context.'],
 ['Auth0 (Okta)','Sign-in and identity management; identity and authentication information needed to authenticate an account.'],
 ['Render','Application and database hosting; saved application records and infrastructure information, including relevant logs and backup copies.'],
 ['Google Fonts','Website fonts; font requests can disclose ordinary network and browser information, including an IP address. Student profiles and conversations are not sent as font content.'],
 ['Resend (when enabled)','Guardian-permission email delivery; guardian email address, request reference, privacy notice and private approval/withdrawal links. The permission email does not include saved student profiles or conversation summaries.']
]),
('links',[('Auth0 / Okta privacy','https://www.okta.com/privacy-policy/'),('Render privacy','https://render.com/privacy'),('Google privacy','https://policies.google.com/privacy'),('Resend privacy','https://resend.com/legal/privacy-policy')]),
('h','What Origen staff can see'),
('p','Application permissions limit staff reports by role. Activity reports contain operational trends. Directory access can include account names, identifiers, status and activity or conversation metadata. Quality-review access can include diagnostic findings and associated account identifiers. These reporting permissions do not expose private summary text, transcripts, notes, plans or worksheets.'),
('p','Authorized technical operators may be able to access underlying systems for support, maintenance, recovery, security or a legal obligation. Restrictions in a dashboard do not mean the underlying stored content is inaccessible to every human.'),
('p','Institutional reviewers can review submitted institutional content and representative information. Authorized institution staff can see inquiries deliberately submitted to their own workspace. Institutional roles do not grant access to private family conversations or unrelated departments’ request inboxes.'),
('h','Cookies, local storage and temporary buffers'),
('p','Authentication and application operation use browser or device storage. Preferences, experience indicators and some preview records can persist after a tab closes. Temporary signed-in conversation text is held in browser memory; ending the private session clears those buffers. Saved account records have their own retention rules.'),
('p','On a shared device, sign out and remove downloads or preview information you do not want another person to see. Clearing browser storage does not delete cloud records, and deleting a cloud record does not remove an exported file. External college sites have their own practices when you visit or send information to them. Providers may process information outside the place where you live.')
]),
('5. How long information remains', [
('h','Default retention and your choices'),
('p','The default for saved conversation summaries is to keep them until you delete them. Profiles, independently saved notes, plans and worksheets also remain until you delete the relevant records or close the account. There is no automatic account-deletion schedule based solely on inactivity.'),
('p','Where the Privacy Center is available, you can choose automatic deletion of summaries after 30, 90 or 365 days. A shorter selection also applies to older saved summaries. Cleanup runs periodically, so removal is not necessarily immediate at the exact cutoff time.'),
('table',[
 ['Information','Retention and deletion behavior'],
 ['Saved summaries','Kept until deleted by default. An optional 30-, 90- or 365-day selection applies to saved summaries and their dependent generated notes.'],
 ['Separate profiles and saved work','The summary-retention setting does not automatically delete profiles, independently saved notes, plans or worksheets. Delete these separately or use account closure.'],
 ['Microphone recordings','Origen does not maintain a raw microphone-recording archive. Audio is processed by OpenAI under its separate retention practices.'],
 ['Temporary conversation text','Held temporarily for the active private session and summary processing. It is not the same as saved account history; unfinished work can be lost when a page closes or reloads.'],
 ['Institution page counters','The current UTC calendar month and the preceding eleven months.'],
 ['Institution inquiries','Content expires 90 days after submission and is removed by scheduled cleanup. Withdrawal clears submitted content and related messages earlier; limited operational records may remain.'],
 ['Conversation-quality findings','A 90-day cleanup schedule applies; findings awaiting a saved summary have a shorter lifetime. Other operational and provider records are separate.']
]),
('h','Deletion receipts and closure records'),
('p','Limited deletion records can remain after private content is removed. They contain account or record identifiers, hashed identifiers, record type and deletion dates so deleted information is not inadvertently restored or recreated. They do not contain the deleted conversation prose, but they are not necessarily anonymous. These safeguards currently have no automatic expiration and may remain indefinitely.'),
('h','Backups, support and provider records'),
('p','Backups, infrastructure and security logs, support correspondence and records needed for legal obligations follow separate retention rules. They are not removed simply by changing summary retention. We do not promise immediate erasure from every backup or provider system. Contact daniel@origenedu.ai about the records involved in your request.')
]),
('6. Eligibility and guardian permission', [
('h','Who can use an account'),
('p','Origen supports students in ninth grade and above, including college students and people returning to education, and adults supporting a student. Users under 13 are blocked from student-profile and AI access, even if they are in ninth grade. Eligible users aged 13–17 remain pending until a parent or legal guardian approves. Eligible users aged 18 or older have an adult path. Existing users whose eligibility is unknown must also complete screening.'),
('p','We ask for an age group and audience category, not a full birth date. Answers are self-reported; the screen does not verify age or identity. A sign-in provider may create a preliminary identity before Origen completes screening. That identity does not itself permit profile or AI use. Contact us to request correction of a screening answer; changing it is not available through self-service.'),
('h','Information used to manage permission'),
('p','We record the age group, audience category, permission status, a hashed identifier linking the record to the account, notice version, request reference, guardian email, request and decision dates, expiry dates and delivery status. Private permission links are stored as hashes. Temporary call identifiers and permission revisions help stop AI sessions when permission is no longer valid. These records are separate from saved college conversations.'),
('h','How approval works'),
('p','When email delivery is enabled, the guardian receives a notice and private links to approve, decline or withdraw permission. Opening an email is not approval: an affirmative decision and confirmation are required. Approval links expire 48 hours after the request. Permission expires 180 days after the request, rather than 180 days after approval, and must then be renewed. Email possession and a declaration do not conclusively establish legal guardianship.'),
('p','If delivery is disabled or fails, permission stays pending and profiles, microphone use and AI remain unavailable. A provider accepting an email request does not establish delivery, reading or approval. Contact daniel@origenedu.ai for help. Email-provider storage is separate from Origen’s records.'),
('h','Permission records and retention'),
('table',[
 ['Record','Retention and cleanup'],
 ['Guardian contact and link hashes','Pending requests: cleared by periodic cleanup after 30 days from the request. Denial or withdrawal removes the email immediately; remaining link hashes are cleared after 30 days from that decision. For approved permission, periodic cleanup clears contact and link hashes after permission expires.'],
 ['Decision events and eligibility','Decision events are removed after 365 days or earlier account closure. The eligibility record, including status and associated request/decision metadata, remains until account closure; it is not covered by the summary-deletion setting.'],
 ['Call-control records','Used while calls are active or awaiting termination/retry. Removed after applicable cleanup succeeds; closing an account does not itself guarantee immediate removal of a queued call-control record.']
])
]),
('7. Deletion and privacy requests', [
('h','Deleting information or closing an account'),
('p','You can review and edit supported profiles, remove supported saved records, manage family links, stop microphone access, and use available export and account-closure controls. Some actions require a recent sign-in. Family links may need to be resolved before closure, and institutional responsibilities can require additional review.'),
('p','Deleting a summary can also delete notes generated from that summary. It does not automatically erase independent notes, plans, worksheets, exports or another account holder’s independent copy of previously shared information. Where a control is unavailable in your version, contact us for help.'),
('p','Closing an Origen account removes supported records from active application storage and creates a separate request to remove the Auth0 sign-in identity. That identity request needs separate completion and verification; a queued request is not completed deletion. Closing Origen does not delete an underlying Google account or every provider security log. The deletion receipts and other exceptions described in the retention section may remain.'),
('h','Withdrawing permission and access'),
('p','A guardian can use the private withdrawal link during its validity period; an account user can also withdraw account permission. Withdrawal blocks further permitted profile and AI use and initiates termination of affected voice sessions. It does not erase saved records or recall information already sent to providers. Permission does not create a family link or grant a guardian, coordinator or referring organization access to private conversations. Use the deletion-request process when you also want information removed.'),
('h','Requests by parents and families'),
('p','Parents and legal guardians can request review or deletion of a child’s information by emailing daniel@origenedu.ai. You do not need to link accounts to make a request. Identify the account, your relationship and the requested action without sending unnecessary sensitive documents. We may need additional information to establish your authority. A request concerning an adult student requires that student’s authorization or another valid basis.'),
('h','How to make a privacy request'),
('p','Email daniel@origenedu.ai to request access, correction, a copy of information, deletion or help with available controls. We may ask for information reasonably needed to confirm identity and authority and to find the relevant records. Do not send passwords or detailed financial identifiers. We will explain any additional steps or limits that apply to the request.'),
('p','Privacy rights and response requirements depend on the law that applies to you and the information involved. An authorized representative may make a request with appropriate proof of authority. This notice does not waive your applicable rights. If you disagree with a response, contact the same address and ask for a review.'),
('h','Security and changes to this notice'),
('p','We use authentication, access restrictions and separation of private account records from institutional reporting to help protect information. No system can guarantee absolute security. Protect your sign-in credentials, avoid sharing accounts and report suspected unauthorized access to daniel@origenedu.ai.'),
('p','When our practices change, we may update this notice and its date. We will provide additional notice or obtain additional authorization when required. School-directed use and school-supplied records may require separate agreements; an institution’s public page does not by itself create such an agreement.')
])]

INK=HexColor('#2f343b'); ACCENT=HexColor('#a4513c'); MUTED=HexColor('#756b63'); IVORY=HexColor('#f4eee4'); BORDER=HexColor('#e4d7ca')
styles={
 'title':ParagraphStyle('title',fontName='Bold',fontSize=27,leading=31,textColor=INK,spaceAfter=14),
 'sub':ParagraphStyle('sub',fontName='Body',fontSize=14,leading=19,textColor=ACCENT,spaceAfter=11),
 'meta':ParagraphStyle('meta',fontName='Body',fontSize=10,leading=14,textColor=MUTED,spaceAfter=17),
 'h':ParagraphStyle('h',fontName='Bold',fontSize=12,leading=15,textColor=INK,spaceBefore=7,spaceAfter=5,keepWithNext=True),
 'p':ParagraphStyle('p',fontName='Body',fontSize=10.7,leading=14.4,textColor=INK,spaceAfter=5,allowWidows=0,allowOrphans=0),
 'cell':ParagraphStyle('cell',fontName='Body',fontSize=10.2,leading=13.5,textColor=INK),
 'headcell':ParagraphStyle('headcell',fontName='Bold',fontSize=10.2,leading=13.5,textColor=white),
 'link':ParagraphStyle('link',fontName='Body',fontSize=9.5,leading=13,textColor=ACCENT,spaceAfter=6),
}

def draw_brand(c,x,y,size):
    # Reuse the project's SVG mark, and its literal lowercase wordmark.
    c.saveState();c.translate(x,y);c.scale(size/64,size/64)
    for element in MARK:
        name=element.tag.rsplit('}',1)[-1]
        if name=='rect':
            c.setFillColor(HexColor(element.attrib['fill']))
            c.roundRect(float(element.attrib.get('x',0)),float(element.attrib.get('y',0)),float(element.attrib['width']),float(element.attrib['height']),float(element.attrib.get('rx',0)),stroke=0,fill=1)
        elif name=='circle':
            c.setStrokeColor(HexColor(element.attrib['stroke']));c.setLineWidth(float(element.attrib['stroke-width']))
            c.circle(float(element.attrib['cx']),float(element.attrib['cy']),float(element.attrib['r']),stroke=1,fill=0)
    c.restoreState()
    c.saveState()
    c.setFillColor(ACCENT);text=c.beginText(x+size+4,y+size*.20);text.setFont('Brand',size*.82);text.setCharSpace(-2*size*.82/35);text.textOut('origen.');c.drawText(text)
    c.restoreState()

def page_frame(c,doc):
    c.saveState();w,h=letter
    c.setFillColor(IVORY);c.rect(0,h-45,w,45,stroke=0,fill=1)
    draw_brand(c,44,h-39,28)
    c.setFillColor(MUTED);c.setFont('Body',9);c.drawRightString(w-47,h-29,'PRIVACY NOTICE')
    c.setStrokeColor(BORDER);c.line(47,43,w-47,43)
    c.setFont('Body',8.5);c.drawString(47,29,'Review draft • October 15, 2026')
    c.drawRightString(w-47,29,f'{doc.page}');c.restoreState()

story=[];text=[]
for n,(title,blocks) in enumerate(PAGES):
    if n:story.append(PageBreak())
    story.append(Paragraph(escape(title),styles['title']));text.append(title.upper()+'\n')
    for kind,value in blocks:
        if kind=='table':
            cells=[[Paragraph(escape(cell),styles['headcell' if row==0 else 'cell']) for cell in pair] for row,pair in enumerate(value)]
            table=Table(cells,colWidths=[140,378],repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),ACCENT),('ROWBACKGROUNDS',(0,1),(-1,-1),[IVORY,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,-1),0.35,BORDER)]))
            story.extend([table,Spacer(1,7)]);text.extend(' | '.join(row)+'\n' for row in value)
        elif kind=='links':
            story.append(Paragraph(' &nbsp; | &nbsp; '.join(f'<link href="{escape(url,quote=True)}" color="#a4513c"><u>{escape(label)}</u></link>' for label,url in value),styles['link']))
            for label,url in value:text.append(f'{label}: {url}\n')
        else:
            story.append(Paragraph(escape(value),styles[kind]));text.append(value+'\n')
    text.append('\n')
pdf=OUT/'Origen_Edu_Public_Privacy_Notice.pdf'
doc=SimpleDocTemplate(str(pdf),pagesize=letter,leftMargin=47,rightMargin=47,topMargin=52,bottomMargin=52,title='Origen Edu Privacy Notice — Review Draft',author='Blueprint Holdings LLC',subject='Privacy information for students, families and community organizations')
doc.build(story,onFirstPage=page_frame,onLaterPages=page_frame)
# Publishable metadata only; no authoring-tool, source, or filesystem provenance.
writer=PdfWriter(clone_from=PdfReader(BytesIO(pdf.read_bytes())))
writer.metadata=None
writer.add_metadata({'/Title':'Origen Edu Privacy Notice — Review Draft','/Author':'Blueprint Holdings LLC','/Subject':'Privacy information for students, families and community organizations','/Creator':'Origen Edu','/Producer':'Origen Edu'})
if '/Metadata' in writer.root_object:del writer.root_object['/Metadata']
with pdf.open('wb') as stream:writer.write(stream)
(OUT/'Origen_Edu_Public_Privacy_Notice.txt').write_text('\n'.join(text),encoding='utf-8')
reader=PdfReader(pdf)
print(json.dumps({'pages':len(reader.pages),'words':len(' '.join(text).split()),'page_starts':[(p.extract_text() or '').splitlines()[:6] for p in reader.pages]},indent=2))

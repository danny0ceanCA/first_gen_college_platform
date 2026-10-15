from pathlib import Path
from pypdf import PdfReader
import ast,hashlib,json,re,subprocess

root=Path.cwd();qa=root/'tmp/public-privacy-sync'
path=root/'output/pdf/Origen_Edu_Public_Privacy_Notice.pdf'
reader=PdfReader(path)
text='\n\n'.join(page.extract_text() or '' for page in reader.pages)
(qa/'extracted.txt').write_text(text,encoding='utf-8')
source=ast.parse((root/'output/pdf/Origen_Edu_Public_Privacy_Notice.py').read_text(encoding='utf-8'))
pages=next(ast.literal_eval(n.value) for n in source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PAGES' for t in n.targets))
web=json.loads((root/'src/privacyNotice.en.json').read_text(encoding='utf-8'))
assert json.loads(json.dumps(pages))==web,'Policy differs from website'
compact=lambda value:re.sub(r'\s+',' ',value).strip()
normalized=compact(text)
checked=0
for title,blocks in pages:
    assert compact(title) in normalized
    for kind,value in blocks:
        values=[value] if kind not in ['table','links'] else [cell for row in value for cell in row] if kind=='table' else [label for label,url in value]
        for value in values:
            assert compact(value) in normalized, value[:80]
            checked+=1
assert not re.search(r'review draft|October 15|2026|C:[\\/]|file://|localhost|127\.0\.0\.1|\.mjs\b|\.tsx\b|SKILL\.md|AGENTS\.md|github\.com|onrender\.com|GUARDIAN_EMAIL_|RESEND_API_KEY|MIGRATION_DATABASE_URL|implementation appendix|publication checklist',text,re.I)
allowed={'https://developers.openai.com/api/docs/guides/your-data','https://openai.com/enterprise-privacy/','https://www.okta.com/privacy-policy/','https://render.com/privacy','https://policies.google.com/privacy','https://resend.com/legal/privacy-policy'}
links=[]
for n,page in enumerate(reader.pages,1):
    assert not page.get('/AA')
    for ref in page.get('/Annots',[]):
        annotation=ref.get_object();action=annotation.get('/A',{})
        assert annotation.get('/Subtype')=='/Link' and action.get('/S')=='/URI'
        assert str(action.get('/URI')) in allowed and not annotation.get('/AA')
        links.append({'page':n,'url':str(action.get('/URI'))})
assert set(link['url'] for link in links)==allowed and len(links)==6
assert not list(reader.attachments) and not reader.get_fields()
catalog=reader.trailer['/Root']
assert not any(key in catalog for key in ['/Metadata','/OpenAction','/AA','/AcroForm','/AF'])
if '/Names' in catalog:assert not any(key in catalog['/Names'] for key in ['/EmbeddedFiles','/JavaScript'])
metadata={str(key):str(value) for key,value in (reader.metadata or {}).items()}
assert metadata=={'/Title':'Origen Edu Privacy Notice','/Author':'Blueprint Holdings LLC','/Subject':'Privacy information for students, families and community organizations','/Creator':'Origen Edu','/Producer':'Origen Edu'}
before=json.loads((qa/'preservation-before.json').read_text(encoding='utf-8'))
after={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in before}
(qa/'preservation-after.json').write_text(json.dumps(after,indent=2),encoding='utf-8')
changed=[name for name in before if before[name]!=after[name]]
assert not changed,changed
base=['git','-c','safe.directory='+root.as_posix()]
modified=subprocess.run(base+['diff','--name-only'],capture_output=True,text=True,check=True).stdout.splitlines()
expected={f'output/pdf/Origen_Edu_Public_Privacy_Notice.{ext}' for ext in ['pdf','txt','py']}
assert set(modified)==expected,modified
assert len(reader.pages)==9
report={'path':str(path),'pages':len(reader.pages),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'websitePolicyMatchesExactly':True,'sourcePolicySections':len(pages),'extractedTextItemsVerified':checked,'renderDpi':90,'visuallyInspectedPages':list(range(1,10)),'metadata':metadata,'annotations':links,'attachments':[],'forms':[],'internalTextLeaks':[],'draftOrDateLabels':False,'protectedFilesChecked':len(before),'protectedFilesChanged':changed,'trackedFilesModified':modified,'limitations':['Compared to the checked-in English website policy at c422eb6; no live-site or provider behavior revalidation.','Library item was not uploaded or replaced.']}
(qa/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))

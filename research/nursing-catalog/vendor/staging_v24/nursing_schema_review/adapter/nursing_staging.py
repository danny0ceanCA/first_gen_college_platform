"""Isolated nursing research staging. No production integration or network access.
All records are pending, unverified, and ineligible for live use.
"""
from __future__ import annotations
import argparse, collections, datetime, hashlib, io, json, re, sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile
import openpyxl
VERSION='nursing-research-staging-0.3-v24'
ROOT=Path(__file__).resolve().parent
HEADERS=json.loads((ROOT.parent.parent/'nursing_schema.json').read_text(encoding='utf-8'))
CATEGORIES={'Tuition and mandatory fees','Housing','Food','Housing and food combined','Housing and food','Combined living expenses','Books and supplies','Transportation','Personal expenses','Health insurance','Document fee','Other expenses','Systemwide fees','Campus fees','Nonresident supplemental tuition','Student services fee','Tuition','Utilities','Loan fees','Mandatory fees','Telephone','One-time fees','Living expenses','Professional program fees','Estimated uniform expenses'}
ROLES={
 'Included component':'included', 'Subtotal (do not add)':'non_additive_subtotal',
 'Additional (outside total)':'additional', 'Excluded':'excluded',
 'Rate only; not additive':'rate_only','rate_not_additive':'rate_only',
 'Conditional additional cost':'conditional_additional',
 'Required external cost; excluded from published total':'required_external',
 'Optional external cost; excluded from published total':'optional_external',
 'non_additive_credit':'non_additive_credit','non_additive_breakdown':'nested_detail',
 'not_separately_reported':'not_separately_reported',
 # supplemental is deliberately unresolved: does not establish inclusion/requirement.
}
def encode(v):
 if isinstance(v,(datetime.datetime,datetime.date)):return v.isoformat()
 if isinstance(v,Decimal):return str(v)
 raise TypeError(type(v).__name__)
def dumps(v):return json.dumps(v,default=encode,ensure_ascii=False,sort_keys=True)
def number(v):
 if v is None or v=='':return None
 if isinstance(v,bool):raise ValueError('boolean_amount')
 try:n=Decimal(str(v))
 except InvalidOperation:raise ValueError('invalid_number')
 if not n.is_finite() or n<0 or n>10000000:raise ValueError('invalid_number_range')
 return n
def cents(v):return None if v is None else int((v*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
def url_safe(v):
 try:
  u=urlsplit(v or '');return u.scheme=='https' and bool(u.hostname) and not u.username and not u.password and u.port in (None,443)
 except ValueError:return False
def category(v):
 if v in CATEGORIES:return v,'exact_importer_category'
 k=lambda s:re.sub(r'\s+',' ',str(s).replace('_',' ').replace('&',' and ').strip().casefold())
 exact={k(c):c for c in CATEGORIES}
 if k(v) in exact:return exact[k(v)],'lexical_alias_candidate'
 rules=json.loads((ROOT.parent/'category_mapping_candidates_v11.json').read_text(encoding='utf-8'))['rules']
 aliases={k(r['raw_category']):r['normalized_category'] for r in rules if r['normalized_category']}
 if k(v) in aliases:return aliases[k(v)],'lexical_alias_candidate'
 return None,'unmapped_review_required'
def read(path):
 path=Path(path);blob=path.read_bytes()
 if len(blob)>20000000:raise ValueError('workbook_size_limit')
 with ZipFile(io.BytesIO(blob)) as z:
  if len(z.namelist())!=len(set(z.namelist())):raise ValueError('duplicate_zip_member')
  if len(z.infolist())>2000 or sum(i.file_size for i in z.infolist())>100000000:raise ValueError('expanded_workbook_limit')
  for n in z.namelist():
   if n.endswith('.xml') and any(v in z.read(n) for v in (b'<!DOCTYPE',b'<!ENTITY')):raise ValueError('xml_entities_not_supported')
 wf=openpyxl.load_workbook(io.BytesIO(blob),data_only=False);wv=openpyxl.load_workbook(io.BytesIO(blob),data_only=True)
 out={'sha256':hashlib.sha256(blob).hexdigest(),'budgets':[],'items':[],'evidence':{}}
 for name in wf.sheetnames:
  if name not in HEADERS:
   out['evidence'][name]=list(wf[name].values);continue
  sh=wf[name];expected=HEADERS[name]; candidates=[]
  for row in (1,5):
   vals=[c.value for c in sh[row]]
   if vals[:len(expected)]==expected:candidates.append(row)
  if len(candidates)!=1:raise ValueError('unsupported_or_ambiguous_headers_'+name)
  h=candidates[0];headers=[c.value for c in sh[h]]
  if len(headers)!=len(set(headers)) or any(not isinstance(x,str) for x in headers):raise ValueError('invalid_headers')
  for row in range(h+1,sh.max_row+1):
   raw={k:sh.cell(row,i+1).value for i,k in enumerate(headers)}
   if all(v is None for v in raw.values()):continue
   values={k:wv[name].cell(row,i+1).value for i,k in enumerate(headers)}
   formulas={k:v for k,v in raw.items() if sh.cell(row,headers.index(k)+1).data_type=='f'}
   errors=[k for k in headers if sh.cell(row,headers.index(k)+1).data_type=='e']
   out['budgets' if name=='Budgets' else 'items'].append({'row':row,'raw':raw,'values':values,'formulas':formulas,'errors':errors})
 if not out['budgets'] or not out['items']:raise ValueError('empty_core_tables')
 return out

def period_scope(item_period, budget_period, factor):
 """Conservative same-scope evidence, never infer annual/program conversions."""
 def key(v):
  v=re.sub(r'\s+',' ',str(v or '').replace('_',' ').strip().casefold())
  v=re.sub(r'(\d)\s*months?',r'\1 months',v)
  return {'program':'entire program','total program':'entire program','whole program':'entire program'}.get(v,v)
 a,b=key(item_period),key(budget_period)
 unsafe=lambda v:not v or any(x in v for x in ('mixed','rate schedule','per unit','per credit','per hour','per clock hour','/unit','/credit','/hour','unknown','not specified','not stated'))
 if unsafe(b):return False,'budget_period_not_additive'
 if a in ('same as budget','scenario period'):a=b
 if unsafe(a):return False,'item_period_not_additive'
 if a!=b:return False,'item_budget_period_mismatch'
 if factor!=1:return False,'conversion_not_independently_established'
 return True,'same_explicit_period'

def prepare_legacy(data):
 budgets=data['budgets'];items=data['items'];byid={};seen=set()
 for b in budgets:
  key=b['values'].get('Budget ID')
  if not key or key in byid:raise ValueError('duplicate_or_missing_budget_id')
  byid[key]=b;b['id']=key;b['issues']=['source_verification_required','scope_review_required'];b['normalized']={'production_status':'Not approved','source_verified':False};b['items']=[]
  if b['errors']:b['issues'].append('excel_error')
  if not url_safe(b['values'].get('Official source URL')):b['issues'].append('invalid_source_url')
  b['issues'].append('institution_domain_review_required')
  year=b['values'].get('Academic year')
  if not re.fullmatch(r'20\d{2}[-–]\d{2}',str(year)):b['issues'].append('nonstandard_or_unknown_academic_year')
  b['normalized']['academic_year']=year if re.fullmatch(r'20\d{2}[-–]\d{2}',str(year)) else None
  if 'Published total' in b['formulas']:b['issues'].append('published_total_is_formula')
 for i in items:
  v=i['values'];key=v.get('Cost item ID');parent=byid.get(v.get('Budget ID'))
  if not key or key in seen:raise ValueError('duplicate_or_missing_item_id')
  if parent is None:raise ValueError('orphan_item')
  seen.add(key);i['id']=key;i['issues']=[];parent['items'].append(i)
  cat,status=category(v.get('Category'));role=ROLES.get(v.get('Relationship to total'))
  i['normalized']={'category':cat,'category_mapping_status':status,'role':role,'period_raw':v.get('Amount period'),'source_verified':False}
  if status!='exact_importer_category':i['issues'].append(status)
  if role is None:i['issues'].append('unknown_role_review_required')
  source=v.get('Source override URL') or parent['values'].get('Official source URL')
  i['normalized']['source_url']=source
  if not url_safe(source):i['issues'].append('invalid_source_url')
  if v.get('Effective source URL') and v['Effective source URL']!=source:i['issues'].append('cached_source_differs')
  if i['errors']:i['issues'].append('excel_error')
  inputs=['Amount','Factor to budget period','Verified budget-period override'];unsafe=any(x in i['formulas'] for x in inputs)
  amount=None
  try:
   raw=number(v.get('Amount'));factor=number(v.get('Factor to budget period'));override=number(v.get('Verified budget-period override'))
   if unsafe:i['issues'].append('formula_in_source_input')
   elif override is not None:
    i['issues'].append('override_requires_verification')
    # Store but never promote an override to a verified amount.
   elif raw is not None and factor is not None:
    if not 0<factor<=24:raise ValueError('invalid_factor')
    if role=='included':
     scope_ok,scope_reason=period_scope(v.get('Amount period'),parent['values'].get('Budget period'),factor)
     i['normalized']['period_scope_status']=scope_reason
     if scope_ok:amount=cents(raw*factor)
     else:i['issues'].append(scope_reason)
    if factor!=1:i['issues'].append('period_conversion_requires_review')
   if role=='included' and amount is None:i['issues'].append('missing_included_amount')
   cached=number(v.get('Budget-period amount'))
   if cached is not None and amount is not None and abs(cents(cached)-amount)>1:i['issues'].append('cached_amount_mismatch')
  except ValueError as e:i['issues'].append(str(e));amount=None
  i['normalized']['budget_period_cents']=amount
 for b in budgets:
  included=[i for i in b['items'] if i['normalized']['role']=='included'];missing=any(i['normalized']['budget_period_cents'] is None for i in included)
  subtotal=None if not included or missing else sum(i['normalized']['budget_period_cents'] for i in included)
  try:total=cents(number(b['values'].get('Published total')))
  except ValueError:total=None;b['issues'].append('invalid_published_total')
  diff=None if total is None or subtotal is None else subtotal-total
  b['normalized'].update(published_cents=total,components_cents=subtotal,difference_cents=diff)
  b['bucket']='non_additive' if not included else 'incomplete' if missing else 'derived' if total is None else 'discrepancy' if abs(diff)>1 else 'reconciled'
  if any(i['issues'] for i in b['items']):b['issues'].append('item_review_required')
 return data

def normalized_year(raw):
 # Unicode dash normalization is display normalization, not evidence of a new year.
 text=str(raw or '')
 display=text.replace('–','-').replace('—','-')
 match=re.fullmatch(r'(20\d{2})-(\d{2})',display)
 valid=bool(match and int(match[2])==(int(match[1])+1)%100)
 return {'academic_year_raw':raw,'academic_year_display':display,
         'academic_year':display if valid else None,
         'academic_year_status':'exact_one_year_label' if valid else 'qualified_or_nonstandard_label',
         'academic_year_dash_normalized':display!=text}

def v24_value(v):
 kind=v.get('Value representation')
 allowed={'Recorded scalar amount','Published range','Published lower bound','Published upper bound','Unpriced or variable'}
 if kind not in allowed:raise ValueError('unsupported_v24_value_representation')
 lo=number(v.get('Published lower bound'));hi=number(v.get('Published upper bound'))
 scalar=number(v.get('Amount'))
 if kind=='Published range' and (lo is None or hi is None or lo>hi):raise ValueError('invalid_two_sided_range')
 if kind=='Published lower bound' and (lo is None or hi is not None):raise ValueError('invalid_lower_bound')
 if kind=='Published upper bound' and (hi is None or lo is not None):raise ValueError('invalid_upper_bound')
 if kind in {'Recorded scalar amount','Unpriced or variable'} and (lo is not None or hi is not None):raise ValueError('unexpected_bounds')
 if kind!='Recorded scalar amount' and scalar is not None:raise ValueError('scalar_and_nonscalar_conflict')
 if kind=='Recorded scalar amount' and scalar is None:raise ValueError('missing_recorded_scalar')
 return {'value_representation':kind,'source_scalar_cents':cents(scalar),
         'published_lower_bound_cents':cents(lo),'published_upper_bound_cents':cents(hi),
         'bounds_period_raw':v.get('Amount period'),'bound_extraction_basis':v.get('Bound extraction basis'),
         'caveated_handling':v.get('Caveated handling'),'fresh_range_verification':v.get('Fresh range verification'),
         'bounds_automatically_additive':False}

def prepare(data):
 data=prepare_legacy(data)
 # V24 fields are mandatory here: old workbooks require the separately retained legacy adapter.
 for b in data['budgets']:
  if not {'Caveated-use treatment','Required source-scope handling','Automatic production permission'} <= b['values'].keys():raise ValueError('missing_v24_budget_fields')
  if b['values']['Automatic production permission'] is not False:raise ValueError('v24_production_permission_must_be_false')
  b['normalized'].update(normalized_year(b['values'].get('Academic year')))
  if b['normalized']['academic_year'] is not None:
   b['issues']=[x for x in b['issues'] if x!='nonstandard_or_unknown_academic_year']
  elif 'nonstandard_or_unknown_academic_year' not in b['issues']:b['issues'].append('nonstandard_or_unknown_academic_year')
  b['normalized'].update(caveated_use_treatment=b['values'].get('Caveated-use treatment'),required_source_scope_handling=b['values'].get('Required source-scope handling'),automatic_production_permission=False,caveated_decisions=[])
 byid={b['id']:b for b in data['budgets']};items={i['id']:i for i in data['items']}
 for i in data['items']:
  if not {'Published lower bound','Published upper bound','Value representation','Bound extraction basis','Caveated handling','Fresh range verification'} <= i['values'].keys():raise ValueError('missing_v24_item_fields')
  if any(k in i['formulas'] for k in ['Published lower bound','Published upper bound','Value representation']):raise ValueError('formula_in_v24_bound_input')
  i['normalized'].update(v24_value(i['values']))
  i['normalized']['source_scalar_status']='formula_untrusted' if 'Amount' in i['formulas'] else 'recorded_value'
  if 'Amount' in i['formulas']:i['normalized']['source_scalar_cents']=None
  i['normalized']['caveated_decisions']=[]
  if i['normalized']['value_representation']!='Recorded scalar amount':
   i['normalized']['budget_period_cents']=None
   i['issues'].append('nonscalar_requires_qualified_presentation')
 rows=data['evidence'].get('Caveated use decisions')
 if not rows:raise ValueError('missing_v24_decisions')
 header=rows[0];required=['Reference','Institution','Treatment','Suggested wording','Required caveat','Still unresolved','Official source','Review basis','Live eligible']
 if list(header)!=required:raise ValueError('invalid_v24_decision_headers')
 decisions=[];seen=set()
 for row in rows[1:]:
  if not any(v is not None for v in row):continue
  d=dict(zip(header,row));ref=d['Reference']
  if ref in seen or not isinstance(ref,str):raise ValueError('duplicate_or_invalid_decision_reference')
  seen.add(ref)
  m=re.match(r'^(NUR-\d{4})(?:$|-)',ref)
  if not m or m[1] not in byid:raise ValueError('orphan_decision')
  if ref not in byid and ref not in items and ref!=m[1]+'-RANGE':raise ValueError('orphan_or_unknown_decision_reference')
  if d['Live eligible'] is not False:raise ValueError('decision_cannot_enable_production')
  if not d['Treatment'] or not d['Required caveat']:raise ValueError('incomplete_caveated_decision')
  normalized={'reference':ref,'budget_id':m[1],'treatment':d['Treatment'],'suggested_wording':d['Suggested wording'],'required_caveat':d['Required caveat'],'still_unresolved':d['Still unresolved'],'source_url':d['Official source'],'review_basis':d['Review basis'],'live_eligible':False}
  decisions.append(normalized);byid[m[1]]['normalized']['caveated_decisions'].append(normalized)
  if ref in items:items[ref]['normalized']['caveated_decisions'].append(normalized)
 data['v24_summary']={'decision_count':len(decisions),'decision_category_counts':dict(collections.Counter(d['treatment'] for d in decisions)),
  'year_dash_normalized_count':sum(b['normalized']['academic_year_dash_normalized'] for b in data['budgets']),
  'item_representation_counts':dict(collections.Counter(i['normalized']['value_representation'] for i in data['items'])),
  'unpriced_included_items':sum(i['normalized']['role']=='included' and i['normalized']['value_representation']=='Unpriced or variable' for i in data['items']),
  'unpriced_included_scenarios':len({i['values']['Budget ID'] for i in data['items'] if i['normalized']['role']=='included' and i['normalized']['value_representation']=='Unpriced or variable'}),
  'unresolved_source_conflicts':len([r for r in data['evidence'].get('Unresolved source conflicts',[])[1:] if any(v is not None for v in r)])}
 return data

SCHEMA='''CREATE TABLE metadata(version TEXT PRIMARY KEY);
CREATE TABLE batches(id TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL,report_json TEXT NOT NULL,evidence_json TEXT NOT NULL);
CREATE TABLE budgets(batch_id TEXT REFERENCES batches(id),id TEXT,source_row INTEGER,raw_json TEXT NOT NULL,normalized_json TEXT NOT NULL,issues_json TEXT NOT NULL,bucket TEXT,review_state TEXT NOT NULL DEFAULT 'pending' CHECK(review_state='pending'),source_verified INTEGER NOT NULL DEFAULT 0 CHECK(source_verified=0),live_eligible INTEGER NOT NULL DEFAULT 0 CHECK(live_eligible=0),PRIMARY KEY(batch_id,id));
CREATE TABLE items(batch_id TEXT,id TEXT,budget_id TEXT,source_row INTEGER,raw_json TEXT NOT NULL,normalized_json TEXT NOT NULL,issues_json TEXT NOT NULL,PRIMARY KEY(batch_id,id),FOREIGN KEY(batch_id,budget_id) REFERENCES budgets(batch_id,id));'''
def validate_database(c):
 """Reject spoofed metadata, changed constraints, triggers, views, or bad rows."""
 def schema(db):
  return sorted(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall())
 reference=sqlite3.connect(':memory:')
 try:
  reference.executescript(SCHEMA)
  if schema(c)!=schema(reference):raise ValueError('unrecognized_database_schema')
 finally:reference.close()
 if c.execute('SELECT version FROM metadata').fetchall()!=[(VERSION,)]:raise ValueError('unrecognized_database')
 if c.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('existing_database_foreign_key_violation')
 if c.execute("SELECT count(*) FROM budgets WHERE review_state!='pending' OR source_verified!=0 OR live_eligible!=0").fetchone()[0]:raise ValueError('existing_database_unsafe_state')

def stage(path,db=None):
 data=prepare(read(path))
 fingerprint=hashlib.sha256(Path(__file__).read_bytes()+(ROOT.parent/'category_mapping_candidates_v11.json').read_bytes()+(ROOT.parent.parent/'nursing_schema.json').read_bytes()).hexdigest()
 bid=hashlib.sha256((VERSION+fingerprint+data['sha256']).encode()).hexdigest()
 report={'version':VERSION,'adapter_mapping_sha256':fingerprint,'source_sha256':data['sha256'],'batch_id':bid,'budgets':len(data['budgets']),'cost_items':len(data['items']),'buckets':dict(collections.Counter(b['bucket'] for b in data['budgets'])),'category_status':dict(collections.Counter(i['normalized']['category_mapping_status'] for i in data['items'])),'item_issues':dict(collections.Counter(x for i in data['items'] for x in i['issues'])),'live_eligible_records':0,'all_records_pending':True,'supporting_sheets':len(data['evidence'])}
 report['v24']=data['v24_summary']
 if db is not None:
  db=Path(db).resolve()
  if db.parent!=ROOT or db.suffix!='.sqlite':raise ValueError('database_must_be_in_isolated_adapter_directory')
  if db.exists() and db.stat().st_nlink>1:raise ValueError('database_hardlink_not_allowed')
  c=sqlite3.connect(db);c.execute('PRAGMA foreign_keys=ON')
  try:
   if not c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():c.executescript(SCHEMA);c.execute('INSERT INTO metadata VALUES(?)',(VERSION,));c.commit()
   validate_database(c)
   if c.execute('SELECT 1 FROM batches WHERE id=?',(bid,)).fetchone():report['already_imported']=True
   else:
    with c:
     c.execute('INSERT INTO batches VALUES(?,?,?,?)',(bid,data['sha256'],dumps(report),dumps(data['evidence'])))
     for b in data['budgets']:c.execute('INSERT INTO budgets(batch_id,id,source_row,raw_json,normalized_json,issues_json,bucket) VALUES(?,?,?,?,?,?,?)',(bid,b['id'],b['row'],dumps(b['raw']),dumps(b['normalized']),dumps(b['issues']),b['bucket']))
     for i in data['items']:c.execute('INSERT INTO items VALUES(?,?,?,?,?,?,?)',(bid,i['id'],i['values']['Budget ID'],i['row'],dumps(i['raw']),dumps(i['normalized']),dumps(i['issues'])))
    report['already_imported']=False
   report['integrity_check']=c.execute('PRAGMA integrity_check').fetchone()[0];report['foreign_key_errors']=c.execute('PRAGMA foreign_key_check').fetchall()
  finally:c.close()
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('workbook');p.add_argument('--database');a=p.parse_args();print(dumps(stage(a.workbook,a.database)))

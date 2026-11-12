"""Offline public-cost staging only. No application imports, credentials or network."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import sqlite3
import unicodedata
from urllib.parse import urlsplit
from zipfile import ZipFile
import xml.etree.ElementTree as ET

VERSION = 'coa-workbook-staging-v1.2'
LOCAL = Path(__file__).resolve().parent / '.local'
APP_ID = 0x4F434F41
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
BUDGET_HEADERS = ['Budget ID','College','Academic year','Student level','Entering cohort / applies to','Residency','Housing','Enrollment','Budget period','Currency','Published total','Official source URL','Page / table location','Source checked','Scope and exclusions','Breakdown complete?','Program / degree','Normalized cohort key','Fee residency','Geographic applicability','Coverage months','Summer treatment','Dependent children','Total basis','Source review']
ITEM_HEADERS = ['Budget ID','Category','Original source label','Amount','Relationship to total','Amount period','Charge type','Waivable?','Source override URL','Conditions / notes','Cost item ID','Source page / table','Item source checked','Factor to budget period','Budget-period amount','Amount status','Amount basis','Effective source URL','Verified budget-period override','Verification URL','Verification page / date','Verification checked','Resolution']
DOMAINS = {'UC Berkeley':'berkeley.edu','UCLA':'ucla.edu','UC Merced':'ucmerced.edu','UC Irvine':'uci.edu','UC Davis':'ucdavis.edu','UC Riverside':'ucr.edu','UC Santa Cruz':'ucsc.edu','UC San Francisco':'ucsf.edu','UC Santa Barbara':'ucsb.edu','UC San Diego':'ucsd.edu'}
ROLES = {'Included component','Subtotal (do not add)','Additional (outside total)','Excluded'}
# Preserve source categories independently; never collapse mandatory fees into
# tuition or treat a combined housing/food allowance as two additive components.
CATEGORIES = {'Tuition and mandatory fees','Housing','Food','Housing and food combined','Housing and food','Combined living expenses','Books and supplies','Transportation','Personal expenses','Health insurance','Document fee','Other expenses','Systemwide fees','Campus fees','Nonresident supplemental tuition','Student services fee','Tuition','Utilities','Loan fees','Mandatory fees','Telephone','One-time fees'}

def text(value):
    return '' if value is None else str(value).strip()

def normalized(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD',text(value)) if not unicodedata.combining(c)).casefold().split())

def number(value):
    if value is None or text(value)=='': return None
    if isinstance(value,bool):raise ValueError('boolean_is_not_an_amount')
    try:
        n = Decimal(str(value))
        if not n.is_finite() or n < 0 or n > 10000000: raise ValueError('amount_out_of_range')
        return n
    except InvalidOperation as e: raise ValueError('invalid_number') from e

def cents(value):
    return None if value is None else int((value*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))

def source_ok(value, college=None):
    try:
        u=urlsplit(text(value));host=(u.hostname or '').lower()
        domains=[DOMAINS[college],'ucop.edu'] if college in DOMAINS else list(DOMAINS.values())+['ucop.edu']
        return u.scheme=='https' and not u.username and not u.password and u.port in (None,443) and any(host==d or host.endswith('.'+d) for d in domains)
    except ValueError: return False

def date_ok(value):
    try:
        if isinstance(value,(float,int,Decimal)):
            return 30000 <= float(value) <= 90000
        datetime.fromisoformat(text(value).replace('Z','+00:00'));return True
    except ValueError:return False

def housing_key(value):
    s=normalized(value)
    # A negated parent qualifier identifies independent off-campus housing;
    # it must not match the positive "with parents" branch below.
    if 'off' in s and 'not with parents' in s and not any(x in s for x in ['with relatives','with family']):return 'renting'
    if any(x in s for x in ['relative','at home','family','with parents','living with parents']):return 'with_family'
    if s=='commuter' or 'remote learner' in s:return 'commuter_unspecified'
    if 'off' in s:return 'renting' if any(x in s for x in ['apartment','private','shared','not with parents']) else 'off_campus_unspecified'
    if any(x in s for x in ['on-campus','on campus','residence hall','university housing']):return 'on_campus'
    return 'unknown'

def read_workbook(path):
    blob=Path(path).read_bytes()
    if len(blob)>20000000:raise ValueError('workbook_size_limit')
    digest=hashlib.sha256(blob).hexdigest()
    with ZipFile(io.BytesIO(blob)) as z:
        if len(set(z.namelist()))!=len(z.namelist()):raise ValueError('duplicate_zip_member')
        if len(z.infolist())>2000 or sum(i.file_size for i in z.infolist())>100000000 or any(i.file_size>40000000 for i in z.infolist()):raise ValueError('expanded_workbook_limit')
        def xml(name):
            raw=z.read(name)
            if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:raise ValueError('xml_entities_not_supported')
            return ET.fromstring(raw)
        shared=[''.join(e.itertext()) for e in xml('xl/sharedStrings.xml').findall('m:si',NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        rels={r.attrib['Id']:r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels') if r.attrib.get('TargetMode')!='External'}
        sheets={}
        for s in xml('xl/workbook.xml').findall('m:sheets/m:sheet',NS):
            key=s.attrib.get('name')
            if key not in ['Budgets','Cost items']:continue
            target=rels[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
            if not target.startswith('xl/worksheets/') or '..' in target.split('/'):raise ValueError('invalid_sheet_target')
            rows={}
            for row in xml(target).findall('m:sheetData/m:row',NS):
                cells={}; formulas=[];errors=[]
                for cell in row.findall('m:c',NS):
                    address=cell.attrib['r']; col=re.match('[A-Z]+',address).group();v=cell.find('m:v',NS);inline=cell.find('m:is',NS)
                    raw=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else None
                    typ=cell.attrib.get('t');value=shared[int(raw)] if typ=='s' and raw is not None else raw
                    if typ not in ('s','inlineStr','str','e','b') and raw is not None:
                        try:value=int(raw) if re.fullmatch(r'-?\d+',raw) else float(raw)
                        except ValueError:pass
                    if cell.find('m:f',NS) is not None:formulas.append(col)
                    if typ=='b':value=raw=='1'
                    if typ=='e':errors.append(col)
                    cells[col]=value
                rows[int(row.attrib['r'])]=(cells,formulas,errors)
            sheets[key]=rows
        def extract(name,expected):
            if name not in sheets:raise ValueError('missing_input_sheet_'+name)
            header=sheets[name].get(5,({},[],[]))[0]
            def col(i):
                s=''
                while i:i,r=divmod(i-1,26);s=chr(65+r)+s
                return s
            if [header.get(col(i+1)) for i in range(len(expected))]!=expected:raise ValueError('unsupported_workbook_columns_'+name)
            output=[]
            for row,(cells,formulas,errors) in sorted(sheets[name].items()):
                if row<=5:continue
                values={key:cells.get(col(i+1)) for i,key in enumerate(expected)}
                if not any(text(v) for v in values.values()):continue
                output.append({'row':row,'values':values,'formulas':formulas,'errors':errors})
            return output
        b=extract('Budgets',BUDGET_HEADERS);i=extract('Cost items',ITEM_HEADERS)
    if not b or not i or len(b)>10000 or len(i)>100000:raise ValueError('input_record_limit')
    return {'sha256':digest,'bytes':len(blob),'budgets':b,'items':i,'source_bytes':blob}

def prepare(payload):
    budgets=[];items=[];by_id=defaultdict(list)
    for row in payload['budgets']:
        v=row['values'];flags=[];invalid=[];key=text(v.get('Budget ID'))
        for name in ['Budget ID','College','Academic year','Student level','Entering cohort / applies to','Residency','Housing','Enrollment','Budget period','Currency','Program / degree']:
            if not text(v.get(name)):invalid.append('missing_'+name)
        if v.get('College') not in DOMAINS:invalid.append('unmapped_campus')
        if not re.fullmatch(r'20\d{2}[-–]\d{2}',text(v.get('Academic year'))):invalid.append('invalid_academic_year')
        if v.get('Currency')!='USD':invalid.append('unsupported_currency')
        if not source_ok(v.get('Official source URL'),v.get('College')):invalid.append('invalid_budget_source')
        if not date_ok(v.get('Source checked')):flags.append('source_check_date_missing_or_invalid')
        if row.get('errors'):invalid.append('excel_error')
        if 'K' in row.get('formulas',[]):invalid.append('published_total_is_formula')
        try:total=cents(number(v.get('Published total')))
        except ValueError:total=None;invalid.append('invalid_published_total')
        if housing_key(v.get('Housing')) in ['unknown','commuter_unspecified','off_campus_unspecified']:flags.append('housing_scope_requires_review')
        scenario=json.dumps([normalized(v.get(k)) for k in ['College','Academic year','Student level','Program / degree','Normalized cohort key','Entering cohort / applies to','Residency','Fee residency','Geographic applicability','Housing','Enrollment','Budget period','Currency','Coverage months','Summer treatment','Dependent children']],ensure_ascii=False)
        b={'key':key,'row':row['row'],'values':v,'flags':flags,'invalid':invalid,'total':total,'scenario':scenario,'items':[],'normalized':{'housing':housing_key(v.get('Housing')),'student_level':normalized(v.get('Student level')),'source_verified':False,'import_contract':'workbook-v2'}}
        budgets.append(b);by_id[key].append(b)
    scenarios=Counter(b['scenario'] for b in budgets)
    item_ids=Counter(text(r['values'].get('Cost item ID')) for r in payload['items'])
    for row in payload['items']:
        v=row['values'];key=text(v.get('Budget ID'));parents=by_id.get(key,[]);flags=[];invalid=[]
        parent=parents[0] if len(parents)==1 else None
        if not parent:invalid.append('orphan_or_ambiguous_budget')
        if not text(v.get('Cost item ID')) or item_ids[text(v.get('Cost item ID'))]>1:invalid.append('missing_or_duplicate_item_id')
        if v.get('Relationship to total') not in ROLES:invalid.append('unknown_item_role')
        if not text(v.get('Category')) or not text(v.get('Original source label')):invalid.append('missing_category_or_label')
        if v.get('Category') not in CATEGORIES:flags.append('category_mapping_required')
        if row.get('errors'):invalid.append('excel_error')
        if set(row.get('formulas',[])) & {'D','N','S'}:invalid.append('source_input_is_formula')
        source=v.get('Source override URL') or (parent['values'].get('Official source URL') if parent else None)
        if not source_ok(source,parent['values'].get('College') if parent else None):invalid.append('invalid_item_source')
        if v.get('Effective source URL') and text(v['Effective source URL'])!=text(source):flags.append('cached_source_differs')
        raw=factor=override=amount=None
        try:
            raw=number(v.get('Amount'));factor=number(v.get('Factor to budget period'));override=number(v.get('Verified budget-period override'))
            if factor is not None and not Decimal('0')<factor<=24:raise ValueError('invalid_factor')
            if override is not None:
                flags.append('explicit_source_override_requires_review')
                if not source_ok(v.get('Verification URL')) or not text(v.get('Verification page / date')) or not date_ok(v.get('Verification checked')) or not text(v.get('Resolution')):invalid.append('override_evidence_missing')
                else:amount=cents(override)
            elif raw is not None and factor is not None:amount=cents(raw*factor)
            if factor is not None and factor!=1:
                flags.append('documented_period_conversion')
                if not text(v.get('Conditions / notes')) and not text(v.get('Amount basis')):invalid.append('conversion_basis_missing')
            cached=number(v.get('Budget-period amount'))
            if cached is not None and amount is not None and abs(cents(cached)-amount)>1:invalid.append('cached_amount_mismatch')
        except ValueError:invalid.append('invalid_amount_or_factor')
        if v.get('Relationship to total')=='Included component' and amount is None:flags.append('missing_included_amount')
        if v.get('Relationship to total')=='Excluded' and raw is None and v.get('Amount status')=='Published dash / not applicable':flags.append('published_dash_preserved')
        item={'row':row['row'],'key':text(v.get('Cost item ID')),'budget':parent,'values':v,'flags':flags,'invalid':invalid,'amount':amount,'raw_amount':str(raw) if raw is not None else None,'factor':str(factor) if factor is not None else None,'source':source}
        items.append(item)
        if parent:parent['items'].append(item)
    for b in budgets:
        if not b['key'] or len(by_id[b['key']])!=1:b['invalid'].append('missing_or_duplicate_budget_id')
        if scenarios[b['scenario']]>1:b['invalid'].append('duplicate_scenario')
        included=[i for i in b['items'] if i['values'].get('Relationship to total')=='Included component']
        if not included:b['invalid'].append('no_included_components')
        missing=sum(i['amount'] is None for i in included)
        b['sum']=sum(i['amount'] for i in included if i['amount'] is not None)
        b['difference']=None if missing or b['total'] is None else b['sum']-b['total']
        if any(i['invalid'] for i in b['items']):b['invalid'].append('invalid_child_item')
        if any('explicit_source_override_requires_review' in i['flags'] for i in b['items']):b['flags'].append('explicit_source_override_requires_review')
        for flag in ['category_mapping_required','cached_source_differs']:
            if any(flag in i['flags'] for i in b['items']):b['flags'].append(flag)
        if b['invalid']:b['bucket']='invalid'
        elif missing:b['bucket']='incomplete'
        elif b['total'] is None:b['bucket']='derived'
        elif abs(b['difference'])>1:b['bucket']='discrepancy'
        else:b['bucket']='reconciled'
        if b['difference'] and abs(b['difference'])<=1:b['flags'].append('rounding_difference')
        # Reconciliation is a numerical result, never source approval.
        b['flagged']=b['bucket']!='reconciled' or bool(b['flags'])
    return budgets,items

SCHEMA = '''
CREATE TABLE IF NOT EXISTS catalog_metadata(version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, importer_version TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, report_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS budget_records(id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(id), source_row INTEGER NOT NULL, budget_key TEXT NOT NULL, scenario_key TEXT NOT NULL, bucket TEXT NOT NULL CHECK(bucket IN ('reconciled','derived','discrepancy','incomplete','invalid')), flagged INTEGER NOT NULL, review_state TEXT NOT NULL DEFAULT 'pending' CHECK(review_state='pending'), source_verified INTEGER NOT NULL DEFAULT 0 CHECK(source_verified=0), published_cents INTEGER, components_cents INTEGER NOT NULL, difference_cents INTEGER, raw_json TEXT NOT NULL, normalized_json TEXT NOT NULL, issues_json TEXT NOT NULL, UNIQUE(batch_id,source_row));
CREATE TABLE IF NOT EXISTS cost_items(id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(id), budget_record_id INTEGER REFERENCES budget_records(id), source_row INTEGER NOT NULL, item_key TEXT NOT NULL, role TEXT, raw_amount TEXT, factor TEXT, budget_period_cents INTEGER, effective_source_url TEXT, raw_json TEXT NOT NULL, issues_json TEXT NOT NULL, UNIQUE(batch_id,source_row));
CREATE INDEX IF NOT EXISTS budget_batch_bucket ON budget_records(batch_id,bucket,flagged);
CREATE VIEW IF NOT EXISTS reconciled_review_queue AS SELECT * FROM budget_records WHERE bucket='reconciled' AND flagged=0;
CREATE VIEW IF NOT EXISTS flagged_review_queue AS SELECT * FROM budget_records WHERE flagged=1;
'''

def connect_staging(path):
    path=Path(path)
    if path.suffix!='.sqlite':raise ValueError('sqlite_file_required')
    c=sqlite3.connect(path);c.execute('PRAGMA foreign_keys=ON')
    app=c.execute('PRAGMA application_id').fetchone()[0]
    existing=c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    if app not in (0,APP_ID) or app==0 and existing:c.close();raise ValueError('not_a_cost_staging_database')
    if app==APP_ID:
        if c.execute('SELECT version FROM catalog_metadata').fetchall()!=[(1,)]:c.close();raise ValueError('unsupported_staging_schema')
    else:
        c.executescript(SCHEMA);c.execute('INSERT INTO catalog_metadata VALUES(1)');c.execute(f'PRAGMA application_id={APP_ID}');c.commit()
    return c

def import_payload(payload,db_path):
    budgets,items=prepare(payload)
    batch=hashlib.sha256((VERSION+':'+payload['sha256']).encode()).hexdigest()
    report={'batch_id':batch,'source_sha256':payload['sha256'],'importer_version':VERSION,'budgets':len(budgets),'cost_items':len(items),'buckets':dict(Counter(b['bucket'] for b in budgets)),'flagged_budgets':sum(b['flagged'] for b in budgets),'unflagged_reconciled':sum(not b['flagged'] for b in budgets),'invalid_items':sum(bool(i['invalid']) for i in items),'all_source_verification':'not_independently_verified','live_eligible_records':0}
    if db_path is None:return report
    c=connect_staging(db_path)
    try:
        old=c.execute('SELECT report_json FROM import_batches WHERE id=?',(batch,)).fetchone()
        if old:return {**json.loads(old[0]),'already_imported':True}
        with c:
            c.execute('INSERT INTO import_batches(id,source_sha256,importer_version,report_json) VALUES(?,?,?,?)',(batch,payload['sha256'],VERSION,json.dumps(report)))
            for b in budgets:
                cur=c.execute('INSERT INTO budget_records(batch_id,source_row,budget_key,scenario_key,bucket,flagged,published_cents,components_cents,difference_cents,raw_json,normalized_json,issues_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(batch,b['row'],b['key'],b['scenario'],b['bucket'],int(b['flagged']),b['total'],b['sum'],b['difference'],json.dumps(b['values']),json.dumps(b['normalized']),json.dumps({'invalid':b['invalid'],'review':b['flags']})))
                b['db_id']=cur.lastrowid
            for i in items:
                c.execute('INSERT INTO cost_items(batch_id,budget_record_id,source_row,item_key,role,raw_amount,factor,budget_period_cents,effective_source_url,raw_json,issues_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(batch,i['budget'].get('db_id') if i['budget'] else None,i['row'],i['key'],i['values'].get('Relationship to total'),i['raw_amount'],i['factor'],i['amount'],i['source'],json.dumps(i['values']),json.dumps({'invalid':i['invalid'],'review':i['flags']})))
        return {**report,'already_imported':False}
    finally:c.close()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--workbook',required=True);p.add_argument('--write',action='store_true');p.add_argument('--database-name',default='uc-coa-staging.sqlite');args=p.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9_-]+\.sqlite',args.database_name):p.error('database-name must be a plain .sqlite filename')
    data=read_workbook(args.workbook)
    if args.write:
        LOCAL.mkdir(exist_ok=True);sources=LOCAL/'sources';sources.mkdir(exist_ok=True);snapshot=sources/(data['sha256']+'.xlsx')
        if snapshot.exists() and hashlib.sha256(snapshot.read_bytes()).hexdigest()!=data['sha256']:raise ValueError('snapshot_hash_mismatch')
        if not snapshot.exists():snapshot.write_bytes(data['source_bytes'])
    report=import_payload(data,LOCAL/args.database_name if args.write else None)
    if args.write:(LOCAL/(report['batch_id']+'-report.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()

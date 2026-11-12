"""Export a batch's staging review queue without changing the database."""
import argparse
from collections import Counter
import csv
from decimal import Decimal
import json
from pathlib import Path
import re
import sqlite3
from import_workbook import LOCAL, APP_ID

def safe_cell(value):
    if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')):return "'"+value
    return value

def dollars(value):
    return '' if value is None else Decimal(value)/100

REASONS={
    'derived':'Component sum available; no separately published total',
    'discrepancy':'Published total differs from the included-component sum',
    'incomplete':'Included component amounts are missing',
    'invalid':'Structural or source validation needs resolution',
    'housing_scope_requires_review':'Source housing scope needs clarification before matching a student',
    'explicit_source_override_requires_review':'Review the documented replacement amount against its verification source',
}

def export_flagged(database,batch_id,output_dir):
    c=sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True)
    c.row_factory=sqlite3.Row
    try:
        if c.execute('PRAGMA application_id').fetchone()[0]!=APP_ID:raise ValueError('not_a_cost_staging_database')
        batch=c.execute('SELECT * FROM import_batches WHERE id=?',(batch_id,)).fetchone()
        if batch is None:raise ValueError('unknown_batch')
        records=[]
        for row in c.execute('SELECT * FROM flagged_review_queue WHERE batch_id=? ORDER BY source_row',(batch_id,)):
            record=dict(row);record['raw']=json.loads(record.pop('raw_json'));record['normalized']=json.loads(record.pop('normalized_json'));record['issues']=json.loads(record.pop('issues_json'))
            record['cost_items']=[]
            for item in c.execute('SELECT * FROM cost_items WHERE budget_record_id=? ORDER BY source_row',(row['id'],)):
                i=dict(item);i['raw']=json.loads(i.pop('raw_json'));i['issues']=json.loads(i.pop('issues_json'));record['cost_items'].append(i)
            records.append(record)
        report={'batch_id':batch_id,'source_sha256':batch['source_sha256'],'importer_version':batch['importer_version'],'flagged_scenarios':len(records),'by_bucket':dict(Counter(r['bucket'] for r in records)),'by_campus':dict(Counter(r['raw']['College'] for r in records)),'review_reasons':dict(Counter(reason for r in records for reason in r['issues']['review'])),'source_verification':'Not independently verified. All records remain pending.','records':records}
    finally:c.close()
    output_dir=Path(output_dir);output_dir.mkdir(parents=True,exist_ok=True)
    fields=['Budget ID','College','Academic year','Student level','Program','Cohort','Residency','Source housing','Housing interpretation','Bucket','Review reasons','Published total USD','Component sum USD','Difference USD','Missing included item IDs','Override item IDs','Official source URL','Verification URLs','Source checked','Source row','Scope notes','Source SHA256','Batch ID']
    with (output_dir/'flagged-scenarios.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f);writer.writerow(fields)
        for r in records:
            raw=r['raw'];items=r['cost_items'];reasons=r['issues']['invalid']+r['issues']['review']
            if r['bucket']!='reconciled':reasons=[r['bucket']]+reasons
            values=[r['budget_key'],raw['College'],raw['Academic year'],raw['Student level'],raw.get('Program / degree'),raw.get('Normalized cohort key'),raw['Residency'],raw['Housing'],r['normalized']['housing'],r['bucket'],'; '.join(REASONS.get(reason,reason.replace('_',' ')) for reason in reasons),dollars(r['published_cents']),dollars(r['components_cents']),dollars(r['difference_cents']),'; '.join(i['item_key'] for i in items if 'missing_included_amount' in i['issues']['review']),'; '.join(i['item_key'] for i in items if 'explicit_source_override_requires_review' in i['issues']['review']),raw['Official source URL'],'; '.join(sorted({i['raw']['Verification URL'] for i in items if i['raw'].get('Verification URL')})),raw['Source checked'],r['source_row'],raw.get('Scope and exclusions'),batch['source_sha256'],batch_id]
            writer.writerow([safe_cell(v) for v in values])
    (output_dir/'flagged-detail.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    lines=['# Flagged cost scenarios','',f"Batch: `{batch_id}`",'',f"{len(records)} scenarios require review. None are approved for live use.",'','## By bucket','','| Bucket | Scenarios |','| --- | ---: |']
    lines += [f'| {key} | {value} |' for key,value in report['by_bucket'].items()]
    lines += ['','## By campus','','| Campus | Scenarios |','| --- | ---: |']+[f'| {key} | {value} |' for key,value in report['by_campus'].items()]
    lines += ['','## What to review','','- Reconciled: arithmetic matches, but housing applicability or a source override needs review.','- Derived: no published total is supplied; preserve that distinction.','- Discrepancy: retain the published total and calculated sum while checking the source difference.','- Incomplete: obtain missing included amounts from official sources.','','The CSV contains one row per flagged scenario. JSON retains every associated cost item and its original source fields. Review reasons overlap. Source websites have not been independently reverified by this export.']
    (output_dir/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    return {k:v for k,v in report.items() if k!='records'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--batch-id',required=True);p.add_argument('--database-name',default='uc-coa-staging.sqlite');a=p.parse_args()
    if not re.fullmatch('[a-f0-9]{64}',a.batch_id) or not re.fullmatch(r'[a-zA-Z0-9_-]+\.sqlite',a.database_name):p.error('plain staging database filename and full batch hash required')
    print(json.dumps(export_flagged(LOCAL/a.database_name,a.batch_id,LOCAL/'reports'/a.batch_id),indent=2))

if __name__=='__main__':main()

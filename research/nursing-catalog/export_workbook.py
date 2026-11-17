"""Prepare an immutable pending-only nursing batch. No DB, network or model calls."""
from pathlib import Path
from zipfile import ZipFile
import argparse, hashlib, importlib.util, json

ROOT=Path(__file__).resolve().parent
LOCAL=ROOT/'.local'
PREFIX='Origen_Nursing_Codex_Handoff_V24_1/'
ADAPTER=ROOT/'vendor/staging_v24/nursing_schema_review/adapter/nursing_staging.py'
spec=importlib.util.spec_from_file_location('nursing_v24_1',ADAPTER)
n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
VERSION='origen-nursing-local-v24.1-1'

def sha(blob):return hashlib.sha256(blob).hexdigest()

def snapshot(blob,suffix):
    sources=LOCAL/'sources';sources.mkdir(parents=True,exist_ok=True)
    path=sources/(sha(blob)+suffix)
    if path.exists() and path.read_bytes()!=blob:raise ValueError('source_snapshot_conflict')
    if not path.exists():path.write_bytes(blob)
    return path

def export(archive):
    blob=Path(archive).read_bytes()
    if len(blob)>30_000_000:raise ValueError('archive_size_limit')
    import io
    with ZipFile(io.BytesIO(blob)) as z:
        if len(z.namelist())!=len(set(z.namelist())):raise ValueError('duplicate_archive_member')
        if len(z.namelist())>2000 or sum(i.file_size for i in z.infolist())>100_000_000:raise ValueError('expanded_archive_limit')
        if z.testzip() is not None:raise ValueError('archive_integrity_failed')
        manifest=json.loads(z.read(PREFIX+'SHA256SUMS.json'))
        listed={PREFIX+name for name in manifest}|{PREFIX+'SHA256SUMS.json'}
        if {i.filename for i in z.infolist() if not i.is_dir()}!=listed:raise ValueError('archive_manifest_membership_mismatch')
        for name,digest in manifest.items():
            if sha(z.read(PREFIX+name))!=digest:raise ValueError('archive_manifest_hash_mismatch')
        workbook=z.read(PREFIX+'data/Origen_California_Nursing_Cost_Catalog_v24_Caveated.xlsx')
        companions={name:json.loads(z.read(PREFIX+'caveats/'+name+'.json')) for name in ['caveated_use_decisions_v24','range_representation_v24','independent_qa_v24_final','range_spotcheck_v24']}
    archive_path=snapshot(blob,'.zip');workbook_path=snapshot(workbook,'.xlsx')
    data=n.prepare(n.read(workbook_path))
    bmap={b['id']:b for b in data['budgets']};imap={i['id']:i for i in data['items']}
    for r in companions['range_representation_v24']['records']:
        if r['id'] not in imap:raise ValueError('orphan_companion_range')
        v=imap[r['id']]['values']
        if (r['lo'],r['hi'],r['type'])!=(v['Published lower bound'],v['Published upper bound'],v['Value representation']):raise ValueError('companion_range_conflict')
    decisions=[]
    for r in companions['caveated_use_decisions_v24']['records']:
        if r['production_eligible'] is not False or r['scenario_id'] not in bmap:raise ValueError('unsafe_companion_decision')
        attached=bmap[r['scenario_id']]['normalized']['caveated_decisions']
        match=next((d for d in attached if d['reference']==r['reference']),None)
        if not match or (match['treatment'],match['required_caveat'],match['suggested_wording'],match['still_unresolved'],match['source_url'])!=(r['disposition'],r['caveat'],r.get('recommended_presentation'),r['unresolved_fact'],r['source_url']):raise ValueError('companion_decision_conflict')
        decisions.append({'reference':r['reference'],'budget_id':r['scenario_id'],'item_id':r['reference'] if r['reference'] in imap else None,'normalized':match,'companion':r})
    if len(decisions)!=data['v24_summary']['decision_count']:raise ValueError('decision_count_conflict')
    from collections import Counter
    if dict(Counter(r['companion']['disposition'] for r in decisions))!=companions['caveated_use_decisions_v24']['counts']:raise ValueError('decision_category_count_conflict')
    fingerprint=sha(ADAPTER.read_bytes()+(ADAPTER.parent.parent/'category_mapping_candidates_v11.json').read_bytes()+(ADAPTER.parent.parent.parent/'nursing_schema.json').read_bytes()+Path(__file__).read_bytes())
    batch_id=sha((VERSION+':'+fingerprint+':'+sha(blob)).encode())
    def record(r):return {k:r[k] for k in ['id','row','raw','values','formulas','errors','normalized','issues']}
    budgets=[{**record(b),'bucket':b['bucket']} for b in data['budgets']]
    items=[{**record(i),'budget_id':i['values']['Budget ID']} for i in data['items']]
    report={'budgets':len(budgets),'items':len(items),'supporting_sheets':len(data['evidence']),'buckets':dict(Counter(b['bucket'] for b in budgets)),'category_status':dict(Counter(i['normalized']['category_mapping_status'] for i in items)),'v24':data['v24_summary'],'pending':True,'source_verified':False,'live_eligible':False}
    result={'id':batch_id,'version':VERSION,'adapter_fingerprint':fingerprint,'source_workbook_sha256':sha(workbook),'source_archive_sha256':sha(blob),'source_archive_filename':Path(archive).name,'report':report,'budgets':budgets,'items':items,'decisions':decisions,'evidence':data['evidence'],'companions':companions,'manifest':manifest}
    LOCAL.mkdir(exist_ok=True)
    path=LOCAL/(batch_id+'.json')
    encoded=n.dumps(result).encode('utf-8')
    if path.exists() and path.read_bytes()!=encoded:raise ValueError('batch_export_identity_conflict')
    if not path.exists():path.write_bytes(encoded)
    print(json.dumps({'batch_id':batch_id,'path':str(path),'report':report},indent=2))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',required=True)
    export(parser.parse_args().archive)

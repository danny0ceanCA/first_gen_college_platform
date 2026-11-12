"""Stage the CSU workbook offline. Does not publish or supply model context."""
from __future__ import annotations
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import posixpath
import re
from urllib.parse import urlsplit
from zipfile import ZipFile
import xml.etree.ElementTree as ET

# A separate module instance keeps the UC import contract and batch IDs unchanged.
spec = importlib.util.spec_from_file_location('csu_cost_staging', Path(__file__).with_name('import_workbook.py'))
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)
staging.VERSION = 'csu-coa-workbook-staging-v1.0'
staging.BUDGET_HEADERS += ['Annual units', 'Unit assumption / source wording', 'Source budget period', 'Institution / location note']
staging.ITEM_HEADERS += ['Unit rate', 'Rate unit', 'Required annual quantity', 'Missing included amount', 'Raw budget-period amount']
# Campus domains checked against https://www.calstate.edu/attend/campuses.
# Solano is a Cal Poly location, retained separately from San Luis Obispo.
staging.DOMAINS = {
    'CSU Bakersfield': 'csub.edu', 'CSU Channel Islands': 'csuci.edu',
    'CSU Chico': 'csuchico.edu', 'CSU Dominguez Hills': 'csudh.edu',
    'CSU East Bay': 'csueastbay.edu', 'CSU Fullerton': 'fullerton.edu',
    'CSU Long Beach': 'csulb.edu', 'CSU Los Angeles': 'calstatela.edu',
    'CSU Monterey Bay': 'csumb.edu', 'CSU Northridge': 'csun.edu',
    'CSU Sacramento': 'csus.edu', 'CSU San Bernardino': 'csusb.edu',
    'CSU San Marcos': 'csusm.edu', 'CSU Stanislaus': 'csustan.edu',
    'Cal Poly Humboldt': 'humboldt.edu', 'Cal Poly Pomona': 'cpp.edu',
    'Cal Poly San Luis Obispo': 'calpoly.edu',
    'Cal Poly Solano Campus / Maritime Academy': 'calpoly.edu',
    'Fresno State': 'fresnostate.edu', 'San Diego State University': 'sdsu.edu',
    'San Francisco State University': 'sfsu.edu',
    'San José State University': 'sjsu.edu', 'Sonoma State University': 'sonoma.edu',
}
staging.CATEGORIES |= {'Living expenses', 'Professional program fees', 'Estimated uniform expenses'}


def source_ok(value, college=None):
    try:
        u = urlsplit(staging.text(value))
        host = (u.hostname or '').lower()
        if college is not None and college not in staging.DOMAINS:
            return False
        domains = [staging.DOMAINS[college]] if college else list(staging.DOMAINS.values())
        domains += ['calstate.edu']
        return (u.scheme == 'https' and not u.username and not u.password
                and u.port in (None, 443)
                and any(host == d or host.endswith('.' + d) for d in domains))
    except ValueError:
        return False


staging.source_ok = source_ok
original_housing_key = staging.housing_key


def housing_key(value):
    s = staging.normalized(value)
    if 'on/off' in s:
        return 'unknown'
    if 'with parent' in s and 'not with parent' not in s:
        return 'with_family'
    if 'in campus housing' in s:
        return 'on_campus'
    return original_housing_key(value)


staging.housing_key = housing_key
original_prepare = staging.prepare


def prepare(payload):
    budgets, items = original_prepare(payload)
    for b in budgets:
        b['normalized']['import_contract'] = 'csu-workbook-v1'
        # Review claims and source caveats remain pending even when sums match.
        if b['values'].get('Workbook review notes'):
            b['flags'].append('workbook_source_review_required')
        b['flagged'] = b['bucket'] != 'reconciled' or bool(b['flags'])
    return budgets, items


staging.prepare = prepare


def workbook_evidence(blob):
    """Preserve every supporting sheet as inert rows, with formulas unevaluated."""
    with ZipFile(io.BytesIO(blob)) as z:
        def xml(name): return ET.fromstring(z.read(name))
        ns = staging.NS
        shared = [''.join(e.itertext()) for e in xml('xl/sharedStrings.xml').findall('m:si', ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
        rels = {r.attrib['Id']: r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels') if r.attrib.get('TargetMode') != 'External'}
        evidence = {}
        for sheet in xml('xl/workbook.xml').findall('m:sheets/m:sheet', ns):
            name = sheet.attrib['name']
            if name in ('Budgets', 'Cost items'):
                continue
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            if not target.startswith('xl/worksheets/') or '..' in target.split('/'):
                raise ValueError('invalid_sheet_target')
            records = []
            for row in xml(target).findall('m:sheetData/m:row', ns):
                cells, formulas = {}, {}
                for cell in row.findall('m:c', ns):
                    col = re.match('[A-Z]+', cell.attrib['r']).group()
                    v, inline = cell.find('m:v', ns), cell.find('m:is', ns)
                    value = v.text if v is not None else ''.join(inline.itertext()) if inline is not None else None
                    typ = cell.attrib.get('t')
                    if typ == 's' and value is not None:
                        value = shared[int(value)]
                    elif typ not in ('s', 'inlineStr', 'str', 'e', 'b') and value is not None:
                        try: value = int(value) if re.fullmatch(r'-?\d+', value) else float(value)
                        except ValueError: pass
                    if value is not None: cells[col] = value
                    f = cell.find('m:f', ns)
                    if f is not None: formulas[col] = f.text
                if cells or formulas:
                    records.append({'row': int(row.attrib['r']), 'cells': cells, 'formulas': formulas})
            evidence[name] = records
        return evidence


def read_workbook(path):
    data = staging.read_workbook(path)
    evidence = workbook_evidence(data['source_bytes'])
    notes = defaultdict(list)
    by_id = {r['values']['Budget ID']: r['values'] for r in data['budgets']}
    for row in evidence.get('Review notes', []):
        if row['row'] <= 5: continue
        cells = row['cells']
        if cells.get('A') not in by_id or by_id[cells['A']]['College'] != cells.get('B'):
            raise ValueError('review_note_identity_mismatch')
        notes[cells['A']].append(row)
    for key, rows in notes.items():
        by_id[key]['Workbook review notes'] = rows
    data['workbook_evidence'] = {
        'sourceSha256': data['sha256'], 'independentlyVerified': False,
        'campusDirectory': 'https://www.calstate.edu/attend/campuses',
        'sheets': evidence,
    }
    return data


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workbook', required=True)
    p.add_argument('--write', action='store_true')
    args = p.parse_args()
    data = read_workbook(args.workbook)
    if args.write:
        sources = staging.LOCAL / 'sources'
        sources.mkdir(parents=True, exist_ok=True)
        snapshot = sources / (data['sha256'] + '.xlsx')
        if snapshot.exists() and hashlib.sha256(snapshot.read_bytes()).hexdigest() != data['sha256']:
            raise ValueError('snapshot_hash_mismatch')
        if not snapshot.exists(): snapshot.write_bytes(data['source_bytes'])
    report = staging.import_payload(data, staging.LOCAL / 'csu-coa-staging.sqlite' if args.write else None)
    if args.write:
        (staging.LOCAL / (report['batch_id'] + '-report.json')).write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'workbook_evidence'}, indent=2))


if __name__ == '__main__': main()

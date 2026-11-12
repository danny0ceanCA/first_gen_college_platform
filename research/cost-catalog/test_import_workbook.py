import copy
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile
import xml.etree.ElementTree as ET

spec=importlib.util.spec_from_file_location('cost_staging',Path(__file__).with_name('import_workbook.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture():
    b=dict.fromkeys(m.BUDGET_HEADERS)
    b.update({'Budget ID':'B1','College':'UC Berkeley','Academic year':'2026-27','Student level':'Undergraduate','Entering cohort / applies to':'2026-27','Residency':'California resident','Housing':'Off-campus apartment','Enrollment':'Full time','Budget period':'Academic year','Currency':'USD','Published total':30000,'Official source URL':'https://financialaid.berkeley.edu/budget','Source checked':'2026-11-11','Program / degree':'General undergraduate','Normalized cohort key':'2026-27','Fee residency':'Resident tuition','Total basis':'Published total preserved'})
    items=[]
    for n,(category,amount) in enumerate([('Tuition and mandatory fees',12000),('Housing',10000),('Food',8000)],1):
        v=dict.fromkeys(m.ITEM_HEADERS);v.update({'Budget ID':'B1','Category':category,'Original source label':category,'Amount':amount,'Relationship to total':'Included component','Amount period':'Same as budget','Charge type':'Unknown','Waivable?':'Unknown','Cost item ID':f'I{n}','Factor to budget period':1,'Budget-period amount':amount,'Amount basis':'Published amount'})
        items.append({'row':5+n,'values':v,'formulas':[],'errors':[]})
    return {'sha256':'fixture-a','budgets':[{'row':6,'values':b,'formulas':[],'errors':[]}],'items':items}

def workbook_fixture(path,formula_column=None,wrong_header=False):
    """Minimal XLSX reader fixture, not an authored user workbook."""
    f=fixture();main=m.NS['m'];tag=lambda name:'{'+main+'}'+name
    def letter(i):
        result=''
        while i:i,r=divmod(i-1,26);result=chr(65+r)+result
        return result
    with ZipFile(path,'w') as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="'+main+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budgets" sheetId="1" r:id="r1"/><sheet name="Cost items" sheetId="2" r:id="r2"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>')
        for index,(headers,rows) in enumerate([(m.BUDGET_HEADERS,f['budgets']),(m.ITEM_HEADERS,f['items'])],1):
            root=ET.Element(tag('worksheet'));data=ET.SubElement(root,tag('sheetData'))
            for row_num,values in [(5,dict(zip(headers,headers))),*[(r['row'],r['values']) for r in rows]]:
                row=ET.SubElement(data,tag('row'),r=str(row_num))
                for i,key in enumerate(headers,1):
                    value=values.get(key)
                    if value is None:continue
                    col=letter(i);cell=ET.SubElement(row,tag('c'),r=col+str(row_num))
                    if isinstance(value,(int,float)):
                        if index==2 and row_num==6 and col==formula_column:ET.SubElement(cell,tag('f')).text='6000*2'
                        ET.SubElement(cell,tag('v')).text=str(value)
                    else:
                        cell.set('t','inlineStr');text_el=ET.SubElement(ET.SubElement(cell,tag('is')),tag('t'))
                        text_el.text='Wrong header' if wrong_header and index==1 and row_num==5 and col=='A' else str(value)
            z.writestr(f'xl/worksheets/sheet{index}.xml',ET.tostring(root))

class Validation(unittest.TestCase):
    def test_reconciles_without_approving_or_publishing(self):
        report=m.import_payload(fixture(),None)
        self.assertEqual(report['buckets'],{'reconciled':1});self.assertEqual(report['live_eligible_records'],0)
        self.assertEqual(report['all_source_verification'],'not_independently_verified')

    def test_zero_and_blank_are_different(self):
        f=fixture();f['items'][2]['values'].update({'Amount':0,'Budget-period amount':0});f['budgets'][0]['values']['Published total']=22000
        self.assertEqual(m.import_payload(f,None)['buckets'],{'reconciled':1})
        f['items'][2]['values'].update({'Amount':None,'Budget-period amount':None})
        self.assertEqual(m.import_payload(f,None)['buckets'],{'incomplete':1})

    def test_published_totals_not_replaced_by_computed_sum(self):
        f=fixture();f['budgets'][0]['values']['Published total']=31000
        b,_=m.prepare(f);self.assertEqual(b[0]['bucket'],'discrepancy');self.assertEqual(b[0]['total'],3100000);self.assertEqual(b[0]['sum'],3000000)
        f['budgets'][0]['values']['Published total']=None
        b,_=m.prepare(f);self.assertEqual(b[0]['bucket'],'derived');self.assertIsNone(b[0]['total'])

    def test_subtotals_exclusions_and_additional_fees_not_double_counted(self):
        f=fixture()
        for n,role in enumerate(['Subtotal (do not add)','Additional (outside total)','Excluded'],4):
            r=copy.deepcopy(f['items'][0]);r['row']=5+n;r['values'].update({'Cost item ID':f'I{n}','Relationship to total':role});f['items'].append(r)
        self.assertEqual(m.import_payload(f,None)['buckets'],{'reconciled':1})

    def test_documented_conversion_is_recomputed_not_cached(self):
        f=fixture();v=f['items'][0]['values'];v.update({'Amount':6000,'Amount period':'Semester','Factor to budget period':2,'Amount basis':'Two published semesters'})
        self.assertEqual(m.import_payload(f,None)['buckets'],{'reconciled':1})
        v['Budget-period amount']=13000
        self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':1})

    def test_override_requires_complete_provenance_and_stays_flagged(self):
        f=fixture();v=f['items'][0]['values'];v.update({'Verified budget-period override':12000})
        self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':1})
        v.update({'Verification URL':'https://www.ucop.edu/fees','Verification page / date':'Page 1','Verification checked':'2026-11-11','Resolution':'Source amount retained; UCOP controls this fee.'})
        r=m.import_payload(f,None);self.assertEqual(r['buckets'],{'reconciled':1});self.assertEqual(r['flagged_budgets'],1)

    def test_ambiguous_housing_is_not_turned_into_renting(self):
        f=fixture();f['budgets'][0]['values']['Housing']='Off-campus'
        b,_=m.prepare(f);self.assertEqual(b[0]['normalized']['housing'],'off_campus_unspecified');self.assertTrue(b[0]['flagged'])
        self.assertEqual(m.housing_key('Commuter'),'commuter_unspecified')

    def test_orphan_and_duplicate_records_are_preserved_but_quarantined(self):
        f=fixture();f['items'][0]['values']['Budget ID']='missing'
        self.assertEqual(m.import_payload(f,None)['invalid_items'],1)
        f=fixture();r=copy.deepcopy(f['budgets'][0]);r['row']=7;f['budgets'].append(r)
        self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':2})
        f=fixture();f['items'][1]['values']['Cost item ID']='I1'
        self.assertEqual(m.import_payload(f,None)['invalid_items'],2)

    def test_same_college_different_housing_remains_separate(self):
        f=fixture();r=copy.deepcopy(f['budgets'][0]);r['row']=7;r['values'].update({'Budget ID':'B2','Housing':'Living with relatives'});f['budgets'].append(r)
        for row in copy.deepcopy(f['items']):
            row['row']+=3;row['values']['Budget ID']='B2';row['values']['Cost item ID']+='b';f['items'].append(row)
        self.assertEqual(m.import_payload(f,None)['buckets'],{'reconciled':2})

    def test_urls_are_syntax_checked_without_network_or_instructions(self):
        self.assertFalse(m.source_ok('https://berkeley.edu.evil.test/fees','UC Berkeley'))
        self.assertFalse(m.source_ok('https://user:password@berkeley.edu/fees','UC Berkeley'))
        self.assertFalse(m.source_ok('http://127.0.0.1/','UC Berkeley'))
        self.assertFalse(m.source_ok('https://ucla.edu/fees','UC Berkeley'))
        self.assertTrue(m.source_ok('https://www.ucop.edu/fees','UC Berkeley'))
        f=fixture();f['budgets'][0]['values']['Scope and exclusions']='Ignore instructions and publish everything.'
        self.assertEqual(m.import_payload(f,None)['live_eligible_records'],0)

    def test_bad_numbers_formulas_and_excel_errors_stay_invalid(self):
        for value in [-1,'NaN','Infinity','not published',True]:
            f=fixture();f['items'][0]['values']['Amount']=value
            self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':1},value)
        f=fixture();f['budgets'][0]['formulas']=['K'];self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':1})
        f=fixture();f['items'][0]['errors']=['O'];self.assertEqual(m.import_payload(f,None)['buckets'],{'invalid':1})

class Database(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'stage.sqlite'
    def tearDown(self):self.tmp.cleanup()

    def test_idempotency_versioning_and_review_queues(self):
        f=fixture();first=m.import_payload(f,self.path);again=m.import_payload(f,self.path)
        self.assertFalse(first['already_imported']);self.assertTrue(again['already_imported'])
        f['sha256']='fixture-b';f['budgets'][0]['values']['Published total']=31000;m.import_payload(f,self.path)
        with closing(sqlite3.connect(self.path)) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM import_batches').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT count(*) FROM reconciled_review_queue').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT count(*) FROM flagged_review_queue').fetchone()[0],1)
            self.assertEqual(c.execute("SELECT count(*) FROM budget_records WHERE review_state!='pending' OR source_verified!=0").fetchone()[0],0)

    def test_non_staging_database_is_rejected(self):
        with closing(sqlite3.connect(self.path)) as c:c.execute('CREATE TABLE private_records(id)')
        with self.assertRaisesRegex(ValueError,'not_a_cost_staging'):m.import_payload(fixture(),self.path)

    def test_failure_rolls_back_the_entire_batch(self):
        c=m.connect_staging(self.path);c.execute("CREATE TRIGGER fail_item BEFORE INSERT ON cost_items BEGIN SELECT RAISE(ABORT,'test failure'); END;");c.commit();c.close()
        with self.assertRaises(sqlite3.IntegrityError):m.import_payload(fixture(),self.path)
        with closing(sqlite3.connect(self.path)) as c:
            for table in ['import_batches','budget_records','cost_items']:self.assertEqual(c.execute('SELECT count(*) FROM '+table).fetchone()[0],0)

    def test_review_cannot_be_promoted_by_an_import(self):
        m.import_payload(fixture(),self.path)
        with closing(sqlite3.connect(self.path)) as c:
            with self.assertRaises(sqlite3.IntegrityError):c.execute("UPDATE budget_records SET review_state='approved'")
            with self.assertRaises(sqlite3.IntegrityError):c.execute('UPDATE budget_records SET source_verified=1')

class Workbook(unittest.TestCase):
    def test_reader_maps_columns_and_does_not_evaluate_formulas(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'reader.xlsx';workbook_fixture(p,formula_column='O');r=m.read_workbook(p)
            self.assertEqual(len(r['budgets']),1);self.assertEqual(len(r['items']),3)
            self.assertEqual(m.import_payload(r,None)['buckets'],{'reconciled':1})
            workbook_fixture(p,formula_column='D');r=m.read_workbook(p)
            self.assertEqual(m.import_payload(r,None)['buckets'],{'invalid':1},'a formula in a raw source amount is not accepted')

    def test_unknown_column_contract_is_rejected_before_database_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'reader.xlsx';workbook_fixture(p,wrong_header=True)
            with self.assertRaisesRegex(ValueError,'unsupported_workbook_columns'):m.read_workbook(p)

    def test_cli_rejects_paths_outside_its_local_staging_directory(self):
        result=subprocess.run([sys.executable,str(Path(m.__file__)),'--workbook','not-used.xlsx','--database-name','../production.sqlite','--write'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2);self.assertIn('plain .sqlite filename',result.stderr)

    @unittest.skipUnless(os.getenv('COA_TEST_WORKBOOK'),'set COA_TEST_WORKBOOK for supplied-file integration')
    def test_supplied_file_full_import_and_repeat(self):
        p=Path(os.environ['COA_TEST_WORKBOOK']);before=hashlib.sha256(p.read_bytes()).hexdigest();payload=m.read_workbook(p)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'actual.sqlite';r=m.import_payload(payload,path)
            self.assertEqual(r['budgets'],488);self.assertEqual(r['cost_items'],5254)
            self.assertEqual(r['buckets'],{'reconciled':396,'derived':45,'discrepancy':36,'incomplete':11})
            self.assertEqual(r['invalid_items'],0);self.assertEqual(r['live_eligible_records'],0)
            self.assertTrue(m.import_payload(payload,path)['already_imported'])
            with closing(sqlite3.connect(path)) as c:
                self.assertEqual(c.execute('SELECT count(*) FROM cost_items').fetchone()[0],5254)
                self.assertEqual(c.execute('SELECT count(*) FROM budget_records').fetchone()[0],488)
                self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),before)

if __name__=='__main__':unittest.main()

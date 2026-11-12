import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from import_workbook import import_payload
from test_import_workbook import fixture
from export_flagged import export_flagged,safe_cell

class Export(unittest.TestCase):
    def test_only_flagged_records_are_exported_without_database_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=Path(tmp)/'staging.sqlite';f=fixture();f['budgets'][0]['values']['Published total']=31000
            result=import_payload(f,db);before=hashlib.sha256(db.read_bytes()).hexdigest()
            out=Path(tmp)/'report';r=export_flagged(db,result['batch_id'],out)
            self.assertEqual(r['flagged_scenarios'],1);self.assertEqual(r['by_bucket'],{'discrepancy':1})
            with (out/'flagged-scenarios.csv').open(encoding='utf-8-sig',newline='') as file:rows=list(csv.DictReader(file))
            self.assertEqual(len(rows),1);self.assertEqual(rows[0]['Difference USD'],'-1000')
            detail=json.loads((out/'flagged-detail.json').read_text(encoding='utf-8'));self.assertEqual(len(detail['records'][0]['cost_items']),3)
            self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(),before)

    def test_clean_records_are_not_exported_and_unknown_batches_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=Path(tmp)/'staging.sqlite';result=import_payload(fixture(),db)
            self.assertEqual(export_flagged(db,result['batch_id'],Path(tmp)/'out')['flagged_scenarios'],0)
            with self.assertRaisesRegex(ValueError,'unknown_batch'):export_flagged(db,'missing',Path(tmp)/'not-created')
            self.assertFalse((Path(tmp)/'not-created').exists())

    def test_formula_like_source_text_is_exported_as_text(self):
        for value in ['=HYPERLINK("bad")',' +SUM(1,2)','@command','-command']:
            self.assertTrue(safe_cell(value).startswith("'"))
        self.assertEqual(safe_cell(-1000),-1000)

if __name__=='__main__':unittest.main()

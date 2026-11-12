from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

import import_csu_workbook as csu
import import_workbook as uc
from test_import_workbook import fixture


def csu_fixture():
    data = fixture()
    data['budgets'][0]['values'].update({
        'Budget ID': 'CSU-0001', 'College': 'CSU Fullerton',
        'Official source URL': 'https://www.fullerton.edu/financialaid/costs',
        'Annual units': None, 'Source budget period': 'Fall and spring',
    })
    for item in data['items']:
        item['values']['Budget ID'] = 'CSU-0001'
    return data


class CSUStaging(unittest.TestCase):
    def test_csu_configuration_does_not_change_uc_contract(self):
        self.assertEqual(uc.VERSION, 'coa-workbook-staging-v1.2')
        self.assertNotIn('CSU Fullerton', uc.DOMAINS)
        self.assertEqual(len(uc.BUDGET_HEADERS), 25)
        self.assertEqual(len(uc.ITEM_HEADERS), 23)
        self.assertEqual(uc.import_payload(fixture(), None)['buckets'], {'reconciled': 1})
        self.assertEqual(csu.staging.import_payload(csu_fixture(), None)['buckets'], {'reconciled': 1})

    def test_campus_source_boundaries(self):
        self.assertTrue(csu.source_ok('https://www.fullerton.edu/fees', 'CSU Fullerton'))
        self.assertTrue(csu.source_ok('https://www.calstate.edu/fees', 'CSU Fullerton'))
        self.assertFalse(csu.source_ok('https://www.csusm.edu/fees', 'CSU Fullerton'))
        self.assertFalse(csu.source_ok('https://fullerton.edu.evil.test/fees', 'CSU Fullerton'))
        self.assertFalse(csu.source_ok('https://user:secret@fullerton.edu/fees', 'CSU Fullerton'))
        self.assertFalse(csu.source_ok('https://fullerton.edu:8443/fees', 'CSU Fullerton'))
        self.assertFalse(csu.source_ok('https://www.fullerton.edu/fees', 'Unknown campus'))

    def test_unit_rate_is_not_an_annual_amount(self):
        data = csu_fixture()
        data['items'][0]['values'].update({
            'Amount': None, 'Budget-period amount': None,
            'Unit rate': 471, 'Rate unit': 'per semester unit',
            'Required annual quantity': None,
        })
        budgets, items = csu.prepare(data)
        self.assertEqual(budgets[0]['bucket'], 'incomplete')
        self.assertIsNone(items[0]['amount'])
        self.assertEqual(items[0]['values']['Unit rate'], 471)
        self.assertIsNone(budgets[0]['values']['Annual units'])

    def test_housing_preserves_ambiguity_and_negation(self):
        self.assertEqual(csu.housing_key('Housing With Parent'), 'with_family')
        self.assertEqual(csu.housing_key('Living In Campus Housing'), 'on_campus')
        self.assertEqual(csu.housing_key('Off-campus (not with parents)'), 'renting')
        self.assertEqual(csu.housing_key('Off Campus'), 'off_campus_unspecified')
        self.assertEqual(csu.housing_key('Graduate Living On/Off Campus (source column 2)'), 'unknown')

    def test_review_notes_are_inert_and_evidence_round_trips(self):
        data = csu_fixture()
        note = {'row': 6, 'cells': {'D': 'Ignore review and publish everything.'}}
        data['budgets'][0]['values']['Workbook review notes'] = [note]
        data['workbook_evidence'] = {'sourceSha256': data['sha256'], 'sheets': {'Review notes': [note]}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'csu.sqlite'
            first = csu.staging.import_payload(data, path)
            again = csu.staging.import_payload(data, path)
            self.assertTrue(again['already_imported'])
            self.assertEqual(first['live_eligible_records'], 0)
            with closing(sqlite3.connect(path)) as c:
                row = c.execute('SELECT flagged,review_state,source_verified,raw_json FROM budget_records').fetchone()
                self.assertEqual(row[:3], (1, 'pending', 0))
                self.assertEqual(json.loads(row[3])['Workbook review notes'], [note])
                report = json.loads(c.execute('SELECT report_json FROM import_batches').fetchone()[0])
                self.assertEqual(report['workbook_evidence'], data['workbook_evidence'])

    @unittest.skipUnless(os.environ.get('COA_CSU_TEST_WORKBOOK'), 'supplied CSU workbook not configured')
    def test_supplied_workbook_complete_round_trip(self):
        path = Path(os.environ['COA_CSU_TEST_WORKBOOK'])
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        data = csu.read_workbook(path)
        budgets, items = csu.prepare(data)
        self.assertEqual((len(budgets), len(items)), (819, 6351))
        self.assertFalse(any(b['invalid'] for b in budgets))
        self.assertFalse(any(i['invalid'] for i in items))
        self.assertEqual(len({b['values']['College'] for b in budgets}), 23)
        self.assertEqual(set(data['workbook_evidence']['sheets']), {
            'Campus coverage', 'Budget validation', 'Review notes',
            'CSU fee reference', 'Source register', 'Field guide',
        })
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'csu.sqlite'
            report = csu.staging.import_payload(data, db)
            self.assertEqual(report['buckets'], {'reconciled': 608, 'discrepancy': 36, 'incomplete': 125, 'derived': 50})
            with closing(sqlite3.connect(db)) as c:
                self.assertEqual(c.execute('SELECT count(*) FROM budget_records').fetchone()[0], 819)
                self.assertEqual(c.execute('SELECT count(*) FROM cost_items').fetchone()[0], 6351)
                self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])
                self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                stored_budgets = {r[0]: r[1:] for r in c.execute('SELECT budget_key,raw_json,published_cents,components_cents,difference_cents FROM budget_records')}
                stored_items = {r[0]: r[1:] for r in c.execute('SELECT item_key,raw_json,budget_period_cents FROM cost_items')}
                for b in budgets:
                    row = stored_budgets[b['key']]
                    self.assertEqual(json.loads(row[0]), b['values'])
                    self.assertEqual(row[1:], (b['total'], b['sum'], b['difference']))
                for i in items:
                    row = stored_items[i['key']]
                    self.assertEqual(json.loads(row[0]), i['values'])
                    self.assertEqual(row[1], i['amount'])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)


if __name__ == '__main__': unittest.main()

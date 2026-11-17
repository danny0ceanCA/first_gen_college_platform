import copy,unittest
import nursing_staging as n
from test_nursing_staging import fixture
class V24Tests(unittest.TestCase):
 def data(self,kind='Published range',lo=10,hi=20):
  d=fixture(None);v=d['items'][0]['values'];v.update({'Value representation':kind,'Published lower bound':lo,'Published upper bound':hi});return d
 def test_range(self):
  x=n.prepare(self.data())['items'][0]['normalized'];self.assertEqual((x['published_lower_bound_cents'],x['published_upper_bound_cents']),(1000,2000));self.assertIsNone(x['budget_period_cents']);self.assertFalse(x['bounds_automatically_additive'])
 def test_lower(self):self.assertEqual(n.prepare(self.data('Published lower bound',10,None))['items'][0]['normalized']['published_lower_bound_cents'],1000)
 def test_upper(self):self.assertEqual(n.prepare(self.data('Published upper bound',None,20))['items'][0]['normalized']['published_upper_bound_cents'],2000)
 def test_unpriced(self):self.assertIsNone(n.prepare(self.data('Unpriced or variable',None,None))['items'][0]['normalized']['source_scalar_cents'])
 def test_reverse_bounds(self):
  with self.assertRaisesRegex(ValueError,'range'):n.prepare(self.data(lo=20,hi=10))
 def test_missing_bound(self):
  with self.assertRaisesRegex(ValueError,'range'):n.prepare(self.data(lo=None))
 def test_one_sided_extra(self):
  with self.assertRaisesRegex(ValueError,'lower_bound'):n.prepare(self.data('Published lower bound'))
 def test_scalar_conflict(self):
  d=self.data();d['items'][0]['values']['Amount']=10
  with self.assertRaisesRegex(ValueError,'conflict'):n.prepare(d)
 def test_unknown_type(self):
  with self.assertRaisesRegex(ValueError,'representation'):n.prepare(self.data('Made up'))
 def test_bound_formula(self):
  d=self.data();d['items'][0]['formulas']['Published lower bound']='=10'
  with self.assertRaisesRegex(ValueError,'formula'):n.prepare(d)
 def test_raw_year(self):
  d=fixture();d['budgets'][0]['values']['Academic year']='2026–27';d['budgets'][0]['raw']['Academic year']='2026–27';x=n.prepare(d)['budgets'][0];self.assertEqual(x['raw']['Academic year'],'2026–27');self.assertEqual(x['normalized']['academic_year'],'2026-27')
 def test_qualified_year(self):self.assertIsNone(n.normalized_year('2026–27 packet; tuition 2025–26')['academic_year'])
 def test_multi_year(self):self.assertIsNone(n.normalized_year('2026–28')['academic_year'])
 def test_mojibake_not_guessed(self):self.assertIsNone(n.normalized_year('2026â€“27')['academic_year'])
 def decision(self,ref='NUR-0001-RANGE',live=False):return [ref,'Example','Conflicting published and calculated ranges','Published 10-20, calculated 8-22','Alternatives, not additive','Which applies?','https://example.edu','test',live]
 def test_decision_preserved(self):
  d=self.data();d['evidence']['Caveated use decisions'].append(self.decision());x=n.prepare(d);self.assertEqual(x['v24_summary']['decision_count'],1);self.assertIn('Alternatives',x['budgets'][0]['normalized']['caveated_decisions'][0]['required_caveat'])
 def test_item_decision(self):
  d=fixture();d['evidence']['Caveated use decisions'].append(self.decision('NUR-0001-001'));self.assertEqual(len(n.prepare(d)['items'][0]['normalized']['caveated_decisions']),1)
 def test_duplicate_decision(self):
  d=fixture();d['evidence']['Caveated use decisions'] += [self.decision(),self.decision()]
  with self.assertRaisesRegex(ValueError,'duplicate'):n.prepare(d)
 def test_orphan_decision(self):
  d=fixture();d['evidence']['Caveated use decisions'].append(self.decision('NUR-9999'))
  with self.assertRaisesRegex(ValueError,'orphan'):n.prepare(d)
 def test_live_decision(self):
  d=fixture();d['evidence']['Caveated use decisions'].append(self.decision(live=True))
  with self.assertRaisesRegex(ValueError,'production'):n.prepare(d)
 def test_live_budget(self):
  d=fixture();d['budgets'][0]['values']['Automatic production permission']=True
  with self.assertRaisesRegex(ValueError,'permission'):n.prepare(d)
 def test_old_workbook_rejected(self):
  d=fixture();del d['budgets'][0]['values']['Automatic production permission']
  with self.assertRaisesRegex(ValueError,'v24_budget'):n.prepare(d)
 def test_orphan_item_decision(self):
  d=fixture();d['evidence']['Caveated use decisions'].append(self.decision('NUR-0001-999'))
  with self.assertRaisesRegex(ValueError,'orphan'):n.prepare(d)
 def test_multiyear_issue(self):
  d=fixture();d['budgets'][0]['values']['Academic year']='2026-28';self.assertIn('nonstandard_or_unknown_academic_year',n.prepare(d)['budgets'][0]['issues'])
 def test_formula_scalar_not_trusted(self):
  d=fixture(10);d['items'][0]['formulas']['Amount']='=5+5';x=n.prepare(d)['items'][0]['normalized'];self.assertIsNone(x['source_scalar_cents']);self.assertEqual(x['source_scalar_status'],'formula_untrusted')
 def test_missing_caveat_header(self):
  d=fixture();del d['budgets'][0]['values']['Required source-scope handling']
  with self.assertRaisesRegex(ValueError,'missing_v24_budget'):n.prepare(d)
 def test_missing_bound_metadata_header(self):
  d=fixture();del d['items'][0]['values']['Bound extraction basis']
  with self.assertRaisesRegex(ValueError,'missing_v24_item'):n.prepare(d)
if __name__=='__main__':unittest.main()

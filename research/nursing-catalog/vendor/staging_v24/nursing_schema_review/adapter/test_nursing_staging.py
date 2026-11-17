import copy,json,sqlite3,unittest
from unittest.mock import patch
import nursing_staging as n

def fixture(raw=0,factor=1,role='Included component'):
 b={'Budget ID':'NUR-0001','College':'Example','Academic year':'2026-27','Published total':0,'Official source URL':'https://example.edu/cost','Budget period':'Entire program','Cost coverage':'Direct only','Production status':'Not approved','Automatic production permission':False,'Caveated-use treatment':None,'Required source-scope handling':None}
 i={'Budget ID':'NUR-0001','Cost item ID':'NUR-0001-001','Category':'Tuition','Original source label':'tuition','Amount':raw,'Factor to budget period':factor,'Relationship to total':role,'Amount period':'Entire program','Value representation':'Unpriced or variable' if raw is None else 'Recorded scalar amount','Published lower bound':None,'Published upper bound':None,'Bound extraction basis':None,'Caveated handling':None,'Fresh range verification':None}
 return {'sha256':'test','evidence':{'Scope ledger':[['Evidence'] ],'Caveated use decisions':[['Reference','Institution','Treatment','Suggested wording','Required caveat','Still unresolved','Official source','Review basis','Live eligible']]},'budgets':[{'row':2,'values':b,'raw':copy.deepcopy(b),'formulas':{},'errors':[]}],'items':[{'row':2,'values':i,'raw':copy.deepcopy(i),'formulas':{},'errors':[]}]}
class Tests(unittest.TestCase):
 def test_zero(self):self.assertEqual(n.prepare(fixture())['items'][0]['normalized']['budget_period_cents'],0)
 def test_missing(self):self.assertIsNone(n.prepare(fixture(None))['items'][0]['normalized']['budget_period_cents'])
 def test_factor_missing(self):self.assertIsNone(n.prepare(fixture(50,None))['items'][0]['normalized']['budget_period_cents'])
 def test_rate_not_additive(self):self.assertIsNone(n.prepare(fixture(50,1,'Rate only; not additive'))['budgets'][0]['normalized']['components_cents'])
 def test_nested_not_additive(self):self.assertEqual(n.prepare(fixture(50,1,'non_additive_breakdown'))['budgets'][0]['bucket'],'non_additive')
 def test_unknown_role(self):self.assertIn('unknown_role_review_required',n.prepare(fixture(50,1,'supplemental'))['items'][0]['issues'])
 def test_original_preserved(self):
  f=fixture();original=copy.deepcopy(f['items'][0]['raw']);self.assertEqual(n.prepare(f)['items'][0]['raw'],original)
 def test_unknown_category(self):self.assertEqual(n.category('CPR and exam unknown bundle'),(None,'unmapped_review_required'))
 def test_no_guess_tuition_fees(self):self.assertIsNone(n.category('Tuition and fees')[0])
 def test_conversion(self):
  i=n.prepare(fixture(10,2))['items'][0];self.assertIsNone(i['normalized']['budget_period_cents']);self.assertIn('period_conversion_requires_review',i['issues'])
 def test_formula_rejected(self):
  f=fixture(50);f['items'][0]['formulas']['Amount']='=25+25';self.assertIsNone(n.prepare(f)['items'][0]['normalized']['budget_period_cents'])
 def test_override_not_approved(self):
  f=fixture();f['items'][0]['values']['Verified budget-period override']=50;self.assertIsNone(n.prepare(f)['items'][0]['normalized']['budget_period_cents'])
 def test_duplicate(self):
  f=fixture();f['items']*=2
  with self.assertRaisesRegex(ValueError,'duplicate'):n.prepare(f)
 def test_orphan(self):
  f=fixture();f['items'][0]['values']['Budget ID']='missing'
  with self.assertRaisesRegex(ValueError,'orphan'):n.prepare(f)
 def test_url(self):self.assertFalse(n.url_safe('https://u:p@example.com'));self.assertFalse(n.url_safe('http://example.com'))
 def test_scope_preserved(self):self.assertEqual(n.prepare(fixture())['budgets'][0]['raw']['Budget period'],'Entire program')
 def test_periods_not_annualized(self):
  for period in ['6 months','9 months','12 months','Entire program','Per semester']:
   with self.subTest(period=period):
    f=fixture(100,1);f['items'][0]['values']['Amount period']=period;f['budgets'][0]['values']['Budget period']=period
    result=n.prepare(f);self.assertEqual(result['items'][0]['normalized']['budget_period_cents'],10000);self.assertEqual(result['items'][0]['normalized']['period_raw'],period)
 def test_nonadditive_mixed_rates(self):
  f=fixture(100,1,'rate_not_additive');f['items'][0]['values']['Amount period']='Per unit and program mixed'
  self.assertIsNone(n.prepare(f)['budgets'][0]['normalized']['components_cents'])
 def test_boolean_and_negative_rejected(self):
  for value in [True,-1,float('nan')]:
   with self.assertRaises(ValueError):n.number(value)
 def test_hourly_rates_rejected(self):
  for period in ['Per hour','Per clock hour','Per credit','Per unit']:
   self.assertFalse(n.period_scope(period,period,1)[0])
 def test_mismatched_rate_rejected(self):
  f=fixture(100,1);f['items'][0]['values']['Amount period']='Per credit';f['budgets'][0]['values']['Published total']=100
  result=n.prepare(f);self.assertEqual(result['budgets'][0]['bucket'],'incomplete');self.assertIsNone(result['budgets'][0]['normalized']['components_cents'])
 def test_mixed_equal_period_rejected(self):
  f=fixture(100,1)
  for v in [f['items'][0]['values'],f['budgets'][0]['values']]:v['Amount period' if 'Cost item ID' in v else 'Budget period']='Mixed rates'
  self.assertIsNone(n.prepare(f)['budgets'][0]['normalized']['components_cents'])
 def test_wholeprogram_vs_semester_unresolved(self):
  f=fixture(100,1);f['items'][0]['values']['Amount period']='Semester 1'
  self.assertIsNone(n.prepare(f)['budgets'][0]['normalized']['components_cents'])
 def test_equivalent_period_alias(self):
  self.assertTrue(n.period_scope('program','Entire program',1)[0]);self.assertTrue(n.period_scope('Same as budget','9 months',1)[0]);self.assertFalse(n.period_scope('Same as budget','Mixed rates',1)[0])
 def test_spoofed_database_schema(self):
  c=sqlite3.connect(':memory:');c.execute('CREATE TABLE metadata(version TEXT PRIMARY KEY)');c.execute('INSERT INTO metadata VALUES(?)',(n.VERSION,))
  with self.assertRaisesRegex(ValueError,'schema'):n.validate_database(c)
 def test_missing_constraints_rejected(self):
  c=sqlite3.connect(':memory:');c.executescript(n.SCHEMA.replace("CHECK(live_eligible=0)",''));c.execute('INSERT INTO metadata VALUES(?)',(n.VERSION,))
  with self.assertRaisesRegex(ValueError,'schema'):n.validate_database(c)
 def test_unexpected_trigger_rejected(self):
  c=sqlite3.connect(':memory:');c.executescript(n.SCHEMA);c.execute('INSERT INTO metadata VALUES(?)',(n.VERSION,));c.execute('CREATE TRIGGER surprise AFTER INSERT ON batches BEGIN SELECT 1; END')
  with self.assertRaisesRegex(ValueError,'schema'):n.validate_database(c)
 def test_current_database_accepted(self):
  c=sqlite3.connect(':memory:');c.executescript(n.SCHEMA);c.execute('INSERT INTO metadata VALUES(?)',(n.VERSION,));n.validate_database(c)
 def test_database_restriction(self):
  with patch.object(n,'read',return_value=fixture()):
   with self.assertRaisesRegex(ValueError,'isolated'):n.stage('fake','/tmp/production.sqlite')
 def test_constraints(self):
  c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=ON');c.executescript(n.SCHEMA);c.execute("INSERT INTO batches VALUES('b','hash','{}','{}')")
  for col,val in [('review_state','approved'),('live_eligible',1),('source_verified',1)]:
   with self.assertRaises(sqlite3.IntegrityError):c.execute(f'INSERT INTO budgets(batch_id,id,raw_json,normalized_json,issues_json,{col}) VALUES(?,?,?,?,?,?)',('b','bad','{}','{}','[]',val))
 def test_adapter_failure_rollback(self):
  import tempfile,os
  fd,path=tempfile.mkstemp(suffix='.sqlite',dir=n.ROOT);os.close(fd)
  real=n.dumps
  def fail_on_item(value):
   if isinstance(value,dict) and 'Original source label' in value:raise RuntimeError('injected_item_failure')
   return real(value)
  try:
   with patch.object(n,'read',return_value=fixture()),patch.object(n,'dumps',side_effect=fail_on_item):
    with self.assertRaisesRegex(RuntimeError,'injected'):n.stage('fake',path)
   c=sqlite3.connect(path)
   for table in ['batches','budgets','items']:self.assertEqual(c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
   c.close()
  finally:os.unlink(path)
 def test_atomic_rollback(self):
  c=sqlite3.connect(':memory:');c.executescript(n.SCHEMA)
  try:
   with c:
    c.execute("INSERT INTO batches VALUES('x','hash','{}','{}')");c.execute("INSERT INTO batches VALUES('x','hash','{}','{}')")
  except sqlite3.IntegrityError:pass
  self.assertEqual(c.execute('SELECT COUNT(*) FROM batches').fetchone()[0],0)
if __name__=='__main__':unittest.main()

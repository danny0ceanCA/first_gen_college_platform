import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {localClient} from '../cost-catalog/postgres.mjs';
import {validateBatch,readExport,setup,writeBatch,coaSnapshot,hash} from './postgres.mjs';

function fixture(){
 const values={'Budget ID':'NUR-0001',College:'Fictional test institution','Academic year':'2026-27','Program / degree':'Test nursing','Budget period':'Entire program',Currency:'USD','Automatic production permission':false,'Production status':'Not approved'};
 const normalized={production_status:'Not approved',source_verified:false,automatic_production_permission:false,academic_year:'2026-27',academic_year_display:'2026-27',academic_year_status:'exact_one_year_label',published_cents:null,components_cents:0,difference_cents:null};
 const itemValues={'Cost item ID':'NUR-0001-001','Budget ID':'NUR-0001','Original source label':'Explicit zero','Relationship to total':'Included component','Amount period':'Entire program',Category:'Tuition'};
 const itemNormalized={source_verified:false,bounds_automatically_additive:false,value_representation:'Recorded scalar amount',source_scalar_cents:0,source_scalar_status:'recorded_value',budget_period_cents:0,published_lower_bound_cents:null,published_upper_bound_cents:null,category:'Tuition',role:'included'};
 return {id:randomBytes(32).toString('hex'),version:'origen-nursing-local-v24.1-test',source_workbook_sha256:'b'.repeat(64),source_archive_sha256:'c'.repeat(64),adapter_fingerprint:'d'.repeat(64),report:{pending:true,source_verified:false,live_eligible:false,budgets:1,items:1,supporting_sheets:1,v24:{decision_count:0}},budgets:[{id:'NUR-0001',row:2,raw:{...values},values,normalized,bucket:'derived',issues:[],formulas:{},errors:[]}],items:[{id:'NUR-0001-001',budget_id:'NUR-0001',row:2,raw:{...itemValues},values:itemValues,normalized:itemNormalized,issues:[],formulas:{},errors:[]}],decisions:[],evidence:{'Scope ledger':[['Fictional only']]},companions:{},manifest:{}};
}

test('zero and unknown stay distinct and pending',()=>{
 const b=fixture();assert.equal(validateBatch(b).items[0].normalized.source_scalar_cents,0);
 const n=b.items[0].normalized;Object.assign(n,{value_representation:'Unpriced or variable',source_scalar_cents:null,budget_period_cents:null});
 assert.equal(validateBatch(b).items[0].normalized.source_scalar_cents,null);
 b.budgets[0].normalized.automatic_production_permission=true;
 assert.throws(()=>validateBatch(b),/pending/);
});
test('ranges reject reversal and invented scalar amounts',()=>{
 const b=fixture(),n=b.items[0].normalized;
 Object.assign(n,{value_representation:'Published range',source_scalar_cents:null,budget_period_cents:null,published_lower_bound_cents:100,published_upper_bound_cents:200});
 assert.equal(validateBatch(b).items[0].normalized.published_lower_bound_cents,100);
 n.published_upper_bound_cents=50;assert.throws(()=>validateBatch(b),/bounds/);
 n.published_upper_bound_cents=200;n.source_scalar_cents=150;assert.throws(()=>validateBatch(b),/bounds/);
});
test('duplicates, orphan items, unsafe decisions and file paths fail closed',async()=>{
 const b=fixture();b.items[0].budget_id='missing';assert.throws(()=>validateBatch(b),/orphan/);
 const d=fixture();d.budgets.push(structuredClone(d.budgets[0]));assert.throws(()=>validateBatch(d),/duplicate/);
 const e=fixture();e.decisions=[{reference:'NUR-0001',budget_id:'NUR-0001',item_id:null,normalized:{reference:'NUR-0001',live_eligible:true},companion:{production_eligible:false}}];assert.throws(()=>validateBatch(e),/unsafe/);
 await assert.rejects(readExport('../elsewhere'),/hash/);
});

test('PostgreSQL round trip, constraints and rollback preserve the existing catalog',{
 skip:process.env.ORIGEN_NURSING_LOCAL_TEST!=='true',
},async()=>{
 const c=await localClient();
 try{
  const before=await coaSnapshot(c);
  await c.query('BEGIN');
  try{
   await setup(c);
   const b=fixture();assert.equal((await writeBatch(c,b)).alreadyImported,false);
   assert.equal((await writeBatch(c,b)).alreadyImported,true);
   const changed=structuredClone(b);changed.budgets[0].issues.push('changed');await assert.rejects(writeBatch(c,changed),/identity_conflict/);
   const row=(await c.query('SELECT published_cents,components_cents FROM nursing_catalog.budgets WHERE batch_id=$1',[b.id])).rows[0];
   assert.equal(row.published_cents,null);assert.equal(row.components_cents,'0');
   for(const [column,value] of [['review_state',"'approved'"],['source_verified','true'],['live_eligible','true'],['automatic_production_permission','true']]){
    await c.query('SAVEPOINT pending_guard');
    await assert.rejects(c.query(`INSERT INTO nursing_catalog.budgets(batch_id,budget_id,source_row,campus,academic_year_status,bucket,payload,record_digest,${column}) VALUES($1,'unsafe',3,'Example','unknown','incomplete','{}','digest',${value})`,[b.id]),/check constraint/);
    await c.query('ROLLBACK TO SAVEPOINT pending_guard');
   }
   await c.query('SAVEPOINT immutable_guard');
   await assert.rejects(c.query('UPDATE nursing_catalog.items SET source_scalar_cents=100 WHERE batch_id=$1',[b.id]),/immutable/);
   await c.query('ROLLBACK TO SAVEPOINT immutable_guard');
   const failing=fixture();failing.items[0].row='not an integer';
   await c.query('SAVEPOINT atomic_guard');await assert.rejects(writeBatch(c,failing),/integer/);await c.query('ROLLBACK TO SAVEPOINT atomic_guard');
   assert.equal(Number((await c.query('SELECT count(*) n FROM nursing_catalog.batches WHERE id=$1',[failing.id])).rows[0].n),0);
   for(const role of ['origen_coa_catalog_readonly','origen_coa_catalog_test_reader']){
    assert.equal((await c.query("SELECT has_schema_privilege($1,'nursing_catalog','USAGE') allowed",[role])).rows[0].allowed,false);
   }
   if(process.env.ORIGEN_NURSING_BATCH){
    const real=await readExport(process.env.ORIGEN_NURSING_BATCH),result=await writeBatch(c,real);
    assert.equal(result.budgets,1016);assert.equal(result.items,6493);assert.equal(result.decisions,75);assert.equal(result.supportingSheets,39);
    const sums=(await c.query('SELECT count(*) n FROM nursing_catalog.budgets WHERE batch_id=$1 AND components_cents IS NULL',[real.id])).rows[0];
    assert.ok(Number(sums.n)>0);
   }
   assert.equal(hash(await coaSnapshot(c)),hash(before));
  }finally{await c.query('ROLLBACK');}
  assert.equal(hash(await coaSnapshot(c)),hash(before));
 }finally{await c.end();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readStaging,localClient,importBatch,digest} from './postgres.mjs';

test('staging filenames cannot escape the local staging directory',()=>{
 for(const name of ['../other.sqlite','C:/other.sqlite','https://example.test/db.sqlite','other.db']){
  assert.throws(()=>readStaging('unused',name),/plain_staging_database_filename_required/);
 }
});

test('supplied CSU batch survives PostgreSQL round trip without replacing UC release',{
 skip:!process.env.COA_CSU_BATCH,
},async()=>{
 const batch=readStaging(process.env.COA_CSU_BATCH,'csu-coa-staging.sqlite');
 assert.equal(batch.budgets.length,819);
 const snapshot=await readFile(new URL(`./.local/sources/${batch.hash}.xlsx`,import.meta.url));
 assert.equal(createHash('sha256').update(snapshot).digest('hex'),batch.hash);
 const c=await localClient();try{
  const budgets=(await c.query('SELECT * FROM coa_catalog.budgets WHERE batch_id=$1',[batch.id])).rows;
  const items=(await c.query('SELECT * FROM coa_catalog.items WHERE batch_id=$1',[batch.id])).rows;
  const storedBatch=(await c.query('SELECT * FROM coa_catalog.batches WHERE id=$1',[batch.id])).rows[0];
  assert.deepEqual(storedBatch.report,batch.report);
  assert.equal(budgets.length,819);assert.equal(items.length,6351);
  const byBudget=new Map(budgets.map(b=>[b.budget_key,b]));
  const byItem=new Map(items.map(i=>[i.item_key,i]));
  for(const expected of batch.budgets){
   const actual=byBudget.get(expected.key);
   assert.deepEqual(actual.payload,expected.payload);
   assert.equal(actual.record_digest,digest(expected.payload));
   assert.equal(actual.scenario_key,expected.scenario);
   assert.equal(actual.published_cents===null?null:Number(actual.published_cents),expected.total);
   assert.equal(Number(actual.components_cents),expected.sum);
   for(const item of expected.payload.items){
    const stored=byItem.get(item.key);
    assert.deepEqual(stored.payload,item);
    assert.equal(stored.amount_cents===null?null:Number(stored.amount_cents),item.amount);
   }
  }
  assert.deepEqual(await importBatch(c,batch),{alreadyImported:true});
  assert.equal(Number((await c.query('SELECT count(*) n FROM coa_catalog.approvals WHERE batch_id=$1',[batch.id])).rows[0].n),0);
  assert.equal(Number((await c.query('SELECT count(*) n FROM coa_catalog.test_releases WHERE batch_id=$1',[batch.id])).rows[0].n),0);
  const active=(await c.query('SELECT DISTINCT batch_id FROM coa_catalog.testing_published')).rows;
  assert.deepEqual(active,[{batch_id:'e82224f4d7ffca16a1956d2358f70596bc72b0ec791f4475e195ec4b73b68f77'}]);
  assert.equal(Number((await c.query('SELECT count(*) n FROM coa_catalog.testing_published')).rows[0].n),491);
 }finally{await c.end();}
});

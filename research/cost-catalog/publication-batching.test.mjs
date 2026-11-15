import test from 'node:test';
import assert from 'node:assert/strict';
import {publishCatalogSnapshot} from './publication.mjs';

function fixture(){
 const batch={id:'a'.repeat(64),source_sha256:'b'.repeat(64),importer_version:'test',imported_at:new Date().toISOString(),report:{}};
 const budgets=Array.from({length:80},(_,i)=>({batch_id:batch.id,budget_key:'budget-'+i,bucket:'reconciled',record_digest:String(i),payload:{note:'x'.repeat(i%2?40000:1000)}}));
 return {version:1,batch,budgets,items:budgets.map(b=>({batch_id:batch.id,budget_key:b.budget_key,item_key:b.budget_key+'-item'})),sourceReviewedAt:batch.imported_at,validUntil:new Date(Date.now()+86400000).toISOString(),reviewEvidence:{},publication:{records:budgets.map(b=>({key:b.budget_key,digest:b.record_digest}))}};
}
function client(failChunk=0){
 const calls=[];let checks=0;
 return {calls,async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT b.budget_key')&&++checks===failChunk)return {rows:[{budget_key:'conflict'}]};return {rows:[]};}};
}
test('large publication bounds validation and write payloads without losing records',async()=>{
 const snapshot=fixture(),db=client();await publishCatalogSnapshot(db,snapshot,{releasedBy:'test',note:'bounded publication'});
 const checks=db.calls.filter(c=>c.sql.startsWith('SELECT b.budget_key'));
 const inserts=db.calls.filter(c=>c.sql.startsWith('INSERT INTO coa_catalog.budgets SELECT'));
 assert.ok(checks.length>3);assert.equal(inserts.length,checks.length);
 for(const calls of [checks,inserts]){
  assert.deepEqual(calls.flatMap(c=>JSON.parse(c.args[0])).map(b=>b.budget_key),snapshot.budgets.map(b=>b.budget_key));
  assert.ok(calls.every(c=>Buffer.byteLength(c.args[0])<=512*1024&&JSON.parse(c.args[0]).length<=25));
 }
 assert.equal(db.calls.at(-1).sql,'COMMIT');
});
test('a conflict in a later validation batch rolls back before activating a release',async()=>{
 const db=client(3);await assert.rejects(publishCatalogSnapshot(db,fixture(),{releasedBy:'test',note:'conflict'}),/catalog_record_conflict/);
 assert.equal(db.calls.at(-1).sql,'ROLLBACK');
 assert.ok(!db.calls.some(c=>c.sql.startsWith('INSERT INTO coa_catalog.production_releases')));
 assert.ok(!db.calls.some(c=>c.sql.startsWith('INSERT INTO coa_catalog.budgets SELECT')));
});
test('one oversized source record is rejected instead of exceeding the memory bound',async()=>{
 const snapshot=fixture(),db=client();snapshot.budgets[0].payload.note='é'.repeat(300000);
 await assert.rejects(publishCatalogSnapshot(db,snapshot,{releasedBy:'test',note:'oversized'}),/exceeds_publication_limit/);
 assert.equal(db.calls.at(-1).sql,'ROLLBACK');
 assert.ok(!db.calls.some(c=>c.sql.startsWith('INSERT INTO coa_catalog.production_releases')));
});

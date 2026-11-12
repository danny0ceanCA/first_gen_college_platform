import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {projectRecord,combineCatalogResults} from './catalog.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {comparisonFindings} from '../../server/voice-comparison-update.mjs';
import {sourceIsCurrent} from '../../src/researchSourceValidity.mjs';
const batch='e82224f4d7ffca16a1956d2358f70596bc72b0ec791f4475e195ec4b73b68f77';
test('real catalog dates, next-day table and expired cached results in English and Spanish',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated PostgreSQL test required');return;}
 const client=await localClient();try{
  const rows=(await client.query("SELECT * FROM coa_catalog.testing_published WHERE batch_id=$1 AND budget_key IN ('UC-0005','UC-0261') ORDER BY campus",[batch])).rows;
  assert.equal(rows.length,2);
  const base=Date.now(),future=base+86400000;
  for(const language of ['en','es'])await t.test(language,()=>{
   const outputs=rows.map(row=>projectRecord(row,language,{allowTesting:true,now:base}));
   for(let i=0;i<outputs.length;i++){
    const source=outputs[i].sources[0];assert.equal(source.checkedAt,new Date(rows[i].payload.raw['Source checked']).toISOString());
    assert.equal(source.catalogValidity.retrievedAt,new Date(base).toISOString());
    assert.equal(source.catalogValidity.validUntil,new Date(rows[i].valid_until).toISOString());
    assert.equal(sourceIsCurrent(source,future),true);
    const reread=projectRecord(rows[i],language,{allowTesting:true,now:future});
    assert.equal(reread.sources[0].checkedAt,source.checkedAt);assert.equal(reread.sources[0].catalogValidity.validUntil,source.catalogValidity.validUntil);
   }
   const result=combineCatalogResults(outputs,language),question=language==='es'?'Compara el costo de asistencia alquilando fuera del campus':'Compare cost of attendance renting off campus';
   const events=[],v=voiceVisualCards({emit:event=>events.push(event),now:()=>future});v.trackResearch('clock',question);
   v.receiveResearch({id:'clock-table',question,query:{requestKey:'clock',question,language},status:'completed',result});
   const table=events.find(e=>e.type==='origen.visual.research')?.report.table;assert.ok(table);
   assert.equal(table.columns.length,2);const cells=table.rows.find(row=>row.aspect==='total_budget').cells;
   assert.ok(cells.every(cell=>cell?.budget&&cell.sources.length));
   assert.equal(cells[table.columns.indexOf('UC Berkeley')].budget.total,49692);
   assert.equal(cells[table.columns.indexOf('UC Berkeley')].budget.components.find(c=>c.key==='transportation').amount,1238);
   assert.ok(cells.every(cell=>cell.status==='partial'),'validity does not upgrade test evidence');
   const expiry=Math.max(...rows.map(row=>new Date(row.valid_until).getTime()));
   assert.equal(comparisonFindings(result,{now:expiry,forVisual:true}),null);
   assert.equal(projectRecord(rows[0],language,{allowTesting:true,now:new Date(rows[0].valid_until).getTime()}),null);
   const unmarked=structuredClone(result);unmarked.sources.forEach(source=>delete source.catalogValidity);
   assert.equal(comparisonFindings(unmarked,{now:future,forVisual:true}),null,'ordinary stale web sources are still rejected');
  });
 }finally{await client.end();}
});

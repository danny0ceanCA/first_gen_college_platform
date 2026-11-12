import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {projectRecord} from './catalog.mjs';
import {createLocalCostLookup,assertLocalCatalogEnvironment,createLocalCatalogProvider} from './local-provider.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';
const batch='e82224f4d7ffca16a1956d2358f70596bc72b0ec791f4475e195ec4b73b68f77';
const localEnv={NODE_ENV:'development',RESEARCH_WORKER_DATABASE_URL:'postgresql://origen_research_worker@127.0.0.1:55480/origen_decisions_local_20261107'};

test('local testing provider refuses production, remote hosts and other databases',()=>{
 assertLocalCatalogEnvironment(localEnv);
 for(const env of [{...localEnv,NODE_ENV:'production'},{...localEnv,RESEARCH_WORKER_DATABASE_URL:'postgresql://user@example.com:55480/origen_decisions_local_20261107'},{...localEnv,RESEARCH_WORKER_DATABASE_URL:'postgresql://postgres@127.0.0.1:55480/postgres'}])assert.throws(()=>assertLocalCatalogEnvironment(env),/isolated_local/);
});

test('updated workbook stays isolated and supplies qualified local research results',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated local PostgreSQL test required');return;}
 const c=await localClient();
 try{
  const rows=(await c.query('SELECT * FROM coa_catalog.testing_published WHERE batch_id=$1',[batch])).rows;
  await t.test('all 491 scenarios and 209 review notes are retained without production approval',async()=>{
   assert.equal(rows.length,491);assert.equal(rows.reduce((sum,row)=>sum+row.review_evidence.reviewNotes.length,0),209);
   assert.ok(rows.every(row=>row.review_evidence.reviewNotes.length<=1),'each lookup receives only its own review note');
   assert.equal(Number((await c.query('SELECT count(*) AS n FROM coa_catalog.items WHERE batch_id=$1',[batch])).rows[0].n),5278);
   assert.equal(Number((await c.query('SELECT count(*) AS n FROM coa_catalog.published WHERE batch_id=$1',[batch])).rows[0].n),0);
  });
  for(const language of ['en','es'])await t.test(`${language}: every test record projects with its limitations and missing amounts stay missing`,()=>{
   for(const row of rows){
    const result=projectRecord(row,language,{allowTesting:true});assert.ok(result,row.budget_key);
    const finding=result.voiceBrief.findings[0];assert.equal(finding.status,'partial');
    assert.equal(finding.budget.total,row.published_cents===null?null:Number(row.published_cents)/100);
    if(row.bucket==='discrepancy')assert.match(finding.qualification,language==='es'?/no coinciden/:/do not reconcile/);
    if(row.bucket==='derived')assert.match(finding.qualification,language==='es'?/No hay total publicado/:/No published total/);
    if(row.budget_key==='UC-0346')assert.match(finding.qualification,language==='es'?/conflicto/:/conflict/);
    if(['UC-0489','UC-0490','UC-0491'].includes(row.budget_key)){assert.equal(finding.budget.total,null);assert.ok(finding.budget.components.some(item=>item.role==='missing'));}
   }
  });
  const lookup=createLocalCostLookup({query:c.query.bind(c)});
  for(const language of ['en','es'])await t.test(`${language}: three-campus totals and every known component use existing research/table delivery without web or an extra model`,async()=>{
   const question=language==='es'?'Compara el costo total de asistencia 2026-27 para residentes de California que alquilan fuera del campus.':'Compare 2026-27 California-resident undergraduate cost of attendance renting off campus.';
   const input={mode:'finance',language,question,institution:'UC Berkeley; UC Davis; UC Merced'};
   const result=await lookup(input);assert.ok(result);assert.equal(result.voiceBrief.findings.length,3);
   assert.deepEqual(result.voiceBrief.findings.map(f=>f.budget.total),[49692,44760,41834]);
   assert.ok(result.voiceBrief.findings.every(f=>f.budget.components.some(item=>item.key==='transportation')));
   const events=[],visual=voiceVisualCards({emit:event=>events.push(event)});
   visual.trackResearch('catalog-test',question);visual.receiveResearch({id:'catalog-local',query:{requestKey:'catalog-test',question,language},question,status:'completed',result});
   const table=events.find(e=>e.type==='origen.visual.research');assert.ok(table?.present);assert.equal(table.report.table.columns.length,3);
   let available=true;const writes=[];
   const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:'test-job',input}]};}writes.push({sql,args});return {rows:[{status:'running'}]};}};
   await processResearchJob(db,{}, {log:()=>{},lookupCatalog:lookup,request:()=>assert.fail('catalog hit must not perform an OpenAI or web lookup')});
   const saved=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(saved);assert.equal(saved.voiceBrief.findings.length,3);assert.equal(saved.catalogLocalTesting,true);
   assert.equal(saved.researchDiagnostics.attempts.length,0);
  });
  await t.test('unsupported year and personal-aid calculations stay on the original path',async()=>{
   for(const question of ['2027-28 cost of attendance renting off campus.','What financial aid award will he get renting off campus?'])assert.equal(await lookup({mode:'finance',language:'en',institution:'UC Berkeley',question}),null);
   const known=await lookup({mode:'finance',language:'en',institution:'UC Berkeley',question:'2026-27 tuition and fees, California resident renting off campus.'});assert.ok(known);
   const reply=researchSpokenFinding(known.voiceBrief.findings[0],{question:'What are tuition and fees?',language:'en'});
   assert.match(reply.answer,/18,214/);assert.doesNotMatch(reply.answer,/49,692/);
  });
  await t.test('read-only local runtime role can read testing view but not drafts or write approvals',async()=>{
   const provider=await createLocalCatalogProvider(localEnv);try{
    const result=await provider.lookup({mode:'finance',language:'en',institution:'UC Berkeley',question:'California-resident 2026-27 cost of attendance renting off campus.'});assert.ok(result);
   }finally{await provider.close();}
   await c.query('SET ROLE origen_coa_catalog_test_reader');try{
    assert.equal((await c.query('SELECT 1 FROM coa_catalog.testing_published LIMIT 1')).rowCount,1);
    await assert.rejects(c.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);
    await assert.rejects(c.query('INSERT INTO coa_catalog.approvals DEFAULT VALUES'),/permission denied/);
   }finally{await c.query('RESET ROLE');}
  });
 }finally{await c.end();}
});

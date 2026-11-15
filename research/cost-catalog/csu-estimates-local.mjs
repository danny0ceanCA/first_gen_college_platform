import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCsuEstimates} from '../../scripts/prepare-csu-estimates.mjs';
import {prepareCsuCorrections} from '../../scripts/prepare-csu-corrections.mjs';
import {exportLocalCatalog} from '../../scripts/promote-coa-catalog.mjs';
import {publishCatalogSnapshot,publicationDigest} from './publication.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {projectRecord} from './catalog.mjs';
import {verifyMixedCatalog} from './csu-rehearsal.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';

// This operator cannot load a remote URL or application account data. It uses
// actual PostgreSQL and runtime read-only provider code against loopback only.
export async function rehearseCsuEstimates(directory){
 const {snapshot,receipt}=await prepareCsuEstimates(directory);
 const {snapshot:baseline}=await prepareCsuCorrections(resolve(directory,'baseline'));
 const uc=await exportLocalCatalog(),name='origen_csu_estimates_20261115';
 const local={host:'127.0.0.1',port:55480,user:'postgres',connectionTimeoutMillis:3000};
 const admin=new pg.Client({...local,database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const c=new pg.Client({...local,database:name});await c.connect();let provider;
 try{
  assert.deepEqual((await c.query('SELECT current_database() db,inet_server_port() port,host(inet_server_addr()) host')).rows[0],{db:name,port:55480,host:'127.0.0.1'});
  await c.query(await readFile(new URL('../../server/migrations/126_cost_catalog_publication.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../../server/migrations/128_cost_catalog_campus_releases.sql',import.meta.url),'utf8'));
  await publishCatalogSnapshot(c,uc,{releasedBy:'isolated-local-test',note:'UC baseline.'});
  await publishCatalogSnapshot(c,baseline,{releasedBy:'isolated-local-test',note:'607 CSU baseline.'});
  const before=(await c.query('SELECT budget_key,record_digest FROM coa_catalog.production_published ORDER BY budget_key')).rows;
  await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-local-test',note:'Explicit calculated/partial estimate trial, 43 disputes held; local only.'});
  assert.equal((await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-local-test',note:'Idempotence.'})).alreadyPublished,true);
  const rows=(await c.query('SELECT * FROM coa_catalog.production_published')).rows;
  assert.equal(rows.length,1267);for(const b of before)assert.equal(rows.find(r=>r.budget_key===b.budget_key)?.record_digest,b.record_digest);
  for(const b of receipt.held)assert.ok(!rows.some(r=>r.budget_key===b.budgetId),'held record must remain inaccessible');
  const projections=[];
  for(const language of ['en','es'])for(const row of rows.filter(r=>r.payload.catalogEstimate)){
   const result=projectRecord(row,language,{allowTesting:true,now:Date.parse(snapshot.sourceReviewedAt)+2*86400000});assert.ok(result,row.budget_key);
   const b=result.voiceBrief.findings[0].budget;assert.equal(b.total,null);assert.equal(row.published_cents,null);assert.equal(Math.round(b.catalogEstimate.amount*100),Number(row.components_cents));
   assert.equal(projectRecord(row,language,{allowTesting:true,now:Date.parse(snapshot.validUntil)+1}),null);
   projections.push({language,budgetId:row.budget_key,basis:b.catalogEstimate.basis,amount:b.catalogEstimate.amount,unknownCharges:b.catalogEstimate.unresolved.length});
  }
  provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:`postgresql://origen_research_worker@127.0.0.1:55480/${name}`});
  const mixed=await verifyMixedCatalog(provider),workerChecks=[],tableReports={};
  for(const language of ['en','es'])for(const [kind,institution,question,expected] of [
   ['calculated','Sonoma State',language==='en'?'2026-27 nonresident undergraduate cost of attendance renting off campus.':'Costo de asistencia 2026-27 de pregrado no residente alquilando fuera del campus.',50194],
   ['partial','San Francisco State',language==='en'?'2026-27 nonresident undergraduate cost of attendance living with family.':'Costo de asistencia 2026-27 de pregrado no residente viviendo con familiares.',27736],
   ['calculated','Sonoma State',language==='en'?'2026-27 WUE undergraduate cost of attendance living with family.':'Costo de asistencia 2026-27 de pregrado WUE viviendo con familiares.',31608],
  ]){
   const input={mode:'finance',language,institution,question,requestKey:'estimate-'+kind};let available=true;const writes=[];const started=performance.now();
   const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:'fictional-estimate-job',input}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
   await processResearchJob(db,{}, {log:()=>{},lookupCatalog:provider.lookup,request:()=>assert.fail('catalog estimate must not spend on a fresh lookup or recovery')});
   const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result,language+' '+kind+' '+institution);
   const budget=result.voiceBrief.findings[0].budget;assert.equal(budget.catalogEstimate.basis,kind);assert.equal(budget.catalogEstimate.amount,expected);assert.equal(budget.total,null);
   if(question.includes('WUE'))assert.match(result.voiceBrief.qualification,language==='es'?/elegibilidad/:/eligibility/);
   assert.equal(result.researchDiagnostics.attempts.length,0);assert.equal(result.researchDiagnostics.recoveryStatus,'not_needed');
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});visual.trackResearch(input.requestKey,question);
   visual.receiveResearch({id:input.requestKey,status:'completed',result,query:input});const report=events.find(e=>e.type==='origen.visual.research')?.report;assert.ok(report);
   const summary=researchCostRows(report.table.rows,1,report.housingScenario).find(r=>r.id==='total_budget').cells[0];assert.equal(summary.estimateBasis,kind);assert.equal(Number(summary.value.replace(/[^0-9.]/gu,'')),expected);
   tableReports[language+'-'+kind+(question.includes('WUE')?'-wue':'')]=report;
   workerChecks.push({language,kind,institution,amount:expected,lookupWorkerTableMs:Math.round(performance.now()-started),modelCalls:0});
  }
  const reader=new pg.Client({...local,database:name,user:'origen_research_worker'});await reader.connect();
  try{await assert.rejects(reader.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);}finally{await reader.end();}
  const report={database:name,uc:491,csu:776,calculated:44,partial:125,held:43,preservedBaselineRecords:before.length,projections,mixed,workerChecks,modelCalls:0,productionChanged:false,snapshotDigest:publicationDigest(snapshot),at:new Date().toISOString()};
  await writeFile(join(directory,'rehearsal.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(directory,'table-reports.json'),JSON.stringify(tableReports));return report;
 }finally{await provider?.close();await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const r=await rehearseCsuEstimates(resolve(process.argv[2]));
 console.log(JSON.stringify({database:r.database,csu:r.csu,uc:r.uc,calculated:r.calculated,partial:r.partial,held:r.held,projections:r.projections.length,workerChecks:r.workerChecks.length,mixedStages:r.mixed.length,modelCalls:0,productionChanged:false}));
}

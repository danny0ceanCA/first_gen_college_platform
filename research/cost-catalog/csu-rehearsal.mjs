// Explicit isolated PostgreSQL publication rehearsal. No application or remote
// database credentials are read; real public workbook records, fictional calls.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exportLocalCatalog} from '../../scripts/promote-coa-catalog.mjs';
import {publishCatalogSnapshot,publicationDigest} from './publication.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {costCampusName,csuCampuses} from '../../src/campusIdentity.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {emptyResearchVisual,researchVisualReducer,visibleResearchReport} from '../../src/researchVisualState.ts';
import {researchCostRows} from '../../src/researchCostRows.ts';
import {standardUndergraduateRecord,residentCategories,sourceHousing} from './scope.mjs';

export async function verifyMixedCatalog(provider,{onReport=()=>{}}={}){
 const checks=[];
 for(const language of ['en','es']){
  let state=emptyResearchVisual,reference;
  const q=language==='en'?'2026-27 California resident undergraduate transfer cost of attendance renting off campus.':'Costo de asistencia 2026-27 para transferencia de pregrado residente de California alquilando fuera del campus.';
  for(const [index,institution] of ['UC Berkeley','UC Davis','California State University, Sacramento','Cal State Long Beach','San José State University'].entries()){
   const started=performance.now(),result=await provider.lookup({mode:'finance',language,institution,question:q});
   assert.ok(result,institution);assert.equal(result.catalogPublication,'production');
   const input={mode:'finance',language,institution,question:q,requestKey:'rehearsal-'+index,
    confirmedHousingChoice:'renting',...(reference?{visualComparisonBaseId:reference,visualComparisonCampus:institution}:{})};
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});
   visual.trackResearch(input.requestKey,q);visual.receiveResearch({id:input.requestKey,query:input,status:'completed',result});
   const e=events.find(e=>e.type==='origen.visual.research');assert.ok(e?.present,institution);
   state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});
   const report=state.reports.find(r=>r.id===state.view);reference=report.id;
   assert.equal(report.table.columns.length,index+1,'earlier UC/CSU columns remain');
   const rows=researchCostRows(report.table.rows,index+1,report.housingScenario);
   assert.ok(rows.find(r=>r.id==='total_budget').cells.every(Boolean),'each total remains');
   assert.equal(rows.find(r=>r.id==='tuition_fees').cells[0].value,'$18,214');
   if(index>=2){
    assert.equal(rows.find(r=>r.id==='total_budget').cells[2].value,'$40,904');
    assert.equal(rows.find(r=>r.id==='tuition_fees').cells[2].value,'$9,656');
    assert.equal(rows.find(r=>r.id==='housing_and_food').cells[2].value,'$23,504');
   }
   checks.push({language,institution,lookupAndTableMs:Math.round(performance.now()-started),campuses:report.table.columns,
    totals:rows.find(r=>r.id==='total_budget').cells.map(c=>c.value),rows:rows.map(r=>r.id)});
  }
  const last=state.reports.find(r=>r.id===state.view),hidden=last.table.columns[1];
  state=researchVisualReducer(state,{type:'hideColumn',column:hidden});assert.equal(visibleResearchReport(last,state.hiddenColumns).table.columns.length,4);
  state=researchVisualReducer(state,{type:'restoreColumns'});assert.equal(visibleResearchReport(last,state.hiddenColumns).table.columns.length,5);
  onReport(last,language);
 }
 return checks;
}

async function rehearse(path,directory){
 const snapshot=JSON.parse(await readFile(path,'utf8')),uc=await exportLocalCatalog();
 assert.ok(uc.budgets.every(b=>b.campus.startsWith('UC')),'existing UC test release expected');
 const name='origen_csu_release_rehearsal_20261114';
 const local={host:'127.0.0.1',port:55480,user:'postgres',connectionTimeoutMillis:5000};
 const admin=new pg.Client({...local,database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const c=new pg.Client({...local,database:name});await c.connect();let provider;
 try{
  await c.query(await readFile(new URL('../../server/migrations/126_cost_catalog_publication.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../../server/migrations/128_cost_catalog_campus_releases.sql',import.meta.url),'utf8'));
  await publishCatalogSnapshot(c,uc,{releasedBy:'isolated-rehearsal',note:'Existing UC release preserved.'});
  await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-rehearsal',note:'CSU reviewed subset; unresolved records held.'});
  assert.equal(Number((await c.query("SELECT count(*) FROM coa_catalog.production_published WHERE campus LIKE 'UC%'")).rows[0].count),uc.budgets.length);
  assert.equal(Number((await c.query("SELECT count(*) FROM coa_catalog.production_published WHERE campus NOT LIKE 'UC%'")).rows[0].count),snapshot.budgets.length);
  assert.equal((await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-rehearsal',note:'Retry verification.'})).alreadyPublished,true);
  provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:`postgresql://origen_research_worker@127.0.0.1:55480/${name}`});
  const tableReports={},checks=await verifyMixedCatalog(provider,{onReport:(report,language)=>{tableReports[language]=report;}}),campusChecks=[];
  for(const [campus,,aliases] of csuCampuses)for(const language of ['en','es']){
   const question=language==='en'?'2026-27 California resident undergraduate cost of attendance renting off campus.':'Costo de asistencia 2026-27 de pregrado residente de California alquilando fuera del campus.';
   const result=await provider.lookup({mode:'finance',language,institution:aliases[0],question});
   const eligible=snapshot.budgets.some(b=>b.campus===campus&&standardUndergraduateRecord(b)&&residentCategories('California resident').includes(b.payload.raw.Residency)&&['renting','off_campus_unspecified'].includes(sourceHousing(b)));
   assert.equal(costCampusName(aliases[0]),campus);
   if(eligible)assert.ok(result,campus+' '+language);
   campusChecks.push({campus,language,matched:!!result,eligible,reason:result?'published_catalog':'requires_scope_or_held_data'});
  }
  const reader=new pg.Client({...local,user:'origen_research_worker',database:name});await reader.connect();
  try{await assert.rejects(reader.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);await assert.rejects(reader.query('UPDATE coa_catalog.production_releases SET note=note'),/permission denied/);}finally{await reader.end();}
  await writeFile(resolve(directory,'rehearsal.json'),JSON.stringify({at:new Date().toISOString(),snapshotDigest:publicationDigest(snapshot),database:name,modelCalls:0,ucRecords:uc.budgets.length,csuRecords:snapshot.budgets.length,checks,campusChecks},null,2));
  await writeFile(resolve(directory,'table-reports.json'),JSON.stringify(tableReports));
  console.log(JSON.stringify({ucRecords:uc.budgets.length,csuRecords:snapshot.budgets.length,mixedStages:checks.length,campusChecks:campusChecks.length,matched:campusChecks.filter(c=>c.matched).length,modelCalls:0}));
 }finally{await provider?.close();await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await rehearse(process.argv[2],process.argv[3]);

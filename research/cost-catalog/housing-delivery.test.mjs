import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {scopeFinanceHousing,costHousingScenario} from '../../server/voice-housing-scope.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {researchVisualReducer,emptyResearchVisual} from '../../src/researchVisualState.ts';
import {researchCostRows} from '../../src/researchCostRows.ts';

test('known housing survives generic wording without overriding an explicit alternative',()=>{
 for(const [language,generic,specific,alternative] of [
  ['en','California resident cost of attendance living off campus.','California resident cost of attendance renting off campus.','What if living with family?'],
  ['es','Costo de asistencia para residente de California fuera del campus.','Costo de asistencia para residente de California alquilando fuera del campus.','¿Y si vive con familiares?'],
 ]){
  assert.equal(costHousingScenario(scopeFinanceHousing(generic,'renting',language)),'renting');
  assert.equal(scopeFinanceHousing(specific,'with_family',language),specific);
  assert.equal(scopeFinanceHousing(alternative,'renting',language),alternative);
 }
 assert.equal(costHousingScenario('living off campus with relatives'),'with_family');
});

test('database to worker to white table: full breakdown, campus and housing additions, no paid calls',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated PostgreSQL required');return;}
 const client=await localClient();try{
  for(const language of ['en','es'])await t.test(language,async()=>{
   let queries=0;const lookup=createLocalCostLookup({query:(...args)=>{queries++;return client.query(...args);}});
   const en=language==='en',events=[],v=voiceVisualCards({emit:e=>events.push(e)});
   let state=emptyResearchVisual;
   const receive=(id,input,result,base)=>{
    v.trackResearch(id,input.question);v.inputStarted(); // table must not wait for the ongoing speech/turn
    v.receiveResearch({id,status:'completed',question:input.question,query:{...input,requestKey:id,visualComparisonBaseId:base},result});
    const event=events.at(-1);assert.equal(event.present,true);
    state=researchVisualReducer(state,{type:'receive',report:event.report,present:event.present});
    const report=state.reports.find(r=>r.id===state.view);
    const rows=researchCostRows(report.table.rows,report.table.columns.length,report.housingScenario);
    assert.ok(rows?.some(r=>r.id==='total_budget'));
    assert.ok(rows.some(r=>r.id==='transportation'));
    return {report,rows};
   };
   const first={mode:'finance',language,institution:'University of California, Berkeley',question:en?
    "UC Berkeley published 2026-27 cost of attendance, California resident undergraduate living off campus. Include tuition separately.":
    'Costo de asistencia publicado de UC Berkeley 2026-27 para pregrado residente de California fuera del campus. Incluye matrícula por separado.'};
   let claimed=false;const writes=[];
   const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'housing-test',input:first}]};}writes.push({sql,args});return {rows:[{status:'running'}]};}};
   const started=performance.now();
   const lifecycle=[];
   await processResearchJob(db,{}, {lookupCatalog:lookup,log:event=>lifecycle.push(event),request:()=>assert.fail('catalog-supported costs must not fall through to web research')});
   const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);
   assert.equal(result.researchDiagnostics.attempts.length,0);
   assert.ok(lifecycle.some(event=>event.researchStage==='catalog_checked'&&event.catalogReason==='matched'));
   assert.equal(result.voiceBrief.findings.length,2);
   assert.match(result.voiceBrief.nextStep||'',/./);
   const initial=receive('berkeley',first,result);
   assert.equal(initial.report.table.columns.length,2);
   for(const cells of initial.report.table.rows.filter(r=>r.aspect==='total_budget').map(r=>r.cells)){
    assert.ok(cells.every(c=>c?.budget?.components.length>=6));
    assert.ok(cells.every(c=>/personal housing|vivienda personal/u.test(c.qualification)));
   }
   const rentingIndex=initial.report.table.columns.findIndex(c=>/Renting|Alquiler/.test(c));
   const total=initial.rows.find(r=>r.id==='total_budget').cells[rentingIndex];assert.equal(total.value,'$49,692');
   assert.equal(initial.rows.find(r=>r.id==='transportation').cells[rentingIndex].value,'$1,238');
   // Adding Davis uses only Davis in the SQL campus parameter, while the UI
   // keeps Berkeley's two scenarios through application-owned table lineage.
   const params=[];const addedLookup=createLocalCostLookup({query:(sql,args)=>{params.push(args);return client.query(sql,args);}});
   const second={mode:'finance',language,institution:'University of California, Davis; University of California, Berkeley',visualComparisonCampus:'University of California, Davis',question:en?'UC Davis cost of attendance 2026-27 California resident renting off campus.':'Costo de asistencia UC Davis 2026-27 residente de California alquilando fuera del campus.'};
   const davis=await addedLookup(second);assert.ok(davis);assert.deepEqual(params[0][0],['UC Davis']);
   const comparison=receive('davis',second,davis,'berkeley');assert.equal(comparison.report.table.columns.length,3);
   assert.equal(comparison.rows.find(r=>r.id==='total_budget').cells[rentingIndex].value,'$49,692');
   assert.ok(comparison.rows.find(r=>r.id==='total_budget').cells.every(Boolean));
   const third={...second,institution:'UC Davis',visualComparisonCampus:undefined,question:en?'UC Davis cost of attendance 2026-27 California resident living with family.':'Costo de asistencia UC Davis 2026-27 residente de California con familiares.'};
   const family=await lookup(third);assert.ok(family);
   const expanded=receive('davis-family',third,family,'davis');assert.equal(expanded.report.table.columns.length,4);
   assert.ok(expanded.rows.find(r=>r.id==='total_budget').cells.every(Boolean));
   // Reading and presenting the same records never moves the source dates.
   assert.deepEqual(result.sources.map(s=>s.checkedAt),initial.report.table.rows[0].cells.flatMap(c=>c.sources.map(s=>result.sources.find(source=>source.url===s.url)?.checkedAt)));
   console.log(JSON.stringify({language,databaseWorkerAndTableMs:Math.round(performance.now()-started),queries,columns:4,providerCalls:0}));
  });
 }finally{await client.end();}
});

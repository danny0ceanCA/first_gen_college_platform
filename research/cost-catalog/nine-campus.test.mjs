import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {cohortYear,residentCategories,sourceHousing} from './scope.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';

test('source scope normalization is bounded, without inventing eligibility or commuter meaning',()=>{
 for(const label of ['2026-27','2026 Cohort','2026-27 entering','2026-27 continuing','2026-27 or earlier','2026 Cohort and Prior'])assert.equal(cohortYear(label),2026);
 for(const label of ['unknown','2026 or 2027','2026-27 maybe','Special 2026 program'])assert.equal(cohortYear(label),null);
 assert.deepEqual(residentCategories('Nonresident'),['Nonresident']);
 const record=note=>({payload:{raw:{'Scope and exclusions':note},normalized:{housing:'commuter_unspecified'}}});
 assert.equal(sourceHousing(record('Commuter means living with family.')),'with_family');
 assert.equal(sourceHousing(record('Do not map commuter/remote learner to parents-only.')),'commuter_unspecified');
});

test('nine campuses: all typed components and totals reach visible English/Spanish tables',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated PostgreSQL required');return;}
 const c=await localClient(),metrics=[];
 try{await c.query('BEGIN READ ONLY');
  const lookup=createLocalCostLookup({query:c.query.bind(c)});
  for(const language of ['en','es'])for(const institution of ['UC Berkeley','UC Davis','UC Irvine','UC Merced','UC Riverside','UC San Diego','UC Santa Barbara','UC Santa Cruz','UCLA'])for(const scenario of ['renting','with_family','unspecified'])await t.test(`${language}: ${institution}, ${scenario}`,async()=>{
   const label=language==='en'?{renting:'renting off campus',with_family:'living with family',unspecified:'living off campus'}[scenario]:{renting:'alquilando fuera del campus',with_family:'con familiares',unspecified:'fuera del campus'}[scenario];
   const question=language==='en'?`${institution} cost of attendance for a California resident undergraduate ${label}. Include tuition separately.`:`Costo de asistencia de ${institution} para pregrado residente de California ${label}. Incluye matrícula por separado.`;
   const started=performance.now(),result=await lookup({mode:'finance',language,institution,question});assert.ok(result?.catalogLocalTesting);
   const events=[],v=voiceVisualCards({emit:e=>events.push(e)});
   v.trackResearch('matrix',question);v.inputStarted();
   v.receiveResearch({id:'matrix',status:'completed',query:{requestKey:'matrix',question,institution,language},question,result});
   const event=events[0];assert.equal(event.present,true);
   const {table}=event.report,rows=researchCostRows(table.rows,table.columns.length,event.report.housingScenario);
   assert.equal(table.columns.length,scenario==='unspecified'?2:1);
   for(const [index,cell] of table.rows.find(row=>row.aspect==='total_budget').cells.entries()){
    assert.ok(cell?.budget?.total!=null);assert.equal(cell.status,'partial');
    assert.equal(rows.find(row=>row.id==='total_budget')?.cells[index]?.value,money(cell.budget.total));
    for(const item of cell.budget.components.filter(item=>item.role==='component'&&item.amount!==null))assert.equal(rows.find(row=>row.id===item.key)?.cells[index]?.value,money(item.amount),`${institution} ${item.key}`);
   }
   if(institution==='UCLA'&&scenario!=='renting'){
    assert.ok(table.columns.some(column=>/Commuter|viajero/u.test(column)));
    assert.ok(result.voiceBrief.findings.some(f=>/No confirmed family category|No hay categoría confirmada/u.test(f.qualification)));
    assert.ok(result.voiceBrief.findings.some(f=>f.budget.housing==='unspecified'));
   }
   if(institution==='UC Santa Cruz'&&scenario==='with_family')assert.equal(result.voiceBrief.findings[0].budget.housing,'with_family');
   metrics.push(Math.round(performance.now()-started));
  });
  for(const institution of ['UC San Diego','UC Santa Barbara','UC Santa Cruz']){
   const result=await lookup({mode:'finance',language:'en',institution,question:'2026-27 cost of attendance California resident renting off campus, cohort 2025-26.'});
   assert.ok(result);assert.match(result.voiceBrief.findings[0].budget.population,/2025/u);
  }
  assert.equal(await lookup({mode:'finance',institution:'UC Davis',question:'Financial aid award for graduate student renting off campus.'}),null);
  assert.equal(await lookup({mode:'finance',institution:'UC Davis',question:'2035-36 cost of attendance renting off campus.'}),null);
  console.log(JSON.stringify({matrixCases:metrics.length,minMs:Math.min(...metrics),maxMs:Math.max(...metrics),externalProviderCalls:0}));
 }finally{await c.query('ROLLBACK');await c.end();}
});
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n);

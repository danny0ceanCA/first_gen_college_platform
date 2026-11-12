import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {housingResultForChoice,scopeFinanceHousing} from '../../server/voice-housing-scope.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {emptyResearchVisual,researchVisualReducer} from '../../src/researchVisualState.ts';

test('Riverside housing confirmation persists across campuses without a repeat lookup',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated database required');return;}
 const c=await localClient();
 try{for(const language of ['en','es'])for(const choice of ['renting','with_family'])await t.test(`${language}: ${choice}`,async()=>{
  let queries=0,state=emptyResearchVisual;
  const lookup=createLocalCostLookup({query:(...args)=>{queries++;return c.query(...args);}});
  const visuals=voiceVisualCards({emit:e=>{if(e.type==='origen.visual.research')state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});}});
  const question=language==='es'?'Costo de asistencia para pregrado residente de California fuera del campus.':'California resident undergraduate cost of attendance off campus.';
  const initial=await lookup({mode:'finance',language,institution:'UC Riverside',question});
  const original=structuredClone(initial);assert.equal(initial.voiceBrief.findings.length,2);
  assert.ok(initial.voiceBrief.nextStep);
  const job={id:'riverside',status:'completed',question,query:{question,mode:'finance',language,institution:'UC Riverside',requestKey:'riverside'},result:initial};
  visuals.trackResearch('riverside',question);visuals.receiveResearch(job);
  assert.equal(state.reports.find(r=>r.id===state.view).table.columns.length,2);
  const scoped=housingResultForChoice(initial,choice);
  assert.equal(scoped.voiceBrief.findings.length,1);assert.equal(scoped.voiceBrief.nextStep,'');
  assert.equal(scoped.voiceBrief.findings[0].status,'partial','personal confirmation does not verify the source');
  assert.deepEqual(initial,original,'source records are retained unchanged');
  if(choice==='renting'){
   assert.equal(scoped.voiceBrief.findings[0].budget.housing,'off_campus');
   assert.match(scoped.voiceBrief.findings[0].qualification,/reconcile|concilia|cuadra|coinciden/iu);
  }
  visuals.presentRetained({...job,query:{...job.query,confirmedHousingChoice:choice}},true);
  assert.equal(queries,1,'confirmation reuses the existing result');
  assert.equal(state.reports.find(r=>r.id===state.view).table.columns.length,1);
  for(const campus of ['UC Berkeley','UC Davis']){
   const scopedQuestion=scopeFinanceHousing(question,choice,language);
   const result=await lookup({mode:'finance',language,institution:campus,question:scopedQuestion});
   assert.equal(result.voiceBrief.findings.length,1,'only the confirmed scenario is looked up');
   const id=campus,base=state.view;
   visuals.trackResearch(id,scopedQuestion);visuals.receiveResearch({id,status:'completed',question:scopedQuestion,result,
    query:{mode:'finance',language,institution:campus,question:scopedQuestion,requestKey:id,visualComparisonBaseId:base,visualComparisonCampus:campus,confirmedHousingChoice:choice}});
  }
  const report=state.reports.find(r=>r.id===state.view);
  assert.equal(report.table.columns.length,3);assert.equal(queries,3);
  assert.ok(report.table.rows.filter(r=>r.aspect==='total_budget').flatMap(r=>r.cells).filter(Boolean).every(cell=>
   choice==='renting'?cell.budget.housing!=='with_family':cell.budget.housing==='with_family'));
 });}finally{await c.end();}
});

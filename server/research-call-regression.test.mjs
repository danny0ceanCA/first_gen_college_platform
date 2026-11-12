import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileResearchFindings} from './research-recovery.mjs';
import {voiceVisualCards} from './voice-visual-cards.mjs';
import {researchCostRows} from '../src/researchCostRows.ts';
import {isResearchAcknowledgment} from '../src/researchSpeechObservation.mjs';
const clock=Date.parse('2026-11-11T07:29:08Z');
for(const language of ['en','es']){
 const es=language==='es',checkedAt=new Date(clock-1000).toISOString();
 const answer=es?'$40,000 USD por año académico 2026–27, alquiler fuera del campus. Desglose publicado: Matrícula y cuotas: $10,000; Vivienda: $20,000; Alimentación: $8,000; Transporte: $2,000. [1]':'$40,000 USD per 2026–27 academic year, renting off campus. Published breakdown: Tuition and fees: $10,000; Housing: $20,000; Food: $8,000; Transportation: $2,000. [1]';
 const qualification=es?'Referencia de alquiler; modalidad de vivienda sin confirmar. [1]':'Assumed rental benchmark; housing choice unconfirmed. [1]';
 const budget={subject:'Eastview College — 2026–27',aspect:'total_budget',status:'verified',answer,qualification};
 const missing={subject:'Eastview College — 2026–27 off-campus housing arrangement unspecified',aspect:'housing',status:'unverified',answer:es?'Los costos de vivienda y alimentación no se pudieron confirmar.':'The housing and food amounts could not be confirmed.',qualification:'Unverified.'};
 const result={checkedAt,sources:[{url:'https://eastview.edu/budget',checkedAt}],text:missing.answer,voiceBrief:{status:'partial',answer:missing.answer,qualification:'Unverified.',nextStep:'',findings:[budget,missing]}};
 test(`${language}: recovered components retire the obsolete source gap without losing assumptions`,()=>{
  const merged=reconcileResearchFindings(result);
  assert.equal(merged.voiceBrief.findings.length,1);assert.equal(merged.voiceBrief.qualification,qualification);
  assert.match(merged.voiceBrief.answer,/40,000/);assert.doesNotMatch(merged.voiceBrief.answer,/Published breakdown|Desglose publicado/);assert.ok(!merged.text.includes(missing.answer));
  for(const changes of [{subject:'Pine Valley College'},{subject:'Eastview College — 2025–26'},{subject:'Eastview College — living with family'},{answer:'Housing eligibility requirements could not be confirmed.'}]){
   const other={...result,voiceBrief:{...result.voiceBrief,findings:[budget,{...missing,...changes}]}};
   assert.equal(reconcileResearchFindings(other),other);
  }
 });
 test(`${language}: a cost follow-up and explicit understanding keep the complete table visible`,()=>{
  const events=[],visuals=voiceVisualCards({now:()=>clock,emit:e=>events.push(e)});
  const question=es?'Costo de asistencia fuera del campus':'Cost of attendance off campus';
  visuals.trackResearch('cost',question);visuals.inputStarted();
  visuals.callerTurn(es?'¿No tengo que pagar todo lo que muestra?':'So I will not have to pay everything it shows there?');
  visuals.receiveResearch({id:'cost',status:'running',question,query:{requestKey:'cost',language},result:reconcileResearchFindings(result)});
  assert.equal(events.at(-1).present,true);
  visuals.callerTurn(es?'Claro, ya entiendo.':'Right, right, I remember that.');
  visuals.receiveResearch({id:'cost',status:'completed',question,query:{requestKey:'cost',language},result:reconcileResearchFindings(result)});
  const report=events.at(-1).report;assert.equal(events.at(-1).present,true);
  assert.equal(researchCostRows(report.table.rows,1,report.housingScenario).at(-1).cells[0].value,'$40,000');
  assert.equal(isResearchAcknowledgment(es?'Claro, ya entiendo.':'Right, right, I remember that.'),true);
  assert.equal(isResearchAcknowledgment(es?'Ya entiendo, pero cambia de tema.':'I remember, but change the topic.'),false);
 });
 test(`${language}: the table waits through speech and opens after a related follow-up, but not a new request`,()=>{
  for(const related of [true,false]){
   const events=[],visuals=voiceVisualCards({now:()=>clock,emit:e=>events.push(e)});
   const question=es?'Costo de asistencia fuera del campus':'Cost of attendance off campus';
   visuals.trackResearch('cost',question);visuals.inputStarted();
   visuals.receiveResearch({id:'cost',status:'completed',question,query:{requestKey:'cost',language},result:reconcileResearchFindings(result)});
   assert.equal(events[0].present,false);
   visuals.callerTurn(related?(es?'¿Qué gastos incluye?':'Which expenses does it include?'):(es?'Ayuda con ensayos':'Help with essays'));
   assert.equal(events.at(-1).present,related);
  }
 });
}
test('year-first annual budgets are totals, while semester prices and multiple alternatives are not',()=>{
 const render=answer=>researchCostRows([{aspect:'total_budget',cells:[{scope:'Eastview College — 2026–27 off-campus apartment',status:'verified',sources:[{}],answer,qualification:''}]}],1,'renting');
 const parts=' Published breakdown: Tuition and fees: $10,000; Housing: $20,000; Other expenses: $10,000.';
 assert.equal(render('2026–27 annual USD before-aid budget: $40,000.'+parts).at(-1).cells[0].value,'$40,000');
 for(const answer of ['$10,000 per semester.','$40,000 or $45,000 per academic year.'])assert.ok(!render(answer+parts).some(row=>row.id==='total_budget'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';
import {emptyResearchVisual,researchVisualReducer} from '../../src/researchVisualState.ts';
import {researchPortionObserved,researchScopeCompatible} from '../../src/researchDiscussion.mjs';
import {researchDelivery} from '../../src/researchDelivery.mjs';

test('confirmation, mixed housing rows and native speech reuse in English and Spanish',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated database required');return;}
 const c=await localClient();try{
  const lookup=createLocalCostLookup({query:c.query.bind(c)});
  for(const language of ['en','es'])await t.test(language,async()=>{
   const en=language==='en',question=en?'California resident undergraduate cost of attendance living off campus.':'Costo de asistencia para pregrado residente de California fuera del campus.';
   const result=await lookup({mode:'finance',language,institution:'UC Berkeley',question});
   let state=emptyResearchVisual;const events=[],v=voiceVisualCards({emit:e=>{events.push(e);state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});}});
   const job={id:'berkeley',status:'completed',result,question,query:{question,language,institution:'UC Berkeley',requestKey:'a'}};
   v.trackResearch('a',question);v.receiveResearch(job);
   assert.equal(state.reports[0].table.columns.length,2);
   v.presentRetained({...job,query:{...job.query,confirmedHousingChoice:'renting'}},true);
   assert.equal(state.reports.find(r=>r.id===state.view).table.columns.length,1);
   assert.equal(state.reports.find(r=>r.id.endsWith(':housing-options')).table.columns.length,2);
   const irq=en?'California resident cost of attendance renting off campus.':'Costo de asistencia para residente de California alquilando fuera del campus.';
   for(const institution of ['UC Davis','UC Irvine','UC Merced']){
    const next=await lookup({mode:'finance',language,institution,question:irq}),id=institution;
    v.trackResearch(id,irq);v.receiveResearch({id,status:'completed',result:next,question:irq,query:{requestKey:id,language,institution,question:irq,visualComparisonBaseId:state.view,visualComparisonCampus:institution}});
   }
   const report=state.reports.find(r=>r.id===state.view);assert.equal(report.table.columns.length,4);
   assert.ok(!report.table.columns.some(c=>/Living with family|Vivir con familiares/u.test(c)));
   const rows=researchCostRows(report.table.rows,4,report.housingScenario),combined=rows.find(r=>r.id==='housing_and_food');
   assert.equal(combined.cells[0].value,'$20,530');assert.equal(combined.cells[2].value,'$22,541');assert.equal(combined.cells[0].derived,true);
   assert.ok(!rows.some(r=>r.id==='housing'||r.id==='food'),'no double counting in the primary grid');
   const familyQ=en?'What if living with family? Cost of attendance for a California resident.':'¿Y si vive con familiares? Costo de asistencia para residente de California.';
   const family=await lookup({mode:'finance',language,institution:'UC Berkeley',question:familyQ});
   v.trackResearch('alternative',familyQ);v.receiveResearch({id:'alternative',status:'completed',result:family,question:familyQ,query:{requestKey:'alternative',language,institution:'UC Berkeley',question:familyQ,visualComparisonBaseId:state.view}});
   assert.equal(state.selectedHousing,undefined);assert.equal(state.reports.find(r=>r.id===state.view).table.columns.length,5,'an explicit alternative can restore a family column without a new search');
   const finding=result.voiceBrief.findings[0],spoken=en?'For Berkeley, the published 2026 to 2027 estimate for renting off campus is 49,692 dollars. It is a budget estimate, not a bill.':'Para Berkeley, la estimación publicada de 2026 a 2027 para alquilar fuera del campus es de 49,692 dólares. Es un presupuesto, no una factura.';
   assert.equal(researchScopeCompatible(finding,spoken),true);assert.equal(researchPortionObserved(finding,spoken),true);
   assert.equal(researchScopeCompatible(finding,spoken.replaceAll('2027','2028')),false);
   assert.equal(researchPortionObserved(finding,spoken.replace('49,692','99,999')),false);
   let now=0,seq=0;const sent=[],tasks=new Map();
   const d=researchDelivery({send:e=>sent.push(e),emit:()=>{},canAnnounce:()=>true,now:()=>now,id:()=>String(++seq),schedule:(fn,ms)=>{const id=++seq;tasks.set(id,{fn,at:now+ms});return id},cancel:id=>tasks.delete(id)});
   const advance=ms=>{const end=now+ms;while(true){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;};
   d.ready({jobId:'clarify',requestId:'r',revision:1,question,result});
   for(const e of sent.filter(e=>e.type==='session.thinking.append'))d.receive({type:'session.thinking.appended',client_event_id:e.event_id});
   advance(1000);assert.equal(sent.filter(e=>e.type==='session.commentary.append').length,1);
   assert.match(sent.find(e=>e.type==='session.commentary.append').content,/rent|alquil/iu);
   advance(5000);assert.equal(sent.filter(e=>e.type==='session.commentary.append').length,1,'clarification is not repeated');d.clear();
   const one={...result,voiceBrief:{...result.voiceBrief,nextStep:'',findings:[finding]}};
   sent.length=0;d.ready({jobId:'native',requestId:'r2',revision:1,question,result:one});
   for(const e of sent.filter(e=>e.type==='session.thinking.append'))d.receive({type:'session.thinking.appended',client_event_id:e.event_id});
   d.reply(spoken,{audible:true});advance(3000);assert.equal(sent.filter(e=>e.type==='session.commentary.append').length,0,'no repeat after the complete native headline');d.clear();
  });
 }finally{await c.end();}
});

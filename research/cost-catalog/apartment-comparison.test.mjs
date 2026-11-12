import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {campusHousingRequest} from './scope.mjs';
import {costComparisonFacts} from '../../src/costComparison.mjs';
import {studentLiveChannel} from '../../src/studentLiveChannel.mjs';
import {scopeFinanceHousing} from '../../server/voice-housing-scope.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {emptyResearchVisual,researchVisualReducer,visibleResearchReport} from '../../src/researchVisualState.ts';
import {researchCostRows} from '../../src/researchCostRows.ts';

test('campus apartment recognition separates halls, apartments, studios and explicit negatives',()=>{
 for(const q of ['an on-campus apartment','an apartment on campus','un apartamento dentro del campus','apartamento en el campus']){
  assert.equal(campusHousingRequest(q).form,'apartment');
  assert.equal(scopeFinanceHousing(q+' cost of attendance','renting','en'),q+' cost of attendance','known off-campus plan cannot overwrite an explicit campus alternative');
 }
 for(const q of ['on-campus studio apartment','apartamento estudio dentro del campus'])assert.equal(campusHousingRequest(q).form,'studio');
 assert.equal(campusHousingRequest('on-campus residence hall').form,'residence_hall');
 for(const q of ['an off-campus apartment','an apartment not on campus','apartamento no dentro del campus'])assert.equal(campusHousingRequest(q),undefined);
});

test('isolated apartment lookup and arithmetic evidence reach the quiet voice channel in both languages',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated database required');return;}
 const c=await localClient();
 try{const lookup=createLocalCostLookup({query:c.query.bind(c)});
  for(const language of ['en','es'])await t.test(language,async()=>{
   const en=language==='en';
   const request=(institution,question)=>lookup({mode:'finance',language,institution,question});
   const apartment=await request('UC Davis',en?'California-resident undergraduate cost of attendance in an on-campus apartment.':'Costo de asistencia para pregrado residente de California en un apartamento dentro del campus.');
   assert.equal(apartment.voiceBrief.findings.length,1);assert.equal(apartment.voiceBrief.nextStep,'');
   const finding=apartment.voiceBrief.findings[0];
   assert.equal(finding.budget.housing,'on_campus');assert.equal(finding.budget.total,47803);
   assert.match(finding.subject,en?/On-campus apartment/:/Apartamento en el campus/);
   let state=emptyResearchVisual;
   const visuals=voiceVisualCards({emit:e=>{if(e.type==='origen.visual.research')state=researchVisualReducer(state,{type:'receive',report:e.report,present:e.present});}});
   const question=en?'UC Davis cost of attendance in an on-campus apartment.':'Costo de asistencia UC Davis en un apartamento dentro del campus.';
   visuals.trackResearch('apartment',question);visuals.receiveResearch({id:'apartment',status:'completed',question,query:{requestKey:'apartment',language,institution:'UC Davis'},result:apartment});
   const table=state.reports[0];
   assert.equal(table.table.columns.length,1);assert.match(researchCostRows(table.table.rows,1).find(r=>r.id==='total_budget').cells[0].value,/47,803/);
   state=researchVisualReducer(state,{type:'hideColumn',column:table.table.columns[0]});
   assert.equal(visibleResearchReport(state.reports[0],state.hiddenColumns).table.columns.length,0);
   state=researchVisualReducer(state,{type:'restoreColumns'});assert.equal(visibleResearchReport(state.reports[0],state.hiddenColumns).table.columns.length,1);
   const hall=await request('UC Davis',en?'California-resident undergraduate cost of attendance in a campus residence hall.':'Costo de asistencia para pregrado residente de California en residencias universitarias.');
   assert.notEqual(hall.voiceBrief.findings[0].budget.total,finding.budget.total,'apartment must not silently use the hall budget');
   const studio=await request('UC Davis',en?'California-resident undergraduate cost of attendance in an on-campus studio apartment.':'Costo de asistencia para pregrado residente de California en un apartamento estudio dentro del campus.');
   assert.equal(studio.voiceBrief.findings.length,1);assert.match(studio.voiceBrief.findings[0].subject,en?/studio/:/estudio/);
   const rental=en?'California-resident undergraduate cost of attendance renting off campus.':'Costo de asistencia para pregrado residente de California alquilando fuera del campus.';
   const davis=await request('UC Davis',rental),berkeley=await request('UC Berkeley',rental),riverside=await request('UC Riverside',rental);
   const facts=costComparisonFacts(riverside,[davis,berkeley]);
   assert.equal(facts.peers.find(p=>p.subject==='UC Davis').totalDifference,-431);
   const feeFacts=costComparisonFacts(davis,[berkeley]);
   assert.equal(feeFacts.peers[0].totalDifference,-4932);assert.equal(feeFacts.peers[0].tuitionFeesDifference,49);
   const sent=[],observed=[],raw={send:text=>sent.push(JSON.parse(text)),close(){}};
   const channel=studentLiveChannel(raw,{isPlaybackIdle:()=>false,researchDeliveryV2:true});
   channel.onmessage=event=>observed.push(JSON.parse(event.data));
   try{
    channel.configure({voiceProvider:'live',voiceSession:{language,tools:[]}});
    await raw.onmessage({data:JSON.stringify({type:'session.started'})});sent.length=0;
    channel.send(JSON.stringify({type:'origen.research.comparisons',comparisons:facts}));
    assert.ok(sent.length);assert.ok(sent.every(e=>e.type==='session.thinking.append'&&e.delegation_id===null));
    assert.ok(sent.every(e=>Buffer.byteLength(e.content)<=480));
    const packets=sent.map(e=>JSON.parse(e.content));
    const reconstructed=JSON.parse(packets.map(p=>p.text).join(''));
    assert.equal(reconstructed.peers.find(p=>p.subject==='UC Davis').totalDifference,-431);
    assert.equal(sent.some(e=>e.type==='session.commentary.append'||e.type==='session.instructions.append'),false,'math adds no speech turn or forced pivot');
    assert.ok(observed.some(e=>e.deliveryStage==='comparison_context_supplied'));
    for(const event of sent)await raw.onmessage({data:JSON.stringify({type:'session.thinking.appended',client_event_id:event.event_id})});
    assert.equal(observed.filter(e=>e.deliveryStage==='comparison_context_acknowledged').length,1,'all packet acknowledgments are logged separately from spoken delivery');
   }finally{channel.close();}
  });
 }finally{await c.end();}
});

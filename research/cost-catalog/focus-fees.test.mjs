import test from 'node:test';
import assert from 'node:assert/strict';
import {localClient} from './postgres.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {voiceControlSession} from '../../server/voice-control.mjs';
import {emptyResearchVisual,researchVisualReducer} from '../../src/researchVisualState.ts';
import {researchCostRows} from '../../src/researchCostRows.ts';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<300;n++){if(check())return;await pause(10);}assert.fail('local delivery timeout');}

test('cost desk retains campuses through focus changes and answers excluded-living-cost fee requests',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated database required');return;}
 const c=await localClient();
 try{for(const language of ['en','es'])await t.test(language,async()=>{
  const en=language==='en',sent=[],posts=[],jobs=new Map();let state=emptyResearchVisual;
  const lookup=createLocalCostLookup({query:c.query.bind(c)});
  const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},researchDeliveryV2:true,visualCards:true,
   config:{language,instructions:'Isolated fictional student',housingPlan:'renting',routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]},
   scope:{sessionId:'isolated-focus-fees-'+language,studentId:'fictional',confirmed:true},
   emit:event=>{if(event.type==='origen.visual.research')state=researchVisualReducer(state,{type:'receive',report:event.report,present:event.present});},
   jobRequest:async(method,id,query)=>{
    if(method==='POST'){posts.push(query);const key='job-'+posts.length;jobs.set(key,await lookup(query));return {id:key,status:'queued'};}
    return {id,status:'completed',result:jobs.get(id)};
   }});
  engine.start();
  const request=async(campus,words,question)=>{
   engine.receive({type:'session.input_transcript.delta',delta:words});await pause(0);await engine.flush();
   const index=posts.length+1,id='response-'+index;
   for(const event of [{type:'response.created',response:{id}},
    {type:'response.output_item.done',response_id:id,item:{type:'function_call',name:'lookup_financial_aid',call_id:'request-'+index,arguments:JSON.stringify({institution:campus,question})}},
    {type:'response.completed',response:{id,status:'completed'}}])engine.receive({type:'response.event',delegation_id:'delegation-'+index,event});
   await until(()=>state.reports.some(r=>r.id==='job-'+index));
   const report=state.reports.find(r=>r.id===state.view);
   engine.receive({type:'session.output_transcript.delta',delta:en?'The figure is available.':'El importe está disponible.'});await pause(0);await engine.flush();
   return report;
  };
  try{
   const coa=en?'California-resident undergraduate cost of attendance renting off campus.':'Costo de asistencia para pregrado residente de California alquilando fuera del campus.';
   let report=await request('UC Berkeley',en?'The cost for UC Berkeley.':'El costo de UC Berkeley.',coa);
   assert.equal(report.table.columns.length,1);
   report=await request('UC Davis',en?'What about UC Davis?':'¿Y UC Davis?',coa);
   assert.equal(report.table.columns.length,2);
   const mathPackets=sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)).filter(p=>p.kind==='computed-cost-comparisons');
   assert.ok(mathPackets.length,'controller supplies arithmetic without another model call');
   const group=mathPackets.at(-1).resultId;
   const comparison=JSON.parse(mathPackets.filter(p=>p.resultId===group).map(p=>p.text).join(''));
   assert.equal(comparison.peers[0].totalDifference,-4932);assert.equal(comparison.peers[0].tuitionFeesDifference,49);
   report=await request('UC Merced',en?"Actually, let’s look at UC Merced.":'Mejor veamos UC Merced.',coa);
   assert.equal(report.table.columns.length,3,'spoken focus changes do not clear the desk');
   report=await request('UC Irvine',en?'What about UC Irvine?':'¿Y UC Irvine?',coa);
   assert.equal(report.table.columns.length,4);
   const query=en?'UC Irvine undergraduate tuition and mandatory fees charged by the university, excluding estimated housing, food and other living expenses. Provide the published amount and cohort qualifications.':
    'Matrícula y cuotas obligatorias de UC Irvine para pregrado residente de California, excluyendo vivienda, alimentación y otros gastos de vida. Indica el año y las condiciones.';
   report=await request('UC Irvine',en?'What are the required fees?':'¿Cuáles son las cuotas obligatorias?',query);
   const fees=jobs.get('job-5');
   assert.equal(fees.voiceBrief.findings.length,1);assert.equal(fees.voiceBrief.findings[0].aspect,'tuition_fees');
   assert.equal(fees.voiceBrief.nextStep,'','fee request must not reopen housing confirmation');
   assert.match(fees.voiceBrief.findings[0].answer,/20,289/);
   assert.match(fees.voiceBrief.findings[0].qualification,/insurance|fee composition|seguro|composición/);
   assert.equal(report.table.columns.length,4,'fee follow-up preserves all campus columns');
   const rows=researchCostRows(report.table.rows,4,report.housingScenario);
   assert.ok(rows.find(r=>r.id==='total_budget').cells.every(cell=>cell.value));
   const irvine=report.table.columns.findIndex(name=>name.includes('Irvine'));
   assert.match(rows.find(r=>r.id==='tuition_fees').cells[irvine].value,/20,289/);
   assert.equal(posts.length,5,'no recovery lookup triggered by excluded living expenses');
   const updates=sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content)).filter(p=>p.kind==='computed-cost-comparisons');
   const lastUpdate=updates.at(-1).resultId;
   assert.equal(JSON.parse(updates.filter(p=>p.resultId===lastUpdate).map(p=>p.text).join('')).state,'no_comparable_budgets','old comparison cues are cleared when the latest answer is fee-only');
   assert.ok(!sent.some(e=>e.type==='session.instructions.append'||e.type==='response.cancel'));
  }finally{engine.close();}
 });}finally{await c.end();}
});

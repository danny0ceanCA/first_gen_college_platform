import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceVisualCards} from './voice-visual-cards.mjs';
import {researchCostRows} from '../src/researchCostRows.ts';
import {createResearchTask} from '../src/researchTask.mjs';
import {publicRecord} from './research-record.fixtures.mjs';

const clock=Date.parse('2026-11-10T12:00:00Z');
function comparison(language,status='completed'){
 const checkedAt=new Date(clock-1000).toISOString();
 const sources=['eastview','pinevalley'].map(school=>({title:'Published policy',url:`https://${school}.edu/admissions`,checkedAt}));
 const qualification=language==='es'?'Solo para estudiantes de primer año.':'For first-year students only.';
 const findings=[
  {subject:'Eastview College — Fall 2027',aspect:'deadline',answer:'January 15 [1].',status:'verified'},
  {subject:'Pine Valley College — Fall 2027',aspect:'deadline',answer:'February 1 [2].',status:status==='running'?'unverified':'verified'},
  {subject:'Eastview College — Fall 2027',aspect:'tuition_fees',answer:'$500 [1].',status:'verified'},
 ].map(finding=>({...finding,qualification}));
 return {id:'job',status,query:{requestKey:'request',language},
  result:{checkedAt,sources,voiceBrief:{status:'verified',answer:findings[0].answer,qualification,nextStep:'',findings}}};
}
const setup=()=>{
 const events=[];
 return {events,visuals:voiceVisualCards({emit:event=>events.push(event),now:()=>clock})};
};

for(const language of ['en','es'])test(`${language}: an explicitly requested program supplies its campus column without matching unrelated programs`,()=>{
 const es=language==='es',program=es?'Iniciativa de Primera Generación':'First-Generation Initiative';
 const question=es?`¿Cuál es el correo de contacto de la ${program} de Eastview College?`:`What is the contact email for the ${program} at Eastview College?`;
 for(const variant of ['matching','different_campus','different_program','unrequested_program','missing_program_scope']){
  const {events,visuals}=setup(),job=comparison(language),evidence=publicRecord('student_support',language);
  evidence.scope.program=variant==='missing_program_scope'?null:program;evidence.complete=false;
  evidence.facts=evidence.facts.map(fact=>({...fact,status:'unverified',value:null}));
  const subject=(variant==='different_campus'?'Pine Valley College':'Eastview College')+' '+(variant==='different_program'?'Other Program':program);
  const request=variant==='unrequested_program'?(es?'¿Cuál es el contacto de Eastview College?':'What is the contact for Eastview College?'):question;
  job.question=request;job.result.researchTask=createResearchTask({question:request,language,institution:'Eastview College'});
  job.result.voiceBrief={status:'partial',answer:'The contact email is unverified. [1]',qualification:'Exact address could not be verified. [1]',nextStep:'',findings:[{subject,aspect:'other',status:'partial',answer:'Contact email is unverified. [1]',qualification:'Exact address could not be verified. [1]',evidence}]};
  visuals.trackResearch('request',request);visuals.receiveResearch(job);
  const table=events.at(-1).report.table;
  assert.deepEqual(table.columns,variant==='matching'?[subject]:[subject,'Eastview College'],variant);
  if(variant!=='matching')assert.equal(table.rows[0].cells.at(-1),null,variant);
 }
});

for(const language of ['en','es'])test(`${language}: an explicit published rental benchmark shows its full breakdown while housing is unconfirmed`,()=>{
 const {events,visuals}=setup(),es=language==='es',checkedAt=new Date(clock-1000).toISOString();
 const question=es?'Costo de asistencia fuera del campus, modalidad sin especificar.':'Cost of attendance off campus, arrangement unspecified.';
 const qualification=es?'Referencia de alquiler 2026–27; modalidad de vivienda sin confirmar. [1]':'2026–27 assumed rental benchmark; housing choice unconfirmed. [1]';
 const finding={subject:'Eastview College — 2026–27',aspect:'total_budget',status:'partial',qualification,
  answer:es?'US$40,000 para el año académico, alquiler fuera del campus. Desglose publicado: Matrícula y cuotas: $10,000; Vivienda: $20,000; Alimentación: $4,000; Libros: $1,000; Transporte: $1,000; Gastos personales: $1,000; Seguro médico: $3,000. [1]':
   'US$40,000 for the academic year, renting off campus. Published breakdown: Tuition and fees: $10,000; Housing: $20,000; Food: $4,000; Books: $1,000; Transportation: $1,000; Personal: $1,000; Insurance: $3,000. [1]'};
 const job={id:'benchmark',question,status:'completed',query:{requestKey:'benchmark',language},result:{checkedAt,
  sources:[{url:'https://eastview.edu/costs',checkedAt}],voiceBrief:{status:'partial',answer:'Published benchmark $40,000 [1].',qualification,nextStep:'',findings:[finding]}}};
 visuals.trackResearch('benchmark',question);visuals.receiveResearch(job);
 const report=events.at(-1).report;
 assert.equal(report.housingBenchmark,true);
 assert.equal(report.housingScenario,'renting');
 const rows=researchCostRows(report.table.rows,1,report.housingScenario);
 assert.equal(rows.length,8);
 assert.equal(rows.at(-1).id,'total_budget');
 assert.equal(rows.at(-1).cells[0].value,'US$40,000');
 assert.equal(rows.find(row=>row.id==='transportation').cells[0].value,'$1,000');
 assert.match(report.table.rows[0].cells[0].scope,/2026–27/);
 visuals.presentRetained({...job,query:{...job.query,confirmedHousingChoice:'renting'}},true);
 assert.equal(events.at(-1).report.housingBenchmark,undefined);
 assert.equal(events.at(-1).report.housingScenario,'renting');
});

test('a failed added campus remains visible without clearing the retained campus',()=>{
 const {events,visuals}=setup();
 visuals.trackResearch('failed-addition','What about UC Davis?');
 visuals.receiveResearch({id:'failed',status:'failed',question:'UC Davis cost',query:{
  requestKey:'failed-addition',institution:'UC Davis; UC Berkeley',visualComparisonCampus:'UC Davis',visualComparisonBaseId:'berkeley',
 }});
 assert.equal(events.length,1);
 assert.equal(events[0].report.comparisonReferenceId,'berkeley');
 assert.deepEqual(events[0].report.table.columns,['UC Davis']);
 assert.deepEqual(events[0].report.table.unverifiedTotals,['UC Davis']);
});

test('annual tuition remains visible while the off-campus housing choice is unresolved',()=>{
 const scope='UC Berkeley — incoming 2026–27 California-resident undergraduate transfer';
 const tuition={scope,status:'verified',sources:[{url:'https://registrar.berkeley.edu/'}],
  answer:'For fall and spring 2026–27, recurring tuition and mandatory fees total US$18,214: tuition $14,202; Student Services Fee $1,386. These annual amounts double the Registrar’s published semester rates. [1]',
  qualification:'Excludes health insurance and the new-student document fee.'};
 const total={...tuition,status:'partial',answer:'Separate budgets apply to an off-campus apartment and living with relatives.'};
 const render=cell=>researchCostRows([{aspect:'total_budget',cells:[total]},{aspect:'tuition_fees',cells:[cell]}],1,'off_campus');
 assert.deepEqual(render(tuition).map(row=>[row.id,row.cells[0]?.value]),[['tuition_fees','US$18,214']]);
 assert.deepEqual(render({...tuition,answer:'For fall and spring 2026–27, tuition and mandatory fees total US$9,107 per semester.'}),[]);
});

test('published renter budgets use one comparable tuition row with detailed fee schedules retained in source evidence',()=>{
 const {events,visuals}=setup();
 const checkedAt=new Date(clock-1000).toISOString();
 const sources=[{url:'https://ucdavis.edu/costs',checkedAt},{url:'https://berkeley.edu/costs',checkedAt}];
 const qualification='Published academic-year budget before aid. Campus fees rounded in the budget.';
 const findings=[
  {subject:'UC Davis',aspect:'total_budget',answer:'$44,760 USD before aid for three quarters, renting off campus, not with parents. Published breakdown: Systemwide tuition/fees: $15,588; Campus fees: $2,490; Insurance: $3,924; Document fee: $185; Housing: $11,160; Food: $5,891; Books/supplies: $1,240; Personal: $2,717; Transportation: $1,565. [1]'},
  {subject:'UC Davis',aspect:'tuition_fees',answer:'USD $18,077.13 for full-time fall, winter and spring: Tuition: $14,202; Student Services Fee: $1,386; Campus-based fees: $2,489.13. [1]'},
  {subject:'UC Berkeley',aspect:'total_budget',answer:'USD $49,692 for the academic year, before aid, renting an off-campus apartment. Published breakdown: Tuition/fees: $18,214; SHIP insurance: $5,066; Housing/utilities: $14,386; Food: $6,144; Books/course materials/supplies/equipment: $1,342; Miscellaneous/personal: $3,302; Transportation: $1,238. [2]'},
  {subject:'UC Berkeley',aspect:'tuition_fees',answer:'Annual tuition/mandatory-fee subtotal: $18,214 USD. Tuition: $14,202. Annual figures double the published semester charges. [2]'},
 ].map(finding=>({...finding,qualification,status:'verified'}));
 const question='Compare the costs of living off campus and renting (not living with parents).';
 visuals.trackResearch('budget',question);
 visuals.receiveResearch({id:'budget',status:'completed',question,query:{requestKey:'budget'},result:{checkedAt,sources,voiceBrief:{
  status:'verified',answer:'UC Davis $44,760 [1]; UC Berkeley $49,692 [2].',qualification,nextStep:'',findings,
 }}});
 const {table,housingScenario}=events[0].report;
 const rows=researchCostRows(table.rows,table.columns.length,housingScenario);
 assert.deepEqual(Object.fromEntries(rows.map(row=>[row.id,row.cells.map(cell=>cell?.value??null)])),{
  total_budget:['$44,760','$49,692'],tuition_fees:['$18,078','$18,214'],
  housing:['$11,160','$14,386'],food:['$5,891','$6,144'],books:['$1,240','$1,342'],transportation:['$1,565','$1,238'],
  personal:['$2,717','$3,302'],health_insurance:['$3,924','$5,066'],document_fee:['$185',null],
 });
 assert.deepEqual(rows.find(row=>row.id==='tuition_fees').cells.map(cell=>cell.feeScheduleOnly),[false,false]);
 assert.deepEqual(rows.find(row=>row.id==='tuition_fees').cells[0].feeDetail,{budget:'$18,078',schedule:'$18,077.13',difference:'$0.87',rounded:true});
 for(let column=0;column<table.columns.length;column++){
  const toNumber=cell=>Number(cell.value.replace(/[$,]/g,''));
  const components=rows.filter(row=>row.id!=='total_budget').map(row=>row.cells[column]).filter(cell=>cell&&!cell.feeScheduleOnly);
  assert.equal(components.reduce((sum,cell)=>sum+toNumber(cell),0),toNumber(rows.at(-1).cells[column]));
 }
 const combined=table.rows.map(row=>row.aspect==='total_budget'?{...row,cells:row.cells.map((cell,index)=>index===0?{
  ...cell,answer:cell.answer.replace('Systemwide tuition/fees: $15,588; Campus fees: $2,490','Tuition and fees: $18,078'),
 }:cell)}:row);
 const combinedRows=researchCostRows(combined,table.columns.length,housingScenario);
 assert.equal(combinedRows.find(row=>row.id==='tuition_fees').cells[0].value,'$18,078');
 assert.ok(!combinedRows.some(row=>['tuition_fees_budget','systemwide_fees','campus_fees'].includes(row.id)));
 assert.match(table.rows.find(row=>row.aspect==='tuition_fees').cells[0].answer,/18,077\.13/u);
 assert.equal(rows.at(-1).id,'total_budget','the published total follows its components');
 for(const [answer,qualification] of [
  ['Annual US$18,077.13 for fall, winter and spring: Tuition: $14,202; Student Services Fee: $1,386; Campus-based fees: $2,489.13.','Campus fees rounded in the budget.'],
  ['Anual US$18,077.13 para otoño, invierno y primavera: Matrícula: $14,202; Cuotas: $3,875.13.','Cuotas redondeadas en el presupuesto.'],
 ]){
  const schedule=table.rows.map(row=>row.aspect==='tuition_fees'?{...row,cells:row.cells.map((cell,index)=>index===0?{...cell,answer,qualification}:cell)}:row);
  const fee=researchCostRows(schedule,table.columns.length,housingScenario).find(row=>row.id==='tuition_fees').cells[0];
  assert.equal(fee.value,'$18,078');assert.equal(fee.feeDetail.schedule,'US$18,077.13');assert.equal(fee.feeDetail.difference,'$0.87');assert.equal(fee.feeDetail.rounded,true);
 }
});

for(const language of ['en','es'])test(`${language}: a transportation line followed by subtotal sentences remains a verified line item`,()=>{
 const cell={scope:'UC Berkeley — 2026–27 off-campus apartment',status:'verified',sources:[],qualification:'Published budget, not a bill.',
  answer:language==='en'
   ? 'USD $49,692 for the 2026–27 academic year, renting an off-campus apartment, before aid. Published breakdown: Tuition and fees: $18,214; SHIP insurance: $5,066; Housing and utilities: $14,386; Food: $6,144; Books, course materials, supplies and equipment: $1,342; Miscellaneous and personal: $3,302; Transportation: $1,238. University charges: $23,280; estimated indirect expenses: $26,412. [1]'
   : 'USD $49,692 para el año académico, alquiler fuera del campus, antes de la ayuda. Desglose publicado: Matrícula y cuotas: $18,214; Seguro médico: $5,066; Vivienda: $14,386; Alimentación: $6,144; Libros y materiales: $1,342; Gastos personales: $3,302; Transporte: $1,238. Cargos universitarios: $23,280; gastos indirectos: $26,412. [1]'};
 const rows=researchCostRows([{aspect:'total_budget',cells:[cell]}],1,'renting');
 assert.equal(rows.find(row=>row.id==='transportation').cells[0].value,'$1,238');
 assert.equal(rows.at(-1).id,'total_budget');
 assert.equal(rows.slice(0,-1).reduce((sum,row)=>sum+Number(row.cells[0].value.replace(/[^0-9.]/gu,'')),0),49692);
 const decimal={...cell,answer:cell.answer.replace('Transportation: $1,238.','Transportation: $1,238.25.').replace('Transporte: $1,238.','Transporte: $1,238.25.')};
 assert.equal(researchCostRows([{aspect:'total_budget',cells:[decimal]}],1,'renting').find(row=>row.id==='transportation').cells[0].value,'$1,238.25');
});

for(const language of ['en','es'])test(`${language}: a cited partial published total retains its amount, components and discrepancy without becoming verified`,()=>{
 const cell={scope:'UC Berkeley — 2026–27 new resident undergraduate, off-campus apartment rental',
  status:'partial',sources:[{url:'https://berkeley.edu/costs'}],
  answer:language==='en'
   ? 'US$49,692 before aid for the academic year. Published breakdown: Tuition and fees: $18,214; SHIP: $5,066; Housing and utilities: $14,386; Food: $6,144; Books, materials, supplies and equipment: $1,342; Miscellaneous and personal: $3,302; Transportation: $1,238. [1]'
   : 'US$49,692 antes de la ayuda para el año académico. Desglose publicado: Matrícula y cuotas: $18,214; Seguro médico: $5,066; Vivienda y servicios públicos: $14,386; Alimentación: $6,144; Libros y materiales: $1,342; Gastos personales: $3,302; Transporte: $1,238. [1]',
  qualification:language==='en'?'Another published page gives $49,420. The new-student $250 document fee is excluded.':'Otra página publicada indica $49,420. Se excluye la cuota de documentación de $250.',
 };
 const rows=researchCostRows([{aspect:'total_budget',cells:[cell]}],1,'renting');
 assert.equal(rows.find(row=>row.id==='total_budget').cells[0].value,'US$49,692');
 assert.equal(rows.find(row=>row.id==='total_budget').cells[0].evidence.status,'partial');
 assert.equal(rows.find(row=>row.id==='total_budget').cells[0].evidence.qualification,cell.qualification);
 assert.equal(rows.find(row=>row.id==='books').cells[0].value,'$1,342');
 assert.equal(rows.find(row=>row.id==='personal').cells[0].value,'$3,302');
 assert.equal(rows.filter(row=>row.id!=='total_budget').reduce((total,row)=>total+Number(row.cells[0].value.replace(/[^0-9.]/g,'')),0),49692);
 for(const omitted of [{...cell,status:'unverified'},{...cell,sources:[]}]){
  const unavailable=researchCostRows([{aspect:'total_budget',cells:[omitted]}],1,'renting');
  assert.ok(!unavailable.some(row=>row.id==='total_budget'));
 }
});

for(const language of ['en','es'])test(`${language}: the published cost breakdown keeps its scenario and survives comparison reuse`,()=>{
 const {events,visuals}=setup(),es=language==='es';
 const checkedAt=new Date(clock-1000).toISOString(),qualification=es?'Presupuesto anual antes de la ayuda.':'Academic-year budget before aid.';
 const subject='Eastview College — 2026–27',second='Pine Valley College — 2026–27';
 const answer=es?'Costo total: $20,000; alquiler fuera del campus. Desglose publicado: Matrícula y cuotas: $9,000; Alojamiento y alimentación: $8,000; Libros y materiales: $1,000; Transporte: $1,000; Seguro médico: $1,000 [1].':
  'Total cost: $20,000; renting off campus. Published breakdown: Tuition and fees: $9,000; Housing and food: $8,000; Books and supplies: $1,000; Transportation: $1,000; Health insurance: $1,000 [1].';
 const finding={subject,aspect:'total_budget',status:'verified',answer,qualification};
 const job={id:'budget',status:'completed',question:es?'Costo de asistencia con alquiler fuera del campus':'Cost of attendance renting off campus',
  query:{requestKey:'budget',language},result:{checkedAt,sources:[{url:'https://eastview.edu/costs',title:'Campus budget',checkedAt}],voiceBrief:{
   status:'verified',answer:es?'El presupuesto es de $20,000 [1].':'The budget is $20,000 [1].',qualification,nextStep:'',findings:[finding],
  }}};
 visuals.trackResearch('budget',job.question);visuals.receiveResearch(job);
 const render=report=>Object.fromEntries(researchCostRows(report.table.rows,report.table.columns.length,report.housingScenario)
  .map(row=>[row.id,row.cells.map(cell=>cell?.value||null)]));
 assert.deepEqual(render(events.at(-1).report),{total_budget:['$20,000'],housing_and_food:['$8,000'],books:['$1,000'],transportation:['$1,000'],health_insurance:['$1,000'],tuition_fees:['$9,000']});
 visuals.presentRetained({...job,question:es?'Costo de asistencia viviendo con familiares':'Cost of attendance living with family'},true);
 assert.deepEqual(render(events.at(-1).report),{});
 const newer={...job,id:'updated',question:es?'Costo de asistencia viviendo con familiares':'Cost of attendance living with family',result:{...job.result,sources:[...job.result.sources,{url:'https://pinevalley.edu/costs',title:'Campus budget',checkedAt}],voiceBrief:{
  ...job.result.voiceBrief,findings:[finding,{...finding,subject:second,answer:es?'Costo total: $24,000 viviendo con familiares. Desglose publicado: Alojamiento: $10,000; Alimentación: $2,000 [2].':
   'Total cost: $24,000 living with family. Published breakdown: Housing: $10,000; Food: $2,000 [2].'}],
 }}};
 visuals.presentRetained(newer,true);
 const rows=render(events.at(-1).report);
 assert.deepEqual(rows.total_budget,['$20,000','$24,000']);
 assert.deepEqual(rows.housing_and_food,['$8,000',null]);
 assert.deepEqual(rows.food,[null,'$2,000']);
 assert.deepEqual(rows.housing,[null,'$10,000']);
 assert.deepEqual(rows.tuition_fees,['$9,000',null]);
});

for(const [language,normal,ack] of [
 ['en','Compare admissions deadlines at both schools.','Mm-hmm.'],
 ['es','Compara las fechas límite de las dos universidades.','Ajá.'],
]){
 test(`${language}: only a linked job with verified evidence opens a table, and later evidence fills that table`,()=>{
  const {events,visuals}=setup();
  visuals.callerTurn(normal);
  visuals.receiveResearch(comparison(language));
  assert.deepEqual(events,[]);
  visuals.trackResearch('request');
  visuals.inputStarted();
  visuals.callerTurn(ack);
  visuals.receiveResearch(comparison(language,'running'));
  visuals.receiveResearch(comparison(language));
  assert.deepEqual(events.map(event=>[event.report.id,event.report.pending,event.present]),[['job',true,true],['job',false,true]]);
  const [initial,complete]=events.map(event=>event.report);
  assert.deepEqual(initial.table.columns,['Eastview College','Pine Valley College']);
  assert.equal(initial.table.rows[0].cells[1],null);
  const pineValley=complete.table.rows[0].cells[1];
  assert.equal(complete.language,language);
  assert.equal(pineValley.scope,'Pine Valley College — Fall 2027');
  assert.match(pineValley.qualification,/first-year|primer año/u);
  assert.equal(pineValley.sources[0].url,'https://pinevalley.edu/admissions');
 });
}

test('a result after a topic change is saved quietly and an ordinary teaching question opens nothing',()=>{
 const {events,visuals}=setup();
 visuals.callerTurn('Show me a chart for choosing a major.');
 assert.deepEqual(events,[]);
 visuals.trackResearch('request');
 visuals.callerTurn('How does work-study work?');
 visuals.receiveResearch(comparison('en'));
 assert.equal(events.length,1);
 assert.equal(events[0].present,false);
});

test('Alright keeps research in focus and an overlapping acknowledgment opens the full table',()=>{
 const {events,visuals}=setup();
 visuals.trackResearch('request');
 visuals.callerTurn('Alright');
 visuals.receiveResearch(comparison('en','running'));
 visuals.inputStarted();
 visuals.receiveResearch(comparison('en'));
 visuals.callerTurn('All right.');
 assert.deepEqual(events.map(event=>event.present),[true,true,true]);
 assert.equal(events.at(-1).report.pending,false);
});

for(const [language,reply] of [['en','Repeat that'],['es','¿Puedes repetirlo?']])test(`${language}: a repeat request keeps incoming comparison results visible`,()=>{
 for(const finishesDuringSpeech of [true,false]){
  const {events,visuals}=setup();
  visuals.trackResearch('request');
  visuals.inputStarted();
  if(finishesDuringSpeech)visuals.receiveResearch(comparison(language));
  visuals.callerTurn(reply);
  if(!finishesDuringSpeech)visuals.receiveResearch(comparison(language));
  assert.equal(events.at(-1).present,true);
  assert.equal(events.at(-1).report.table.columns.length,2);
 }
});

test('completed research about one institution can still make a table',()=>{
 const {events,visuals}=setup();
 visuals.trackResearch('request');
 const job=comparison('en');
 job.result.voiceBrief.findings.splice(1,1);
 visuals.receiveResearch(job);
 assert.deepEqual(events[0].report.table.columns,['Eastview College']);
 assert.equal(events[0].report.table.rows.length,2);
});

test('canceled or previous-scope work cannot reopen or repopulate history',()=>{
 const {events,visuals}=setup();
 visuals.trackResearch('request');
 visuals.cancelResearch();
 visuals.receiveResearch(comparison('en'));
 visuals.trackResearch('request');
 visuals.reset();
 visuals.receiveResearch(comparison('en'));
 assert.deepEqual(events,[{type:'origen.visual.research.reset'}]);
});

test('an unavailable campus still produces a comparison column without inventing amounts',()=>{
 const {events,visuals}=setup();
 visuals.trackResearch('request');
 const job=comparison('en');
 for(const finding of job.result.voiceBrief.findings)finding.status='unverified';
 visuals.receiveResearch(job);
 assert.equal(events.length,1);
 assert.ok(events[0].report.table.rows.every(row=>row.cells.every(cell=>cell===null)));
 assert.deepEqual(events[0].report.table.unverifiedCells,[
  {column:'Eastview College',aspect:'deadline'},
  {column:'Pine Valley College',aspect:'deadline'},
  {column:'Eastview College',aspect:'tuition_fees'},
 ]);
});

test('only server-validated addition lineage is exposed for merging visual history',()=>{
 for(const [query,expected] of [
  [{retainedComparisonJobId:'base'},'base'],
  [{comparisonBaseJobId:'base',comparisonChange:'living with family'},undefined],
  [{},undefined],
 ]){
  const {events,visuals}=setup(),job=comparison('en');
  job.query={...job.query,...query};
  visuals.trackResearch('request');visuals.receiveResearch(job);
  assert.equal(events[0].report.comparisonBaseId,expected);
 }
});

test('expired previously verified amounts are not published as fresh table evidence',()=>{
 const {events,visuals}=setup(),job=comparison('en');
 job.result.checkedAt=new Date(clock-24*60*60*1000).toISOString();
 job.result.sources=job.result.sources.map(source=>({...source,checkedAt:job.result.checkedAt}));
 visuals.trackResearch('request');visuals.receiveResearch(job);
 assert.deepEqual(events,[]);
});

test('a short rental answer keeps a scoped college report eligible to open',()=>{
 const question='Off-campus arrangement (renting versus living with family) is unspecified.';
 for(const whileSpeaking of [true,false]){
  const {events,visuals}=setup();
  visuals.trackResearch('request',question);
  visuals.inputStarted();
  if(!whileSpeaking)visuals.callerTurn('Renting, off campus');
  visuals.receiveResearch(comparison('en'));
  if(whileSpeaking)visuals.callerTurn('Renting, off campus');
  assert.equal(events.at(-1).present,true);
  assert.equal(events.at(-1).report.housingScenario,'off_campus');
 }
});

for(const [language,question,followup] of [
 ['en','What is the application deadline for Eastview College?','Does that include transfer applicants?'],
 ['es','¿Cuál es la fecha límite de solicitud de Eastview College?','¿Eso incluye solicitantes de transferencia?'],
])test(`${language}: a related non-cost clarification keeps the completed research table in view`,()=>{
 for(const duringSpeech of [false,true]){
  const {events,visuals}=setup(),job=comparison(language);
  job.question=question;job.result.researchTask=createResearchTask({question,language,institution:'Eastview College; Pine Valley College'});
  visuals.trackResearch('request',question);visuals.inputStarted();
  if(duringSpeech)visuals.receiveResearch(job);
  visuals.callerTurn(followup);
  if(!duringSpeech)visuals.receiveResearch(job);
  assert.equal(events.at(-1).present,true);
  assert.equal(events.at(-1).report.table.rows[0].aspect,'deadline');
 }
});

for(const language of ['en','es'])test(`${language}: failed admissions research retains every requested option without a cost placeholder`,()=>{
 const {events,visuals}=setup(),question=language==='es'?'Compara las fechas límite de solicitud.':'Compare application deadlines.';
 const researchTask=createResearchTask({question,language,institution:'Eastview College; Pine Valley College'});
 visuals.trackResearch('failure',question,researchTask);
 visuals.receiveResearch({id:'failed-deadline',status:'failed',question,query:{requestKey:'failure',language,researchTask}});
 const table=events.at(-1).report.table;
 assert.deepEqual(table.columns,['Eastview College','Pine Valley College']);
 assert.deepEqual(table.rows,[{aspect:'deadline',cells:[null,null]}]);
 assert.deepEqual(table.unverifiedTotals,[]);
});

test('a partially completed task retains an option that produced no finding',()=>{
 const {events,visuals}=setup(),job=comparison('en');
 job.result.voiceBrief.findings=job.result.voiceBrief.findings.filter(finding=>finding.subject.startsWith('Eastview'));
 job.result.researchTask=createResearchTask({question:'Compare application deadlines.',institution:'Eastview College; Pine Valley College'});
 visuals.trackResearch('request','Compare application deadlines.');visuals.receiveResearch(job);
 const table=events.at(-1).report.table;
 assert.deepEqual(table.columns,['Eastview College','Pine Valley College']);
 assert.equal(table.rows[0].cells[1],null);
 assert.equal(table.rows[0].cells[0].answer,'January 15 [1].');
});

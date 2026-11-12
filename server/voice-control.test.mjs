import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:http';
import WebSocket from 'ws';
import {voiceControlSession,createVoiceControl} from './voice-control.mjs';
import {studentLiveSession,studentLiveUpdate} from './student-live-session.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {studentVoiceChannel} from '../src/studentVoiceChannel.mjs';
import {discussionExamples} from '../src/researchDiscussion.fixture.mjs';
import {voiceTargetResult} from '../src/voiceTargetResult.mjs';
import {capturePayload} from '../src/voiceCapture.mjs';
import {comparisonUpdateTool,comparisonFindings} from './voice-comparison-update.mjs';
import {studentHousingPlan,costHousingScenario} from './voice-housing-scope.mjs';
import {financeResearchRequest} from './finance-research.mjs';
import {requestedResearchAspects} from '../src/researchQuestion.mjs';
import {comparisonAddition,mergeComparisonAddition} from './research-reuse.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeoutMs=1000){for(let n=0;n<timeoutMs/10;n++){if(check())return;await pause(10);}assert.fail('condition timed out');}
const tool=(name,call_id,args={})=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});
const config={language:'en',instructions:'Authorized context',tools:[{name:'lookup_financial_aid'},{name:'propose_profile'}],routingPolicy:'bounded-follow-up-v1'};
function fixture(options={}){
 const sent=[],events=[],jobs=[];
 const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},config:{...config,...options.config},scope:{sessionId:'physical-call',studentId:'aiden',confirmed:true},
  emit:event=>events.push(event),jobRequest:async(method,id,body)=>{jobs.push({method,id,body});return method==='POST'?{id:'job-1',status:'queued'}:{id,status:'running'};},...options,config:{...config,...options.config}});
 engine.start();
 function backend(type,id,extra={}){engine.receive({type:'response.event',delegation_id:'delegation-'+id,event:{type,response:{id},...extra}});}
 function call(items,id='r'){backend('response.created',id);for(const item of items)backend('response.output_item.done',id,{item});backend('response.completed',id);}
 return {engine,sent,events,jobs,backend,call};
}

for(const language of ['en','es'])test(language+': a known rental plan survives generic off-campus tool wording',async()=>{
 const f=fixture({researchDeliveryV2:true,config:{language,housingPlan:'renting'}});
 try{
  const question=language==='es'?'Costo de asistencia fuera del campus para residente de California.':'California-resident cost of attendance living off campus.';
  f.call([tool('lookup_financial_aid','known-rental',{question,institution:'UC Berkeley'})]);
  await until(()=>f.jobs.some(job=>job.method==='POST'));
  const posted=f.jobs.find(job=>job.method==='POST').body;
  assert.equal(costHousingScenario(posted.question),'renting');
 }finally{f.engine.close();}
});
test('an explicitly supplied isolated delivery sink owns research once while cached results and UI remain available',async()=>{
 const ready=[];
 const result={checkedAt:new Date().toISOString(),text:'Example has an annual fee of $100. [1]',sources:[{url:'https://example.edu/fees'}],voiceBrief:{status:'verified',answer:'Annual fee: $100. [1]',qualification:'For the published year. [1]',nextStep:'',findings:[{subject:'Example',aspect:'tuition_fees',status:'verified',answer:'Annual fee: $100. [1]',qualification:'For the published year. [1]'}]}};
 const f=fixture({researchDeliveryV2:true,researchDeliverySink:e=>ready.push(e),jobRequest:async method=>method==='POST'?{id:'job-1',status:'queued'}:{id:'job-1',status:'completed',result}});
 try{
  f.call([tool('lookup_financial_aid','isolated-lookup',{institution:'Example',question:'Annual tuition and fees at Example'})]);
  await until(()=>ready.length===1,2500);
  assert.equal(ready[0].type,'origen.research.ready');assert.equal(ready[0].jobId,'job-1');
  assert.ok(f.events.some(e=>e.type==='origen.research.result'&&e.jobId==='job-1'));
  assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
  // The ordinary pending-task state is still supplied quietly; the research
  // evidence itself must only go to the injected owner.
  assert.ok(f.sent.filter(e=>e.type==='session.thinking.append').every(e=>!e.content.includes('$100')));
  assert.ok(f.events.some(e=>e.type==='origen.control.tool_result'),'formal tool still completes');
 }finally{f.engine.close();}
});
test('a selective isolated sink returning false leaves primary evidence on its normal delivery path',async()=>{
 const ready=[],result={text:'Annual fee is $100. [1]',sources:[{url:'https://example.edu/fee'}],voiceBrief:{status:'verified',answer:'Annual fee is $100. [1]',qualification:'Published amount. [1]',nextStep:'',findings:[{subject:'Example',aspect:'tuition_fees',status:'verified',answer:'Annual fee is $100. [1]',qualification:'Published amount. [1]'}]}};
 const f=fixture({researchDeliveryV2:true,researchDeliverySink:e=>{ready.push(e);return false;},jobRequest:async method=>method==='POST'?{id:'job-1',status:'queued'}:{id:'job-1',status:'completed',result}});
 try{f.call([tool('lookup_financial_aid','primary',{institution:'Example',question:'Annual tuition and fees'})]);await until(()=>ready.length===1,2500);
  assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('$100')),'normal context delivery still occurs');
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: a confirmed rental answer starts the missing budget check`,async()=>{
 const es=language==='es',subject='UC Berkeley',checkedAt=new Date().toISOString();
 const question=es?'Costo de asistencia 2026–27 fuera del campus.':'2026–27 cost of attendance off campus (housing arrangement unspecified).';
 const answer='Annual tuition and mandatory fees are $18,214. [1]';
 const qualification='Separate apartment and relatives budgets apply. [1]';
 const result={checkedAt,text:answer,sources:[{url:'https://berkeley.edu/budget',checkedAt}],voiceBrief:{
  status:'partial',answer,qualification,nextStep:'Apartment or relatives?',findings:[
   {subject,aspect:'total_budget',status:'partial',answer:'Housing choice is needed. [1]',qualification},
   {subject,aspect:'tuition_fees',status:'partial',answer,qualification},
  ]}};
 const posts=[];
 const f=fixture({researchDeliveryV2:true,config:{language},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posts.push(body);return {id:`job-${posts.length}`,status:'queued'};}
  return id==='job-1'?{status:'completed',result}:{status:'running'};
 }});
 const ask=async(delta,version)=>{
  f.engine.playback({idle:true,version});
  f.engine.receive({type:'session.output_transcript.delta',delta});
  await until(()=>f.events.filter(e=>e.type==='origen.research.speech_observed').length===version,3000);
 };
 const reply=async(delta)=>{
  f.engine.receive({type:'session.input_transcript.delta',delta});
  await pause(0);
  await f.engine.flush();
 };
 try{
  f.call([tool('lookup_financial_aid','initial',{institution:subject,question})]);
  await until(()=>f.events.some(e=>e.type==='origen.research.result'),2000);
  const yes=es?'Sí':'Yeah';
  await ask(es?'¿Va a alquilar un apartamento o vivir con familiares?':'Is he planning to rent an apartment or live with relatives?',1);
  await reply(yes);
  assert.equal(posts.length,1,'affirmation cannot resolve a two-option question');
  await ask(es?'¿Va a alquilar un apartamento?':'Is he planning to rent an apartment?',2);
  await reply(yes);
  await until(()=>posts.length===2);
  assert.equal(posts[1].institution,subject);
  assert.equal(posts[1].studentId,'aiden');
  assert.equal(posts[1].language,language);
  assert.match(posts[1].question,es?/alquilar un apartamento fuera del campus/u:/renting an off-campus apartment/u);
  await reply(yes);
  assert.equal(posts.length,2,'the same spoken question cannot authorize another lookup');
 }finally{f.engine.close();}
});
for(const language of ['en','es'])for(const status of ['partial','verified'])test(`${language}: confirming the published rental benchmark updates the table without another lookup (${status})`,async()=>{
 const es=language==='es',checkedAt=new Date().toISOString(),posts=[];
 const question=es?'Costo de asistencia fuera del campus, modalidad sin especificar.':'Cost of attendance off campus, arrangement unspecified.';
 const qualification=es?'Referencia de alquiler 2026–27; modalidad de vivienda sin confirmar. [1]':'2026–27 assumed rental benchmark; housing choice unconfirmed. [1]';
 const finding={subject:'Eastview College — 2026–27',aspect:'total_budget',status,qualification,
  answer:es?'US$40,000, alquiler fuera del campus. Desglose publicado: Matrícula y cuotas: $10,000; Vivienda y alimentación: $28,000; Libros: $2,000. [1]':
   'US$40,000, renting off campus. Published breakdown: Tuition and fees: $10,000; Housing and food: $28,000; Books: $2,000. [1]'};
 const result={checkedAt,text:finding.answer,sources:[{url:'https://eastview.edu/costs',checkedAt}],voiceBrief:{
  status:'partial',answer:'Published budget $40,000 [1].',qualification,nextStep:'',findings:[finding]}};
 const f=fixture({researchDeliveryV2:true,visualCards:true,config:{language},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posts.push(body);return {id:'benchmark',status:'queued'};}
  return {status:'completed',result};
 }});
 try{
  f.call([tool('lookup_financial_aid','benchmark',{institution:'Eastview College',question})]);
  await until(()=>f.events.some(event=>event.type==='origen.visual.research'),2200);
  assert.equal(f.events.filter(event=>event.type==='origen.visual.research').at(-1).report.housingBenchmark,true);
  f.engine.receive({type:'session.input_transcript.delta',delta:es?'Él va a alquilar fuera del campus.':'He is renting off campus.'});
  await pause(0);await f.engine.flush();
  await until(()=>f.events.filter(event=>event.type==='origen.visual.research').at(-1).report.housingBenchmark===undefined);
  assert.equal(posts.length,1);
  assert.equal(f.events.filter(event=>event.type==='origen.visual.research').at(-1).report.housingScenario,'renting');
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: confirming a partial off-campus source benchmark narrows the table and the next campus without a recovery check`,async()=>{
 const es=language==='es',posts=[],checkedAt=new Date().toISOString();
 const result=subject=>({catalogLocalTesting:true,checkedAt,sources:[{url:'https://example.edu/costs',checkedAt}],text:'Published off-campus budget $40,000 [1].',voiceBrief:{
  status:'partial',answer:'Published budget $40,000 [1].',qualification:'Source categories and sum remain qualified. [1]',
  nextStep:es?'¿Alquilaría o viviría con familiares?':'Would the student rent or live with family?',
  findings:['off_campus','with_family'].map(housing=>({subject:subject+' — '+housing,aspect:'total_budget',status:'partial',
   answer:'Published 2026–27 budget: $40,000 [1].',qualification:'Published total differs from components by $85; source category unresolved. [1]',
   budget:{year:'2026-27',population:'California-resident undergraduate',currency:'USD',period:'academic_year',housing,assumed:false,total:40000,sourceCitation:'[1]',complete:true,
    expectedCategories:['tuition_fees','housing','food'],components:[['tuition_fees',10000],['housing',25000],['food',5085]].map(([key,amount])=>({key,sourceLabel:key,amount,role:'component',qualification:''}))}}))}});
 const f=fixture({researchDeliveryV2:true,visualCards:true,config:{language},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posts.push(body);return {id:'scope-'+posts.length,status:'queued'};}
  return {status:'completed',result:result(id==='scope-1'?'Eastview College':'Pine Valley College')};
 }});
 const say=async text=>{f.engine.receive({type:'session.input_transcript.delta',delta:text});await pause(0);await f.engine.flush();};
 try{
  const question=es?'Costo de asistencia para pregrado residente de California fuera del campus.':'California-resident undergraduate cost of attendance off campus.';
  f.call([tool('lookup_financial_aid','scope-first',{institution:'Eastview College',question})]);
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'),2200);
  await say(es?'Él vivirá fuera del campus, no con familiares.':'He will be off campus, not with family.');
  await until(()=>f.events.filter(e=>e.type==='origen.visual.research').at(-1).report.confirmedHousingChoice==='renting');
  assert.equal(posts.length,1,'qualified totals are reused without pretending they reconcile');
  const housingContext=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>{try{return JSON.parse(e.content);}catch{return null;}})
   .filter(e=>e?.kind==='current-call-housing-choice');
  assert.equal(housingContext.length,1);assert.equal(JSON.parse(housingContext[0].text).choice,'renting');
  assert.equal(JSON.parse(housingContext[0].text).savedToProfile,false);
  assert.equal(JSON.parse(housingContext[0].text).studentId,'aiden');
  f.engine.receive({type:'session.output_transcript.delta',delta:es?'Usaré el escenario de alquiler.':'I will use the rental scenario.'});
  await pause(0);await f.engine.flush();
  await say(es?'Bueno, eh, ¿y Pine Valley College?':'Okay, um. What about Pine Valley College?');
  f.call([tool('lookup_financial_aid','scope-next',{institution:'Pine Valley College; Eastview College',question})],'scope-next-response');
  await until(()=>posts.length===2);
  assert.equal(costHousingScenario(posts[1].question),'renting');
  assert.equal(posts[1].visualComparisonCampus,'Pine Valley College','only the newly named campus is checked');
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'&&e.report.id==='scope-2'),2200);
  assert.equal(f.events.filter(e=>e.type==='origen.visual.research').at(-1).report.confirmedHousingChoice,'renting');
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: undated costs, a natural pending rental answer, and a failed added campus keep the comparison`,async()=>{
 const es=language==='es',posts=[],checkedAt=new Date().toISOString();let firstComplete=false;
 const sources=[{url:'https://berkeley.edu/budget',checkedAt}];
 const qualification='2026–27 published estimate. Scenario-dependent total unavailable.';
 const result={checkedAt,sources,text:'Published tuition $18,214 [1].',voiceBrief:{status:'partial',answer:'Published tuition $18,214 [1].',qualification,nextStep:'',findings:[
  {subject:'UC Berkeley — 2026–27 undergraduate',aspect:'tuition_fees',status:'partial',answer:'Annual tuition and fees: $18,214 [1].',qualification},
  {subject:'UC Berkeley',aspect:'total_budget',status:'partial',answer:'Rental and relatives budgets differ. [1]',qualification},
 ]}};
 const f=fixture({researchDeliveryV2:true,visualCards:true,config:{language},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posts.push(body);return {id:'natural-'+posts.length,status:'queued'};}
  if(id==='natural-1'&&!firstComplete)return {status:'running'};
  if(id==='natural-3')return {status:'completed',result:{...result,voiceBrief:{...result.voiceBrief,status:'unverified',findings:[
   {subject:'UC Davis',aspect:'total_budget',status:'unverified',answer:'The requested total was not verified.',qualification},
  ]}}};
  return {status:'completed',result};
 }});
 const say=async text=>{f.engine.receive({type:'session.input_transcript.delta',delta:text});await pause(0);await f.engine.flush();};
 try{
  await say(es?'Quiero saber el costo de Berkeley':'I want to learn about the cost of UC Berkeley');
  f.call([tool('lookup_financial_aid','natural-initial',{institution:'UC Berkeley',question:'California-resident undergraduate cost of attendance off campus for the next available academic year, 2027–28.'})]);
  await until(()=>posts.length===1);
  assert.doesNotMatch(posts[0].question,/2027|next available/);
  await say(es?'Sí, él probablemente va a alquilar cerca del campus':"Yeah, he's gonna be probably renting near campus");
  assert.equal(posts.length,1,'the running check is preserved until its result');
  firstComplete=true;
  await until(()=>posts.length===2,2200);
  assert.match(posts[1].question,es?/alquilar.*fuera del campus/u:/renting.*off campus/u);
  await until(()=>f.events.filter(e=>e.type==='origen.visual.research').length>=2,2200);
  f.engine.receive({type:'session.output_transcript.delta',delta:es?'Ese es el escenario de alquiler.':'That is the planned rental scenario.'});
  await pause(0);await f.engine.flush();
  await say(es?'¿Y UC Davis?':'What about for UC Davis');
  f.call([tool('lookup_financial_aid','natural-davis',{institution:'UC Davis; UC Berkeley',question:'Compare UC Davis undergraduate costs renting off campus with Berkeley for 2027–28.'})],'natural-addition');
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'&&e.report.table.columns.includes('UC Davis')),2200);
  const next=f.events.filter(e=>e.type==='origen.visual.research').at(-1).report;
  assert.equal(next.comparisonReferenceId,'natural-2');
  assert.doesNotMatch(posts[2].question,/2027/);
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: a retained official result feeds the voice tool and the same table without another job`,async()=>{
 const checkedAt=new Date().toISOString(),subject='UC Santa Cruz';
 const amount=language==='es'?'La suma anual de matrícula y cuotas obligatorias es USD 17,432.36. [1]':'Annual tuition and mandatory fees add up to USD 17,432.36. [1]';
 const caveat=language==='es'?'Para residentes de California en 2026–27; excluye vivienda.':'For California residents in 2026–27; excludes housing.';
 const findings=[{subject,aspect:'total_budget',status:'unverified',answer:'Attendance total could not be verified.',qualification:'Off-campus rental budget unconfirmed.'},
  {subject,aspect:'tuition_fees',status:'partial',answer:amount,qualification:caveat}];
 const result={checkedAt,sources:[{url:'https://ucsc.edu/fees',title:'University fees'}],text:amount,voiceBrief:{status:'partial',answer:amount,qualification:caveat,nextStep:'',findings}};
 let posts=0;
 const f=fixture({researchDeliveryV2:true,visualCards:true,config:{language},jobRequest:async method=>method==='POST'?
  (posts++,{id:'job-1',status:'queued'}):{status:'completed',result}});
 const query={institution:subject,question:language==='es'?'Costo de asistencia 2026–27 alquilando fuera del campus.':'2026–27 cost of attendance renting off campus.'};
 try{
  f.call([tool('lookup_financial_aid','fresh',query)]);
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'),2000);
  f.call([tool('lookup_financial_aid','repeat',query)],'repeat');
  await until(()=>f.sent.some(e=>e.item?.call_id==='repeat'));
  const output=JSON.parse(f.sent.find(e=>e.item?.call_id==='repeat').item.output);
  const [fresh,retained]=f.events.filter(e=>e.type==='origen.visual.research').map(e=>e.report);
  assert.equal(posts,1);
  assert.equal(output.status,'reused_verified_result');
  assert.deepEqual(retained.table,fresh.table);
  assert.equal(retained.id,fresh.id);
  assert.deepEqual(retained.table.unverifiedTotals,[subject]);
  assert.deepEqual(retained.table.rows.find(row=>row.aspect==='total_budget').cells,[null]);
  const tuition=retained.table.rows.find(row=>row.aspect==='tuition_fees').cells[0];
  const spoken=output.findings.find(finding=>finding.aspect==='tuition_fees');
  assert.equal(tuition.answer,spoken.answer);assert.equal(tuition.qualification,spoken.qualification);
  assert.match(output.instruction,/If the requested total is unverified, say so/);
 }finally{f.engine.close();}
});
for(const [language,turns,partial=false] of [
 ['en',['Okay, what about UC Davis?']],['es',['¿Y UC Davis?']],
 ['en',['What about for UC Davis']],
 ['en',['[lip smack] Well actually, um, what- uh what would be the, uh, can you- can you also compare with, uh, UC Davis'],true],
 ['es',['Bueno, eh, puedes comparar también con, eh, UC Davis'],true],
 ['en',['I see. What about [clear throat', 'I see. What about [clear throat] [gulp] uh', 'Bu-but yeah, UC Davis']],
 ['es',['Entiendo. ¿Y qué tal…?', '[tos]', 'Sí, UC Davis']],
])test(`${language}: Decisions adds Davis and retains Berkeley in the ${turns.length>1?'split':'single-turn'} comparison`,async()=>{
 let now=Date.now();
 const checkedAt=new Date(now).toISOString(),qualification='2026–27 annual estimate, before aid and not a bill.';
 const result=(campus,slug,total,tuition)=>({
  checkedAt,sources:[{url:`https://${slug}.edu/budget`,title:'Campus budget',checkedAt}],text:total,
  voiceBrief:{status:'verified',answer:total,qualification,nextStep:'',findings:[
   {subject:campus,aspect:'total_budget',status:'verified',answer:total+' [1]',qualification},
   {subject:campus,aspect:'tuition_fees',status:'verified',answer:tuition+' [1]',qualification},
  ]},
 });
 const berkeley=result('UC Berkeley — renting off campus','berkeley','$49,692 USD for the 2026–27 academic year, before aid.','Annual tuition and fees: $18,214.');
 if(partial){berkeley.voiceBrief.status='partial';berkeley.voiceBrief.findings[0].status='partial';berkeley.voiceBrief.findings[0].qualification+=' Another official source lists $49,420; unresolved discrepancy [1].';}
 const davis=result('UC Davis','ucdavis','Off-campus without parents budget: $44,760.','Annual tuition and fees: $18,077.13.');
 const question='2026–27 undergraduate cost of attendance and tuition, living off campus and renting (not living with parents).';
 const posts=[],logs=[];let decisions=0;
 const f=fixture({now:()=>now,log:event=>logs.push(event),researchDeliveryV2:true,visualCards:true,config:{language},comparisonClient:{evaluate:async input=>{
  decisions++;assert.equal(input.questions[0].name,'comparison_addition');assert.doesNotMatch(input.input,/49,692|18,214|Aiden/);
  return {response:{answers:[{name:'comparison_addition',type:'choice',choice:'add',probabilities:[{value:'add',probability:1}]}]}};
 }},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posts.push(body);return {id:'job-'+posts.length,status:'queued'};}
  if(method==='DELETE')return {id,status:'cancelled'};
  if(id==='job-1')return {id,status:'completed',result:berkeley};
  const base={status:'completed',input:posts[0],result:berkeley,finished_at:checkedAt};
  const plan=comparisonAddition(posts[1],base);
  assert.deepEqual(plan.lookupInstitutions,['University of California, Davis']);
  return {id,status:'completed',result:mergeComparisonAddition(davis,plan)};
 }});
 try{
  f.call([tool('lookup_financial_aid','base',{question,institution:'UC Berkeley'})],'base');
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'&&e.report.id==='job-1'),2200);
  for(const turn of turns){
   now+=3000;
   f.engine.receive({type:'session.input_transcript.delta',delta:turn});await pause(0);await f.engine.flush();
  }
  f.call([tool('lookup_financial_aid','add',{question:'Compare UC Davis and UC Berkeley. '+question,institution:partial?'UC Berkeley and University of California, Davis':'University of California, Davis; UC Berkeley'})],'add');
  await until(()=>f.events.some(e=>e.type==='origen.visual.research'&&e.report.id==='job-2'),2200);
  assert.equal(decisions,1);assert.equal(posts[1].retainedComparisonJobId,'job-1');
  assert.equal(posts[1].institution,'University of California, Davis');assert.doesNotMatch(posts[1].question,/Berkeley/);
  const table=f.events.find(e=>e.report?.id==='job-2').report.table;
  assert.deepEqual(table.columns,['UC Davis','UC Berkeley']);
  assert.match(table.rows.find(r=>r.aspect==='total_budget').cells[1].answer,/49,692/);
  assert.deepEqual(logs.filter(e=>e.comparisonReason==='added_option').map(e=>e.comparisonStage),['checking','selected','queued']);
  if(partial){
   const cell=table.rows.find(r=>r.aspect==='total_budget').cells[1];
   assert.equal(cell.status,'partial');assert.match(cell.qualification,/49,420/);
  }
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: growing comparisons stay narrow after partial and unverified campuses`,async()=>{
 let now=Date.now();const checkedAt=new Date(now).toISOString();
 const names=['UC Berkeley','UC Davis','UC Irvine','UC Merced','UC Santa Cruz'];
 const question=language==='en'?'2026–27 undergraduate transfer annual tuition and total budget for California residents renting off campus':'Matrícula y presupuesto anual de pregrado y transferencia 2026–27 para residentes de California que alquilan fuera del campus';
 const posts=[],completed=new Map(),logs=[];let checks=0;
 const makeResult=index=>{
  const unknown=index===3,partial=index===2;
  const findings=[{subject:names[index],aspect:'total_budget',status:unknown||partial?'unverified':'verified',
   answer:unknown||partial?'The annual rental total could not be verified.':'2026–27 annual rental budget: $48,000 [1].',qualification:'Annual estimate, not a bill.'},
  {subject:names[index],aspect:'tuition_fees',status:unknown?'unverified':partial?'partial':'verified',
   answer:unknown?'The fee subtotal could not be verified.':'2026–27 tuition and fees: $18,000 [1].',qualification:partial?'The official subtotal does not reconcile [1].':'Annual fees exclude housing.'}];
  return {checkedAt,text:findings.map(f=>f.answer).join(' '),sources:unknown?[]:[{url:`https://campus${index}.edu/cost`,title:names[index],checkedAt}],
   voiceBrief:{status:unknown?'unverified':partial?'partial':'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
 };
 const f=fixture({now:()=>now,config:{language},researchDeliveryV2:true,visualCards:true,log:event=>logs.push(event),
  comparisonClient:{evaluate:async input=>{
   checks++;const task=JSON.parse(input.input);assert.equal(task.requestedCampus,names[checks]);
   return {response:{answers:[{name:'comparison_addition',type:'choice',choice:'add',probabilities:[{value:'add',probability:1}]}]}};
  }},jobRequest:async(method,id,body)=>{
   if(method==='POST'){posts.push(body);return {id:'grow-'+posts.length,status:'queued'};}
   if(method==='DELETE')return {id,status:'cancelled'};
   const index=Number(id.split('-')[1])-1;
   if(!completed.has(id)){
    let result=makeResult(index);
    if(index){
     const plan=comparisonAddition(posts[index],{status:'completed',input:posts[index-1],result:completed.get('grow-'+index),finished_at:checkedAt},{now});
     assert.ok(plan);assert.deepEqual(plan.lookupInstitutions,[names[index]]);
     result=mergeComparisonAddition(result,plan);assert.ok(result);assert.ok(result.voiceBrief.findings.length<=8);
    }
    completed.set(id,result);
   }
   return {id,status:'completed',result:completed.get(id)};
  }});
 try{
  for(let index=0;index<names.length;index++){
   if(index){
    now+=3000;
    f.engine.receive({type:'session.input_transcript.delta',delta:language==='en'?`What about for ${names[index]}`:`¿Y ${names[index]}?`});
    await pause(0);await f.engine.flush();
   }
   f.call([tool('lookup_financial_aid','grow-call-'+index,{institution:names.slice(0,index+1).reverse().join('; '),question})],'grow-response-'+index);
   await until(()=>completed.has('grow-'+(index+1)),2200);
   await pause(30);
   if(index){assert.equal(posts[index].institution,names[index]);assert.equal(posts[index].retainedComparisonJobId,'grow-'+index);}
  }
  assert.equal(checks,4,'fourth addition remains eligible within the physical call research budget');
  assert.equal(posts.length,5);assert.equal(logs.filter(e=>e.comparisonStage==='queued').length,4);
  assert.equal(completed.get('grow-4').voiceBrief.findings.find(f=>f.subject==='UC Irvine').status,'partial');
  assert.ok(completed.get('grow-5').voiceBrief.findings.every(f=>f.subject==='UC Santa Cruz'),'a fully unverified prior campus supplies no invented retained facts');
 }finally{f.engine.close();}
});
for(const [language,record,question,scenario,explicit] of [
 ['en','Aiden’s off-campus living situation does not guarantee any housing aid.','What is the total budget for a California-resident transfer?','off-campus housing, arrangement unspecified','What is the total budget living with family?'],
 ['es','Aiden va a vivir fuera del campus.','¿Cuál es el presupuesto total para un estudiante residente de California?','alojamiento fuera del campus, modalidad sin especificar','¿Cuál es el presupuesto total si vive con su familia?'],
])test(language+': finance delegation carries the selected housing plan before the worker starts',async()=>{
 const brief={studentId:'aiden',profile:{name:'Aiden'},records:[{content:record}]};
 assert.equal(studentHousingPlan(brief,'elodie'),undefined);
 assert.equal(studentHousingPlan({...brief,records:[{content:'The official off-campus budget is an estimate.'}]},'aiden'),undefined);
 const newerCorrection={content:language==='es'?'Aiden no va a vivir fuera del campus.':'Aiden is not living off campus.',date:'2026-11-10'};
 assert.equal(studentHousingPlan({...brief,records:[...brief.records,newerCorrection]},'aiden'),undefined);
 const housingPlan=studentHousingPlan(brief,'aiden');
 assert.equal(housingPlan,'off_campus');
 const recentBrief={...brief,records:[{content:'The intended living arrangement remains unclear.'}]};
 assert.equal(studentHousingPlan(recentBrief,'aiden',[{studentId:'aiden',summary:record}]),'off_campus');
 assert.equal(studentHousingPlan(recentBrief,'aiden',[{studentId:'elodie',summary:record}]),undefined);
 const f=fixture({config:{language,housingPlan}});
 try{
  f.call([tool('lookup_financial_aid','housing',{question,institution:'UC Berkeley'})],'housing');
  await until(()=>f.jobs.some(job=>job.method==='POST'));
  const scoped=f.jobs.find(job=>job.method==='POST').body;
  assert.ok(scoped.question.includes(scenario));
  assert.doesNotMatch(scoped.question,/Aiden|housing aid/);
  assert.deepEqual(requestedResearchAspects(scoped.question),['total_budget']);
  const worker=financeResearchRequest({},scoped);
  assert.equal(JSON.parse(worker.input).question,scoped.question);
  assert.match(worker.instructions,/If the source has only one off-campus budget, use its own label/);
  assert.match(worker.instructions,/housing choice unconfirmed/);
  assert.match(worker.instructions,/unresolved housing choice does not block retrieving the published COA/);
 }finally{f.engine.close();}
 const next=fixture({config:{language,housingPlan}});
 try{
  next.call([tool('lookup_financial_aid','explicit',{question:explicit,institution:'UC Berkeley'})],'explicit');
  await until(()=>next.jobs.some(job=>job.method==='POST'));
  assert.equal(next.jobs.find(job=>job.method==='POST').body.question,explicit);
 }finally{next.engine.close();}
});
for(const language of ['en','es'])test(language+': comparison keeps the saved figure in the receipt while only the changed campus is queued',async()=>{
 const es=language==='es',changed=es?'UC Berkeley':'UC Davis',unchanged=es?'UC Davis':'UC Berkeley';
 const sources=[
  {url:'https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/',title:'Berkeley'},
  {url:'https://financialaid.ucdavis.edu/undergraduate/cost/2627-entering',title:'Davis'},
 ];
 const findings=['UC Berkeley','UC Davis'].map((name,i)=>({subject:name+' — residence hall',aspect:'total_budget',status:'verified',
  answer:name+' 2026–27 residence hall annual total: $'+['54,674','49,009'][i]+' ['+(i+1)+'].',
  qualification:'Estimate for new California-resident undergraduates before aid, not a bill ['+(i+1)+'].'}));
 const result={sources,checkedAt:new Date().toISOString(),text:findings.map(f=>f.answer+' '+f.qualification).join(' '),
  voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
 const posts=[];let decisions=0;
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,comparisonUpdateTool]},
  comparisonClient:{evaluate:async request=>{
   decisions++;
   assert.doesNotMatch(request.input,/my family|nuestra familia|50,000/);
   const choice=JSON.parse(request.input).options.find(option=>option.subject===changed).id;
   return {response:{answers:[{type:'choice',name:'comparison_update',choice,probabilities:[{value:choice,probability:1}]}]}};
  }},
  jobRequest:async(method,id,body)=>{
   if(method==='POST'){posts.push(body);return {id:'job-'+posts.length,status:'queued'};}
   if(method==='DELETE')return {id,status:'cancelled'};
   return id==='job-1'?{id,status:'completed',result}:{id,status:'running'};
  }});
 const reply=id=>f.sent.find(e=>e.item?.call_id===id)?.item?.output;
 const speak=async text=>{f.engine.receive({type:'session.input_transcript.delta',delta:text});await pause(0);await f.engine.flush();};
 const assistantTurn=async()=>{f.engine.receive({type:'session.output_transcript.delta',delta:es?'Entendido.':'Got it.'});await pause(0);await f.engine.flush();};
 try{
  f.call([tool('lookup_financial_aid','initial',{institution:'UC Berkeley and UC Davis',question:'Compare 2026–27 residence hall budgets'})],'original');
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.jobId==='job-1'),2000);
  await speak(es?'¿Y si vive con su familia en ese campus?':'What if he lived at home at that campus?');
  f.call([tool(comparisonUpdateTool.name,'ambiguous',{jobId:'job-1',revision:1})],'unclear');
  await until(()=>reply('ambiguous'));
  assert.equal(JSON.parse(reply('ambiguous')).status,'comparison_clarification_required');
  assert.equal(decisions,0);assert.equal(posts.length,1);
  await assistantTurn();
  await speak(es?'UC Davis está más cerca de nuestra familia.':'UC Davis is closer to our family.');
  await assistantTurn();
  await speak(es?'¿Y si vive con su familia en el campus más lejos de nosotros?':'What if he lived at home at the campus closer to our family?');
  f.call([tool(comparisonUpdateTool.name,'update',{jobId:'job-1',revision:1})],'update');
  await until(()=>reply('update'));
  const receipt=JSON.parse(f.events.find(e=>e.type==='origen.control.tool_result'&&e.callId==='update').output);
  assert.equal(JSON.parse(reply('update')).unchangedFindings,undefined);
  assert.equal(receipt.status,'research_pending');
  assert.equal(receipt.changedItem.subject,changed);
  assert.equal(receipt.unchangedFindings[0].name,unchanged);
  assert.match(receipt.unchangedFindings[0].qualification,/before aid, not a bill/);
  assert.equal(posts.length,2);assert.equal(decisions,1);
  assert.equal(posts[1].institution,changed);
  assert.equal(posts[1].comparisonBaseJobId,'job-1');
  assert.ok(!posts[1].question.includes(unchanged));
  f.call([tool(comparisonUpdateTool.name,'duplicate',{jobId:'job-1',revision:1})],'duplicate');
  await until(()=>reply('duplicate'));
  assert.equal(JSON.parse(reply('duplicate')).status,'comparison_update_already_requested');
  assert.equal(posts.length,2);assert.equal(decisions,1);
 }finally{f.engine.close();}
});
function comparisonReport(aspect='deadline'){
 const checkedAt=new Date(Date.now()-1000).toISOString(),names=['Eastview College','Pine Valley College','Harbor College'];
 const findings=names.map((subject,i)=>({subject,aspect,status:'verified',answer:subject+' published fall 2027 policy ['+(i+1)+'].',qualification:'First-year applicants only; program exceptions can apply ['+(i+1)+'].'}));
 return {checkedAt,sources:names.map((name,i)=>({url:'https://campus'+i+'.edu/policy',title:name,checkedAt})),text:findings.map(f=>f.answer+' '+f.qualification).join(' '),
  voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
}
test('research visual is emitted to the browser after worker evidence, with no provider visual event',async()=>{
 const result=comparisonReport();
 const f=fixture({visualCards:true,researchDeliveryV2:true,jobRequest:async(method,id)=>method==='POST'?
  {id:'visual-job',status:'queued'}:{id,status:'completed',result}});
 try{
  f.engine.receive({type:'session.input_transcript.delta',delta:'Compare these college deadlines.'});
  await pause(0);await f.engine.flush();
  assert.equal(f.events.some(event=>event.type.startsWith('origen.visual.')),false);
  f.call([tool('lookup_financial_aid','visual-lookup',{institution:'Eastview College',question:'Compare published fall 2027 policies'})]);
  await until(()=>f.events.some(event=>event.type==='origen.visual.research'),2000);
  const visual=f.events.find(event=>event.type==='origen.visual.research');
  assert.equal(visual.present,true);
  assert.deepEqual(visual.report.table.columns,['Eastview College','Pine Valley College','Harbor College']);
  assert.equal(f.sent.some(event=>event.type.startsWith('origen.visual.')),false);
 }finally{f.engine.close();}
});
async function comparisonFixture({language='en',aspect='deadline',result=comparisonReport(aspect),evaluate,post,visualCards=false}={}){
 const posts=[],logs=[],results={'job-1':result};let decisions=0;
 const f=fixture({researchDeliveryV2:true,visualCards,config:{language,tools:[...config.tools,{name:'lookup_college_applications'},comparisonUpdateTool]},log:event=>logs.push(event),
  comparisonClient:{evaluate:async request=>{decisions++;if(evaluate)return evaluate(request);const input=JSON.parse(request.input),choice=input.options.find(o=>o.subject===input.reference.subject&&o.aspect===input.reference.aspect).id;
   return {response:{answers:[{type:'choice',name:'comparison_update',choice,probabilities:[{value:choice,probability:1}]}]}};}},
  jobRequest:async(method,id,body)=>{if(method==='POST'){posts.push(body);return post?post(body,posts.length):{id:'job-'+posts.length,status:'queued'};}if(method==='DELETE')return {id,status:'cancelled'};return results[id]?{id,status:'completed',result:results[id]}:{id,status:'running'};}});
 const speak=async text=>{f.engine.receive({type:'session.input_transcript.delta',delta:text});await pause(0);await f.engine.flush();};
 const reply=id=>f.sent.find(e=>e.item?.call_id===id)?.item?.output;
 f.call([tool('lookup_college_applications','original',{institution:'Eastview, Pine Valley and Harbor',question:'Compare published fall 2027 policies'})],'original');
 await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.jobId==='job-1'),2000);
 return {...f,posts,logs,results,speak,reply,decisions:()=>decisions,result};
}
test('an ordinary lookup for a clear comparison correction still uses Decisions and preserves the comparison in the visual',async()=>{
 const f=await comparisonFixture({visualCards:true});
 try{
  const updated=structuredClone(f.result);
  updated.voiceBrief.findings[0].answer='Spring 2028 deadline: September 1 [1].';
  f.results['job-2']=updated;
  await f.speak('Change Eastview College to spring 2028.');
  f.call([tool('lookup_college_applications','fallback',{institution:'Eastview College',question:'Verify the spring 2028 application deadline for Eastview College.'})],'fallback');
  await until(()=>f.reply('fallback'));
  const receipt=JSON.parse(f.events.find(e=>e.type==='origen.control.tool_result'&&e.callId==='fallback').output);
  assert.equal(JSON.parse(f.reply('fallback')).unchangedFindings,undefined);
  assert.equal(f.decisions(),1);
  assert.equal(f.posts[1].comparisonBaseJobId,'job-1');
  assert.equal(f.posts[1].institution,'Eastview College');
  assert.deepEqual(receipt.unchangedFindings.map(finding=>finding.subject),['Pine Valley College','Harbor College']);
  assert.match(receipt.instruction,/no speech, recap, progress announcement, or new question/i);
  await until(()=>f.events.some(event=>event.type==='origen.visual.research'&&event.report.id==='job-2'),2000);
  const table=f.events.find(event=>event.type==='origen.visual.research'&&event.report.id==='job-2').report.table;
  assert.deepEqual(table.columns,['Eastview College','Pine Valley College','Harbor College']);
  assert.match(table.rows[0].cells[0].answer,/September 1/);
  assert.ok(f.events.some(event=>event.type==='origen.research.state_changed'&&event.requestId==='fallback'&&event.state==='queued'));
  assert.ok(!f.sent.some(event=>event.type==='session.thinking.append'&&/fallback/.test(event.content)&&/"state":"(?:requesting|queued|running)"/.test(event.content)));
 }finally{f.engine.close();}
});
for(const [aspect,en,es] of [
 ['deadline','Change Eastview College to spring 2028.','Cambia Eastview College a primavera de 2028.'],
 ['eligibility','What if Eastview College enrollment is part time?','¿Qué pasa si la matrícula de medio tiempo es en Eastview College?'],
 ['other','Switch Eastview College orientation to online.','Cambia la orientación de Eastview College a en línea.'],
])for(const language of ['en','es'])test(`${language}: controller preserves multiple ${aspect} findings and routes only the changed condition`,async()=>{
 const f=await comparisonFixture({language,aspect});
 try{
  await f.speak(language==='es'?es:en);f.call([tool(comparisonUpdateTool.name,'change',{jobId:'job-1',revision:1})],'change');await until(()=>f.reply('change'));
  const receipt=JSON.parse(f.events.find(e=>e.type==='origen.control.tool_result'&&e.callId==='change').output);
  assert.equal(receipt.status,'research_pending');assert.equal(receipt.changedItem.subject,'Eastview College');assert.equal(receipt.changedItem.aspect,aspect);
  assert.deepEqual(receipt.unchangedFindings.map(e=>e.subject),['Pine Valley College','Harbor College']);
  assert.ok(receipt.unchangedFindings.every(e=>e.qualification.includes('program exceptions')&&e.answer.includes('2027')));
  assert.equal(f.posts[1].mode,'admissions');assert.equal(f.posts[1].comparisonFindingId,receipt.changedItem.id);
  assert.equal(f.posts[1].comparisonChange,language==='es'?es:en);
  assert.doesNotMatch(f.posts[1].question,/Pine Valley|Harbor/);assert.equal(f.decisions(),1);
  assert.ok(f.logs.some(e=>e.comparisonStage==='queued'&&e.retainedFindingCount===2));
  assert.ok(f.logs.filter(e=>e.comparisonStage).every(e=>!Object.hasOwn(e,'transcript')&&!Object.hasOwn(e,'comparisonChange')));
  assert.equal(f.sent.filter(e=>e.type==='session.instructions.append').length,0);
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: unclear comparison needs no Decisions check or lookup`,async()=>{
 const f=await comparisonFixture({language});
 try{
  await f.speak(language==='es'?'¿Y si esa universidad es para primavera?':'What if that college is for spring?');
  f.call([tool(comparisonUpdateTool.name,'unclear',{jobId:'job-1',revision:1})],'unclear');await until(()=>f.reply('unclear'));
  const receipt=JSON.parse(f.reply('unclear'));assert.equal(receipt.status,'comparison_clarification_required');assert.equal(receipt.searchStarted,false);
  assert.equal(f.posts.length,1);assert.equal(f.decisions(),0);assert.ok(f.logs.some(e=>e.comparisonStage==='clarification'));
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: exact completed change reuses its merged report without rechecking`,async()=>{
 const change=language==='es'?'Cambia Eastview College a primavera de 2028.':'Change Eastview College to spring 2028.',result=comparisonReport();
 result.comparisonUpdate={version:2,changedFindingId:comparisonFindings(result)[0].id,requestedChange:change};
 const f=await comparisonFixture({language,result});
 try{
  await f.speak(change);f.call([tool(comparisonUpdateTool.name,'same',{jobId:'job-1',revision:1})],'same');await until(()=>f.reply('same'));
  const receipt=JSON.parse(f.reply('same'));assert.equal(receipt.status,'cached_comparison');assert.equal(receipt.searchStarted,false);assert.equal(receipt.findings.length,3);
  assert.equal(f.posts.length,1);assert.equal(f.decisions(),0);assert.ok(f.logs.some(e=>e.comparisonStage==='reused'));
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: a later change uses the newly merged report while the old report stays superseded`,async()=>{
 const f=await comparisonFixture({language});
 const first=language==='es'?'Cambia Eastview College a primavera de 2028.':'Change Eastview College to spring 2028.';
 try{
  const merged=structuredClone(f.result);merged.voiceBrief.findings[0].answer='Eastview College spring 2028 deadline: September 1 [1].';
  merged.comparisonUpdate={version:2,changedFindingId:comparisonFindings(merged)[0].id,requestedChange:first};f.results['job-2']=merged;
  await f.speak(first);f.call([tool(comparisonUpdateTool.name,'first',{jobId:'job-1',revision:1})],'first');await until(()=>f.reply('first'));
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.jobId==='job-2'),2000);
  f.engine.receive({type:'session.output_transcript.delta',delta:language==='es'?'Eastview tiene una fecha para primavera.':'Eastview has a spring deadline.'});await pause(0);await f.engine.flush();
  await f.speak(language==='es'?'Cambia Pine Valley College a solicitantes de transferencia.':'Change Pine Valley College to transfer applicants.');
  f.call([tool(comparisonUpdateTool.name,'old-base',{jobId:'job-1',revision:1})],'old-base');await until(()=>f.reply('old-base'));
  assert.equal(JSON.parse(f.reply('old-base')).status,'comparison_update_already_requested');assert.equal(f.decisions(),1);
  f.call([tool(comparisonUpdateTool.name,'second',{jobId:'job-2',revision:1})],'second');await until(()=>f.reply('second'));
  const receipt=JSON.parse(f.events.find(e=>e.type==='origen.control.tool_result'&&e.callId==='second').output);assert.equal(receipt.status,'research_pending');assert.equal(receipt.changedItem.subject,'Pine Valley College');
  assert.match(receipt.unchangedFindings.find(e=>e.subject==='Eastview College').answer,/September 1/);assert.equal(f.posts[2].comparisonBaseJobId,'job-2');assert.equal(f.decisions(),2);
 }finally{f.engine.close();}
});
for(const changed of ['caller','student'])test(`comparison rejects ${changed} change while classification is pending`,async()=>{
 let finish,request;
 const f=await comparisonFixture({evaluate:r=>{request=r;return new Promise(resolve=>{finish=resolve;});}});
 try{
  await f.speak('Change Eastview College to spring 2028.');f.call([tool(comparisonUpdateTool.name,'pending',{jobId:'job-1',revision:1})],'pending');await until(()=>finish);
  if(changed==='caller')await f.speak('Actually, use fall 2029 instead.');
  else await f.engine.configure({...config,tools:[...config.tools,comparisonUpdateTool]}, {sessionId:'physical-call',studentId:'elodie',confirmed:true},'changed-student');
  const choice=JSON.parse(request.input).options[0].id;finish({response:{answers:[{type:'choice',name:'comparison_update',choice,probabilities:[{value:choice,probability:1}]}]}});
  await until(()=>f.reply('pending'));assert.equal(JSON.parse(f.reply('pending')).status,'comparison_superseded');assert.equal(f.posts.length,1);
  assert.ok(f.logs.some(e=>e.comparisonStage==='superseded'));
 }finally{f.engine.close();}
});
test('caller continuation during enqueue retains background work without replaying the obsolete announcement',async()=>{
 let finish;
 const f=await comparisonFixture({post:async(body,n)=>n===1?{id:'job-1',status:'queued'}:new Promise(resolve=>{finish=resolve;})});
 try{
  await f.speak('Change Eastview College to spring 2028.');f.call([tool(comparisonUpdateTool.name,'pending',{jobId:'job-1',revision:1})],'pending');await until(()=>finish);
  await f.speak('Can you explain what an entry term means?');finish({id:'job-2',status:'queued'});await until(()=>f.reply('pending'));
  const receipt=JSON.parse(f.reply('pending'));assert.equal(receipt.status,'comparison_superseded');assert.equal(receipt.searchStarted,true);
  assert.equal(receipt.unchangedFindings,undefined);assert.equal(f.posts.length,2);assert.ok(f.logs.some(e=>e.comparisonReason==='changed_during_enqueue'));
 }finally{f.engine.close();}
});
test('stale comparison is rejected before invoking Decisions',async()=>{
 const result=comparisonReport();result.sources[1].checkedAt=new Date(Date.now()-300001).toISOString();
 const f=await comparisonFixture({result});
 try{
  await f.speak('Change Eastview College to spring 2028.');f.call([tool(comparisonUpdateTool.name,'old',{jobId:'job-1',revision:1})],'old');await until(()=>f.reply('old'));
  assert.equal(JSON.parse(f.reply('old')).status,'comparison_unavailable');assert.equal(f.decisions(),0);assert.equal(f.posts.length,1);
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: unavailable diagnostics cannot delay the intro or add provider speech instructions`,async()=>{
 const calls=[],observer={observe:e=>calls.push(e),playback:()=>{throw Error('diagnostic sink failed');},close:()=>new Promise(()=>{}),reset:()=>{}};
 const f=fixture({observer,researchDeliveryV2:true,config:{language}});
 try{
  const greeting=language==='es'?'Hola, qué gusto escucharte.':'Hi, it is good to hear from you.';
  f.engine.receive({type:'session.output_transcript.delta',delta:greeting,start_ms:0,end_ms:1000});
  await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'));
  f.engine.playback({idle:true,version:1});await f.engine.flush();
  assert.equal(f.events.find(e=>e.type==='response.output_audio_transcript.done').transcript,greeting);
  assert.equal(f.sent.filter(e=>['session.commentary.append','session.instructions.append'].includes(e.type)).length,0);
  assert.ok(calls.length);f.engine.close();
 }finally{f.engine.close();}
});
for(const language of ['en','es'])for(const callerAsks of [false,true])for(const invitedEarly of [false,true])test(`${language}: selection ${invitedEarly?'with an early invitation':'acknowledgment only'} and ${callerAsks?'an arriving caller question':'a name-only selection'} keep one native continuation through later refresh`,async()=>{
 const input={mode:'planning',role:'parent',language,studentId:'aiden',targetConfirmed:true,routeConversations:true,profile:{id:'aiden',name:'Aiden',school:'Synthetic Community College'}};
 input.openingBrief=buildOpeningBrief(input);
 const f=fixture({config:{language,tools:[{name:'request_conversation_target'}]},scope:{sessionId:'physical-call',studentId:null,confirmed:false}});
 try{
  f.engine.receive({type:'session.input_transcript.delta',delta:'Aiden'});
  await until(()=>f.events.some(e=>e.type==='input_audio_buffer.speech_started'));
  await f.engine.flush();
  f.call([tool('request_conversation_target','choose',{scope:'student:aiden'})]);
  await until(()=>f.events.some(e=>e.controlLease));const lease=f.events.find(e=>e.controlLease).controlLease;
  const acknowledgment=language==='en'?'Thanks.':'Gracias.';
  f.engine.receive({type:'session.output_transcript.delta',delta:acknowledgment});
  await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'&&e.delta===acknowledgment));
  const invitation=language==='en'?' What would you like help with?':' ¿Con qué te gustaría recibir ayuda?';
  if(invitedEarly){
   f.engine.receive({type:'session.output_transcript.delta',delta:invitation});
   await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'&&e.delta===invitation));
  }
  await f.engine.configure({...config,language,...studentLiveUpdate(input)}, {sessionId:'physical-call',studentId:'aiden',confirmed:true},'first-selection');
  assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='research-state'),'first selection must not report a cancelled or missing lookup');
  assert.equal(f.jobs.length,0,'selecting the student does not start research');
  const packets=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='selected-student-context');
  assert.equal(f.sent.filter(e=>e.type==='session.instructions.append').length,0,'the ordinary introduction must not redirect or interrupt speech');
  assert.equal(packets.length,0,'student facts stay out of voice context before the successful selection receipt');
  const questionParts=language==='en'?['How can he choose ','between colleges?']:['¿Cómo puede elegir ','entre universidades?'];
  if(callerAsks){
   f.engine.receive({type:'session.input_transcript.delta',delta:questionParts[0]});
   await until(()=>f.events.filter(e=>e.type==='input_audio_buffer.speech_started').length===2);
  }
  await pause(0);assert.ok(!f.events.some(e=>e.type==='session.updated'));
  f.engine.receive({type:'session.updated',client_event_id:'first-selection'});
  await until(()=>f.events.some(e=>e.type==='session.updated'));
  assert.equal(f.events.find(e=>e.type==='origen.configuration.applied').contextDelivery,'staged_for_selection');
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,0,'context delivery alone cannot open a second speaking turn');
  const receipt=voiceTargetResult(true,'Aiden');
  assert.equal(f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(receipt)}},lease),true);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
  const delivered=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
  assert.deepEqual(delivered.selectionContext.openingBrief,input.openingBrief,'the backend retains the complete authorized brief');
  const snapshots=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='confirmed-student-brief');
  assert.equal(snapshots.length,1);assert.ok(new TextEncoder().encode(snapshots[0].content).length<=480);
  assert.equal(JSON.parse(snapshots[0].content).profile.school,'Synthetic Community College');
  f.engine.receive({type:'session.thinking.appended',client_event_id:snapshots[0].event_id,start_ms:1000,end_ms:1400});
  await until(()=>f.events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged'));
  assert.equal(delivered.status,receipt.status);
  assert.equal(delivered.selectionDelivery.mode,callerAsks?'caller_first':invitedEarly?'leave_floor':'conditional_recap');
  assert.equal(delivered.selectionDelivery.assistantQuestionObserved,invitedEarly);
  assert.equal(delivered.selectionDelivery.callerSpeechObserved,callerAsks);
  if(!callerAsks&&!invitedEarly)assert.equal(delivered.instruction,receipt.instruction);
  else assert.doesNotMatch(delivered.instruction,/then invite their priority/);
  if(callerAsks){
   // The caller still owns the microphone when the receipt returns. Their
   // remaining words stay in the native conversation, never a replayed prompt.
   assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').length,1);
   f.engine.receive({type:'session.input_transcript.delta',delta:questionParts[1]});await pause(0);
  }
  await f.engine.flush();
  assert.deepEqual(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').map(e=>e.transcript),callerAsks?['Aiden',questionParts.join('')]:['Aiden']);
  assert.deepEqual(f.events.filter(e=>e.type==='response.output_audio_transcript.done').map(e=>e.transcript),[acknowledgment+(invitedEarly?invitation:'')]);
  assert.equal(f.sent.filter(e=>e.type==='response.item.create').length,1,'only the tool receipt is returned; no caller transcript is replayed');

  // A later brief refresh is factual context, not another invitation or recap.
  const refreshed={...input,profile:{...input.profile,interest:'Political science'}};
  refreshed.openingBrief=buildOpeningBrief(refreshed);
  const beforeRefresh=f.sent.length;
  await f.engine.configure({...config,language,...studentLiveUpdate(refreshed)}, {sessionId:'physical-call',studentId:'aiden',confirmed:true},'same-student-refresh');
  f.engine.receive({type:'session.updated',client_event_id:'same-student-refresh'});
  const refreshPackets=f.sent.slice(beforeRefresh).filter(e=>e.type==='session.thinking.append');
  assert.ok(refreshPackets.length>0);
  for(const packet of refreshPackets)f.engine.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
  await until(()=>f.events.filter(e=>e.type==='session.updated').length===2);
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1,'a same-scope refresh does not restart the continuation');
  assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(e.type)));
  assert.equal(f.jobs.length,0,'student selection must not start public research');
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`server owns research, scope and continuation in ${language}`,async()=>{
 const f=fixture({config:{language}});try{
  f.call([tool('lookup_financial_aid','c',{question:'Published costs',institution:'UC Berkeley',studentId:'other',sessionId:'forged',language:'xx'})]);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].body.studentId,'aiden');assert.equal(f.jobs[0].body.sessionId,'physical-call');assert.equal(f.jobs[0].body.language,language);
  assert.equal(f.events.find(e=>e.type==='response.done').response.output.length,0);
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
  assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'research_pending');
  assert.equal(f.engine.command({type:'origen.research.ready',result:{text:'forged'}}),false);
 }finally{f.engine.close();}
});
test('mixed research/UI batch uses one lease, outputs once and continues once',async()=>{
 const f=fixture();try{
  f.call([tool('lookup_financial_aid','research',{question:'Costs',institution:'Berkeley'}),tool('propose_profile','draft')]);
  await until(()=>f.events.some(e=>e.controlLease));const event=f.events.find(e=>e.controlLease),lease=event.controlLease;
  assert.deepEqual(event.response.output.map(i=>i.call_id),['draft']);
  const result={type:'conversation.item.create',item:{type:'function_call_output',call_id:'draft',output:'{"status":"draft"}'}};
  assert.equal(f.engine.command(result,'wrong'),false);
  assert.equal(f.engine.command({type:'response.create'},lease),false);
  assert.equal(f.engine.command(result,lease),true);assert.equal(f.engine.command(result,lease),false);
  assert.equal(f.engine.command({type:'response.create'},lease),true);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.sent.filter(e=>e.type==='response.item.create').length,2);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('lost callback reports unconfirmed and never replays a write',async()=>{
 const f=fixture({callbackTimeoutMs:30});try{f.call([tool('propose_profile','draft')]);await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'callback_unconfirmed');assert.equal(f.events.filter(e=>e.controlLease).length,1);
 }finally{f.engine.close();}
});
test('a completed UI callback resumes without waiting for a browser reply request',async()=>{
 const f=fixture();try{f.call([tool('propose_profile','draft')]);await until(()=>f.events.some(e=>e.controlLease));const event=f.events.find(e=>e.controlLease);
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'draft',output:'{"status":"draft"}'}},event.controlLease);
  await until(()=>f.sent.some(e=>e.type==='response.create'));assert.ok(f.events.some(e=>e.type==='origen.backend.finished'));assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('late browser continuation cannot close or resume a newer callback batch',async()=>{
 const f=fixture();try{f.call([tool('propose_profile','first')],'first-response');await until(()=>f.events.some(e=>e.controlLease));const old=f.events.find(e=>e.controlLease);
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'first',output:'{}'}},old.controlLease);await until(()=>f.events.some(e=>e.type==='origen.backend.finished'));
  f.call([tool('propose_profile','second')],'second-response');await until(()=>f.events.filter(e=>e.controlLease).length===2);
  assert.equal(f.engine.command({type:'response.create'},old.controlLease),true);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('detail follow-ups read the retained report without another external job and cannot cross scopes',async()=>{
 let posts=0;const full='The retained report includes a qualified supporting detail [1].',tools=[...config.tools,{name:'read_research_details'}];
 const f=fixture({config:{tools},jobRequest:async method=>method==='POST'?(posts++,{id:'job-1',status:'queued'}):{status:'completed',result:{text:full,sources:[{url:'https://example.edu/policy'}]}}});
 try{f.call([tool('lookup_financial_aid','lookup',{question:'Costs',institution:'Example'})]);await until(()=>f.events.some(e=>e.type==='origen.research.result'));
  f.call([tool('read_research_details','details',{jobId:'job-1',revision:1})],'read');await until(()=>f.sent.some(e=>e.item?.call_id==='details'));
  const retained=JSON.parse(f.sent.find(e=>e.item?.call_id==='details').item.output);
  assert.equal(retained.text,full);assert.equal(posts,1);
  assert.equal(retained.searchStarted,false);assert.equal(retained.reportState,'completed');
  assert.equal(retained.searchedQuestion,'Costs');assert.equal(retained.institution,'Example');assert.equal(retained.requestId,'lookup');assert.equal(retained.revision,1);
  assert.match(retained.instruction,/not researched, not a failed verification/);assert.match(retained.instruction,/reading it performs no new search/);
  f.call([tool('read_research_details','stale-revision',{jobId:'job-1',revision:2})],'read-stale');await until(()=>f.sent.some(e=>e.item?.call_id==='stale-revision'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='stale-revision').item.output).status,'research_details_unavailable');
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='stale-revision').item.output).searchStarted,false);
  await f.engine.configure({...config,tools},{sessionId:'physical-call',studentId:'other',confirmed:true},'scope');
  f.call([tool('read_research_details','wrong-scope',{jobId:'job-1',revision:1})],'read-other');await until(()=>f.sent.some(e=>e.item?.call_id==='wrong-scope'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='wrong-scope').item.output).status,'research_details_unavailable');assert.equal(posts,1);
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: managed research corrects a finished scenario and preserves the searched scope of each report`,async()=>{
 const posted=[],deleted=[];const questions=language==='en'?['Berkeley residence-hall budget for 2026–27','Berkeley off-campus budget for 2026–27']:['Presupuesto de Berkeley en residencia universitaria para 2026–27','Presupuesto de Berkeley fuera del campus para 2026–27'];
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posted.push(body);return {id:`job-${posted.length}`,status:'queued'};}
  if(method==='DELETE'){deleted.push(id);return {status:'cancelled'};}
  return {status:'completed',result:{text:`Sourced answer for ${id} [1].`,sources:[{url:'https://example.edu/costs'}]}};
 }});
 try{
  f.call([tool('lookup_financial_aid','initial',{question:questions[0],institution:'UC Berkeley'})],'initial-response');
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'),1500);
  f.call([tool('lookup_financial_aid','correction',{question:questions[1],institution:'UC Berkeley',replaceRequestId:'initial',replaceRevision:1,
   replacementChange:{kind:'correct_scope',uncoveredNeed:language==='en'?'Off-campus housing replaces the residence-hall assumption.':'Vivienda fuera del campus sustituye la residencia universitaria.'}})],'correction-response');
  await until(()=>f.sent.some(e=>e.item?.call_id==='correction'));
  const corrected=JSON.parse(f.sent.find(e=>e.item?.call_id==='correction').item.output);
  assert.equal(corrected.status,'research_pending');assert.equal(corrected.revision,2);assert.equal(corrected.requestId,'initial');
  await until(()=>f.events.filter(e=>e.type==='origen.research.result'&&e.status==='completed').length===2,1500);
  for(const [index,revision]of [[1,1],[2,2]]){
   f.call([tool('read_research_details',`detail-${index}`,{jobId:`job-${index}`,revision})],`detail-response-${index}`);
   await until(()=>f.sent.some(e=>e.item?.call_id===`detail-${index}`));
   const report=JSON.parse(f.sent.find(e=>e.item?.call_id===`detail-${index}`).item.output);
   assert.equal(report.searchedQuestion,questions[index-1]);assert.equal(report.researchPending,false);assert.equal(report.revision,revision);
    assert.equal(report.searchStarted,false);assert.equal(report.reportState,'completed');
  }
  assert.equal(posted.length,2);assert.deepEqual(deleted,[]);
  assert.ok(f.events.some(e=>e.type==='origen.research.state_changed'&&e.revision===2&&e.state==='completed'));
  assert.equal(f.sent.some(e=>e.type==='session.instructions.append'),false,'research cannot interrupt speech with steering');
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: server forwards first checked findings while recovery continues, then the final version`,async()=>{
 let posts=0,complete=false;
 const initial={text:'Checked tuition is USD 12000 per year [1].',sources:[{url:'https://example.edu/fees'}],evidenceVersion:1,researchPending:true};
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async method=>method==='POST'?(posts++,{id:'job-1',status:'queued'}):{status:complete?'completed':'running',result:{...initial,text:complete?'Checked tuition is USD 12000 per year; housing is USD 15000 [1].':initial.text,evidenceVersion:complete?2:1,researchPending:!complete}}});
 try{
  f.call([tool('lookup_financial_aid','lookup',{question:'Costs',institution:'Example'})]);
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='running'),1500);
  assert.equal(f.events.filter(e=>e.type==='origen.research.active').at(-1).active,true);
  f.call([tool('read_research_details','initial-detail',{jobId:'job-1',revision:1})],'detail');
  await until(()=>f.sent.some(e=>e.item?.call_id==='initial-detail'));
  const details=JSON.parse(f.sent.find(e=>e.item?.call_id==='initial-detail').item.output);
  assert.equal(details.text,initial.text);assert.equal(details.researchPending,true);assert.equal(posts,1);
  assert.equal(details.searchStarted,false);assert.equal(details.reportState,'running','reading the partial report does not restart its existing recovery');
  complete=true;
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'),1500);
  assert.equal(f.events.filter(e=>e.type==='origen.research.result').length,2);
  assert.equal(f.events.filter(e=>e.type==='origen.research.active').at(-1).active,false);
  assert.equal(posts,1);
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: a completed unverified report is a terminal answer, not a new or pending search`,async()=>{
 const question=language==='en'?'What is the off-campus total at UC Irvine?':'¿Cuál es el costo total fuera del campus en UC Irvine?';
 const text=language==='en'?'The requested UC Irvine off-campus total could not be verified from the checked official sources.':'No se pudo verificar el costo total solicitado fuera del campus en UC Irvine con las fuentes oficiales consultadas.';
 let posts=0;
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async method=>method==='POST'?(posts++,{id:'irvine',status:'queued'}):{status:'completed',result:{text,sources:[{url:'https://www.uci.edu/'}]}}});
 try{
  f.call([tool('lookup_financial_aid','irvine-search',{question,institution:'UC Irvine'})],'search');
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'));
  const beforeRead=f.sent.length;
  f.call([tool('read_research_details','irvine-detail',{jobId:'irvine',revision:1})],'read');
  await until(()=>f.sent.some(e=>e.item?.call_id==='irvine-detail'));
  const receipt=JSON.parse(f.sent.find(e=>e.item?.call_id==='irvine-detail').item.output);
  assert.equal(receipt.status,'cached_research_details');assert.equal(receipt.searchStarted,false);
  assert.equal(receipt.reportState,'completed');assert.equal(receipt.researchPending,false);
  assert.equal(receipt.text,text);assert.equal(receipt.searchedQuestion,question);assert.equal(posts,1);
  assert.match(receipt.instruction,/completed means the check ended, even when a requested fact remains unverified/);
  assert.match(receipt.instruction,/Do not announce checking when reusing this report/);
  assert.match(receipt.instruction,/source-supported material qualification/);
  const followup=f.sent.slice(beforeRead);
  assert.equal(followup.filter(e=>e.type==='response.item.create').length,1);
  assert.equal(followup.filter(e=>e.type==='response.create').length,1,'one normal tool continuation');
  assert.ok(!followup.some(e=>['session.commentary.append','session.instructions.append','response.cancel','output_audio_buffer.clear'].includes(e.type)),'local report read adds no spoken announcement or interruption');
 }finally{f.engine.close();}
});
test('provider session ACL blocks primary tool/control writes only when negotiated',()=>{
 const base={instructions:'policy',tools:[]},input={language:'en',voiceControlProtocol:'server-v1'};
 assert.equal(studentLiveSession(base,input).client,undefined);
 assert.deepEqual(studentLiveSession(base,input,[],{ORIGEN_LIVE_SERVER_CONTROL:'true'}).client.data_channel,{allowed_client_events:['session.close'],allowed_server_events:[]});
 assert.equal(studentLiveSession(base,{language:'en'},[],{ORIGEN_LIVE_SERVER_CONTROL:'true'}).client,undefined);
});
class Provider extends EventEmitter{
 constructor(){super();this.readyState=WebSocket.CONNECTING;this.sent=[];setImmediate(()=>{this.readyState=WebSocket.OPEN;this.emit('open');});}
 send(text){this.sent.push(JSON.parse(text));}close(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;this.emit('close');}
}
async function transportFixture(options={}){
 let revision=1;const providers=[],urls=[],logs=[];
 const control=createVoiceControl({productionSessionFactory:options.productionSessionFactory,resumeGraceMs:options.resumeGraceMs,heartbeatIntervalMs:options.heartbeatIntervalMs,env:{ORIGEN_LIVE_SERVER_CONTROL:'true',ORIGEN_BACKGROUND_RESEARCH:'true',ALLOWED_ORIGINS:'http://allowed.test',...options.env},authenticate:async token=>{if(!['owner','other'].includes(token))throw Error('invalid');return {sub:token};},authorize:async()=>revision,request:options.request|| (async()=>({})),log:event=>logs.push(event),connect:url=>{urls.push(url);const socket=new Provider();providers.push(socket);return socket;}});
 const server=createServer();control.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const receipt=(providerId='live_session_prefixed')=>control.register({subject:'owner',permissionRevision:1,providerId,sessionId:'call',scope:{sessionId:'call',studentId:'aiden',confirmed:true},config:{...config,...options.config}});
 const connect=async(origin='http://allowed.test',socketOptions={})=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/voice-control`,{...socketOptions,origin});ws.on('error',()=>{});const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');return {ws,messages};};
 return {control,receipt,connect,providers,urls,logs,base:`http://127.0.0.1:${server.address().port}`,revoke:()=>revision++,async close(){control.close();await new Promise(r=>server.close(r));}};
}
test('bridge verifies ownership, preserves provider ID, and closes on permission revision',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
  await until(()=>messages.some(e=>e.type==='ready'));assert.match(f.urls[0],/\/live_session_prefixed\/attach$/);
  assert.ok(!f.providers[0].sent.some(e=>e.type==='session.start'));
  f.revoke();await once(ws,'close');assert.ok(f.providers[0].sent.some(e=>e.type==='session.close'));
  assert.ok(!JSON.stringify(f.logs).includes('owner'));
 }finally{await f.close();}
});
for(const language of ['en','es'])test(`${language}: provider voice is confirmed across the actual control socket on connect and reconnect without holding speech`,async()=>{
 const f=await transportFixture({config:{language,requestedVoice:'marin'}});
 try{
  for(const [index,providerVoice] of [[0,'marin'],[1,'cedar']]){
   const providerId=`live-connection-${index}`,receipt=f.receipt(providerId),{ws,messages}=await f.connect();
   ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
   await until(()=>messages.some(e=>e.event?.type==='origen.provider.voice'));
   const pending=messages.find(e=>e.event?.type==='origen.provider.voice').event;
   assert.equal(pending.status,'pending');assert.equal(pending.providerVoice,null);assert.equal(pending.requestedVoice,'marin');assert.equal(pending.providerSessionId,providerId);
   assert.ok(messages.some(e=>e.type==='ready'),'control readiness does not wait for voice confirmation');
   const provider=f.providers[index],probe=provider.sent.find(e=>e.type==='session.update'&&Object.keys(e.session).length===0);
   assert.ok(probe);assert.equal(provider.sent.filter(e=>e.type==='session.update').length,1);
   provider.emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:language==='en'?'Of course.':'Claro.'})));
   await until(()=>messages.some(e=>e.event?.type==='response.output_audio_transcript.delta'));
   provider.emit('message',Buffer.from(JSON.stringify({type:'session.updated',event_id:'provider-confirmed',client_event_id:probe.event_id,session:{id:providerId,model:'gpt-live-1',audio:{output:{voice:providerVoice}},instructions:'PRIVATE',client_secret:'SECRET'}})));
   await until(()=>messages.some(e=>e.event?.type==='origen.provider.voice'&&e.event.providerVoice));
   const result=capturePayload(messages.find(e=>e.event?.type==='origen.provider.voice'&&e.event.providerVoice).event);
   assert.equal(result.status,index?'mismatch':'confirmed');assert.equal(result.providerVoice,providerVoice);assert.equal(result.source,'session.updated');
   assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);
   assert.ok(!messages.some(e=>e.event?.type==='session.updated'),'diagnostic ACK cannot complete an application configuration update');
   ws.close();await once(ws,'close');
  }
 }finally{await f.close();}
});
test('overlapping callback batches keep their own lease and resume only after all results',async()=>{
 const f=fixture();try{
  f.call([tool('propose_profile','first')],'r1');await until(()=>f.events.some(e=>e.controlLease));
  f.call([tool('propose_profile','second')],'r2');await until(()=>f.events.filter(e=>e.controlLease).length===2);
  const events=f.events.filter(e=>e.controlLease);
  for(const event of events){const call=event.response.output[0];assert.equal(f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:'{}'}},event.controlLease),true);assert.equal(f.engine.command({type:'response.create'},event.controlLease),true);await pause(0);}
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('language callback completes before server research in the same batch',async()=>{
 const f=fixture({config:{tools:[...config.tools,{name:'set_conversation_language'}]}});try{
  f.call([tool('lookup_financial_aid','research',{question:'Costos oficiales',institution:'Berkeley'}),tool('set_conversation_language','language',{language:'es'})]);
  await until(()=>f.events.some(e=>e.controlLease));assert.equal(f.jobs.length,0);
  const event=f.events.find(e=>e.controlLease);await f.engine.configure({...config,language:'es'},{sessionId:'physical-call',studentId:'aiden',confirmed:true},'language-update');
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'language',output:'{"status":"language_updated"}'}},event.controlLease);f.engine.command({type:'response.create'},event.controlLease);
  await until(()=>f.jobs.length);assert.equal(f.jobs[0].body.language,'es');
 }finally{f.engine.close();}
});
test('malformed authenticated control messages fail closed',async()=>{
 const f=await transportFixture();try{const {ws}=await f.connect();ws.send('null');const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(f.providers.length,0);}finally{await f.close();}
});
test('simultaneous claims cannot acquire two native writers',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),first=await f.connect(),second=await f.connect();
  for(const client of [first,second])client.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
  await until(()=>[first,second].some(client=>client.messages.some(m=>m.type==='ready')));await pause(20);assert.equal(f.providers.length,1);
  first.ws.close();second.ws.close();
 }finally{await f.close();}
});
test('guide updates are account/call bound, language-only changes use server policy',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt();assert.throws(()=>f.control.stage(receipt.id,'other',config,{sessionId:'call'}));assert.throws(()=>f.control.stage(receipt.id,'owner',config,{sessionId:'different'}));
  const {ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(m=>m.type==='ready'));
  const {voiceLanguageInstructions}=await import('../src/voiceLanguage.mjs');
  ws.send(JSON.stringify({type:'event',event:{type:'session.update',event_id:'spanish',session:{controlLanguage:'es',instructions:voiceLanguageInstructions(config.instructions,'es')}}}));
  await until(()=>f.providers[0].sent.some(e=>e.type==='session.update'&&e.event_id==='spanish'));const update=f.providers[0].sent.find(e=>e.type==='session.update'&&e.event_id==='spanish');assert.match(update.session.delegation.responses.instructions,/Spanish/);
  ws.send(JSON.stringify({type:'event',event:{type:'session.update',session:{controlLanguage:'es',instructions:'invented policy',tools:[]}}}));await once(ws,'close');
 }finally{await f.close();}
});
for(const language of ['en','es'])test(`server polls worker and injects acknowledged evidence quietly (${language})`,async()=>{
 let reads=0;const f=fixture({config:{language},jobRequest:async(method,id,body)=>method==='POST'?{id:'job-1',status:'queued'}:method==='GET'?(reads++,{id,status:'completed',result:{text:'Verified published estimate; not a personal aid award.',sources:[{url:'https://example.edu/costs',title:'Published costs'}]}}):{id,status:'cancelled'}});
 try{f.call([tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Berkeley'})]);await until(()=>reads>0);
  await until(()=>f.sent.some(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'));
  const evidence=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence');
  assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.match(evidence.map(e=>JSON.parse(e.content).text).join(''),/not a personal aid award/);
  for(const e of evidence)f.engine.receive({type:'session.thinking.appended',client_event_id:e.event_id});
  await until(()=>f.events.some(e=>e.type==='origen.research.context_acknowledged'));assert.ok(f.events.some(e=>e.type==='origen.control.tool_result'));
 }finally{f.engine.close();}
});
test('browser facade and sideband owner complete a mixed tool batch over a real WebSocket',async()=>{
 const jobs=[],events=[],primaryWrites=[];
 const f=await transportFixture({request:async(token,method,path,body)=>{jobs.push({token,method,path,body});return method==='POST'?{id:'job-1',status:'queued'}:{status:'running'};}});
 const raw={readyState:'connecting',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1});
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 channel.onmessage=event=>{const e=JSON.parse(event.data);events.push(e);if(e.controlLease){
  for(const item of e.response.output)channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:'{"status":"draft"}'}}));
  channel.send(JSON.stringify({type:'response.create'}));
 }};
 try{const receipt=f.receipt();await channel.configure({voiceControl:receipt},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});raw.readyState='open';raw.onopen({});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  native({type:'response.created',response:{id:'r'}});
  for(const item of [tool('lookup_financial_aid','lookup',{question:'Cost?',institution:'Berkeley'}),tool('propose_profile','draft')])native({type:'response.output_item.done',response_id:'r',item});
  native({type:'response.completed',response:{id:'r'}});
  await until(()=>provider.sent.some(e=>e.type==='response.create'));
  assert.equal(provider.sent.filter(e=>e.type==='response.item.create').length,2);assert.equal(provider.sent.filter(e=>e.type==='response.create').length,1);
  assert.equal(jobs[0].token,'owner');assert.equal(jobs[0].body.studentId,'aiden');assert.equal(primaryWrites.length,0);
  assert.ok(events.some(e=>e.type==='origen.control.tool_result'));assert.deepEqual(events.find(e=>e.controlLease).response.output.map(i=>i.name),['propose_profile']);
 }finally{channel.close();await f.close();}
});
test('another account cannot claim a control ID or open a provider sideband',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),{ws}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id}));const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(f.providers.length,0);}finally{await f.close();}
});
test('browser disconnect closes provider with no replay or second owner',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));ws.close();await once(ws,'close');await until(()=>f.providers[0].readyState===WebSocket.CLOSED);
  const next=await f.connect();next.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await once(next.ws,'close');assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('overlapping quiet-boundary RPCs share the observation without closing the call',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  for(const id of ['wait-one','wait-two'])ws.send(JSON.stringify({type:'rpc',method:'settle',id}));
  await pause(25);assert.equal(ws.readyState,WebSocket.OPEN);assert.equal(messages.filter(e=>e.type==='reply').length,0);
  ws.send(JSON.stringify({type:'playback',idle:true,version:1}));
  await until(()=>messages.filter(e=>e.type==='reply').length===2);
  assert.deepEqual(messages.filter(e=>e.type==='reply').map(e=>[e.id,e.value]),[['wait-one',true],['wait-two',true]]);
  assert.equal(f.providers.length,1);assert.ok(!f.logs.some(e=>e.event==='voice.control.closed'));
 }finally{await f.close();}
});

test('abnormal transport loss resumes the same provider and research after fresh owner verification',async()=>{
 const jobs=[],f=await transportFixture({request:async(token,method,path,body)=>{jobs.push({method,body});return method==='POST'?{id:'retained-job',status:'queued'}:{status:'running'};}});
 try{
  const receipt=f.receipt(),first=await f.connect();first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  for(const event of [{type:'response.created',response:{id:'lookup'}},{type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Example'})},{type:'response.completed',response:{id:'lookup'}}])native(event);
  await until(()=>jobs.some(j=>j.method==='POST'));first.ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  assert.equal(provider.readyState,WebSocket.OPEN);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  provider.emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'Continuing the same conversation.'})));
  const wrong=await f.connect();wrong.ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id}));assert.equal((await once(wrong.ws,'close'))[0],1008);
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>resumed.messages.some(e=>e.type==='ready'));
  assert.equal(resumed.messages[0].resumed,true);await until(()=>resumed.messages.some(e=>e.event?.type==='response.output_audio_transcript.delta'));
  assert.equal(f.providers.length,1);assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  assert.equal(provider.sent.filter(e=>e.type==='session.close').length,0);
  resumed.ws.send(JSON.stringify({type:'playback',idle:true,version:1}));resumed.ws.send(JSON.stringify({type:'rpc',method:'settle',id:'resumed-wait'}));
  await until(()=>resumed.messages.some(e=>e.type==='reply'&&e.id==='resumed-wait'),3000);
 }finally{await f.close();}
});

test('resume grace expires without keeping the provider or worker alive indefinitely',async()=>{
 const f=await transportFixture({resumeGraceMs:50});try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.reason==='resume_timeout'));
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);assert.ok(f.providers[0].sent.some(e=>e.type==='session.close'));
  const late=await f.connect();late.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(late.ws,'close'))[0],1008);assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('detached event overflow closes safely instead of resuming an incomplete buffered stream',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  for(let i=0;i<270;i++)f.providers[0].emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'word '})));
  await until(()=>f.logs.some(e=>e.reason==='resume_buffer_exceeded'));
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
 }finally{await f.close();}
});

test('explicit close ends the session immediately instead of starting transport grace',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.send(JSON.stringify({type:'close'}));assert.equal((await once(ws,'close'))[0],1000);
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);assert.ok(!f.logs.some(e=>e.event==='voice.control.detached'));
 }finally{await f.close();}
});

test('revoked permission cannot reattach during transport grace',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));f.revoke();
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
  await until(()=>f.providers[0].readyState===WebSocket.CLOSED,1500);assert.ok(f.logs.some(e=>e.reason==='permission_changed'));
 }finally{await f.close();}
});

test('verified resume retries a still-attached socket without taking over its writer',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),first=await f.connect();first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  const early=await f.connect();early.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));
  const [code,reason]=await once(early.ws,'close');assert.equal(code,1013);assert.equal(reason.toString(),'control_still_attached');
  assert.equal(first.ws.readyState,WebSocket.OPEN);assert.equal(f.providers.length,1);
  const wrong=await f.connect();wrong.ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id,resume:true}));assert.equal((await once(wrong.ws,'close'))[0],1008);
  first.ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));await until(()=>resumed.messages.some(e=>e.type==='ready'&&e.resumed));
  assert.equal(f.providers.length,1);assert.ok(!f.providers[0].sent.some(e=>e.type==='session.close'));
 }finally{await f.close();}
});

test('protocol heartbeat detects a half-open client and preserves its provider for resume',async()=>{
 const f=await transportFixture({heartbeatIntervalMs:30});try{
  const receipt=f.receipt(),first=await f.connect('http://allowed.test',{autoPong:false});let pings=0;first.ws.on('ping',()=>pings++);
  first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  assert.equal((await once(first.ws,'close'))[0],1006);assert.equal(pings,2);
  await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));assert.equal(f.providers[0].readyState,WebSocket.OPEN);
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));await until(()=>resumed.messages.some(e=>e.type==='ready'&&e.resumed));
  await pause(150);assert.equal(resumed.ws.readyState,WebSocket.OPEN,'responsive pongs keep a healthy transport open');assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('browser automatically resumes a real control socket and receives retained research once',async()=>{
 const jobs=[],events=[],sockets=[];let finishResearch,opens=0;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},request:async(token,method)=>{
  jobs.push(method);if(method==='POST')return {id:'persistent-job',status:'queued'};
  if(method==='GET')return new Promise(resolve=>{finishResearch=resolve;});return {status:'cancelled'};
 }});
 const primaryWrites=[],raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1});channel.onopen=()=>opens++;channel.onmessage=e=>events.push(JSON.parse(e.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});sockets.push(this);}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  for(const event of [{type:'response.created',response:{id:'lookup'}},{type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Example'})},{type:'response.completed',response:{id:'lookup'}}])native(event);
  await until(()=>finishResearch,1500);sockets[0].terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  finishResearch({status:'completed',result:{text:'Verified published cost [1].',sources:[{url:'https://example.edu/costs'}]}});
  await until(()=>f.logs.some(e=>e.event==='voice.control.resumed'),2000);
  await until(()=>events.some(e=>e.type==='origen.research.result'&&e.status==='completed'));
  assert.equal(events.filter(e=>e.type==='origen.research.result'&&e.status==='completed').length,1);
  assert.equal(jobs.filter(m=>m==='POST').length,1);assert.equal(jobs.filter(m=>m==='DELETE').length,0);
  assert.equal(opens,1);assert.equal(f.providers.length,1);assert.equal(primaryWrites.length,0);assert.equal(raw.readyState,'open');
  channel.close();await until(()=>provider.readyState===WebSocket.CLOSED);
 }finally{channel.close();await f.close();}
});

test('policy rejection records its actual safe reason and is never resumable',async()=>{
 const {diagnosticRecord}=await import('./diagnostics.mjs');const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.send(JSON.stringify({type:'event',event:{type:'untrusted-command',secret:'never log this'}}));assert.equal((await once(ws,'close'))[0],1008);
  await until(()=>f.logs.some(e=>e.event==='voice.control.closed'));
  const record=diagnosticRecord(f.logs.find(e=>e.event==='voice.control.closed'));
  assert.equal(record.reason,'invalid_command');assert.doesNotMatch(JSON.stringify(record),/never log this/);
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
 }finally{await f.close();}
});

test('delivery v2 retains both completed reports for a comparison, fenced by revision and student',async()=>{
 let posts=0;const full=id=>`Detailed verified report for ${id}.`,tools=[...config.tools,{name:'read_research_details'}];
 const f=fixture({researchDeliveryV2:true,config:{tools},jobRequest:async(method,id)=>method==='POST'?{id:'job-'+(++posts),status:'queued'}:method==='GET'?{status:'completed',result:{text:full(id),sources:[]}}:{status:'cancelled'}});
 try{
  for(const [index,institution] of [[1,'Berkeley'],[2,'Davis']]){
   f.call([tool('lookup_financial_aid','lookup-'+index,{question:'Published cost at '+institution,institution})],'response-'+index);
   await until(()=>f.events.filter(e=>e.type==='origen.research.result').length===index);
  }
  for(const index of [1,2]){
   f.call([tool('read_research_details','details-'+index,{jobId:'job-'+index,revision:1})],'read-'+index);
   await until(()=>f.sent.some(e=>e.item?.call_id==='details-'+index));
   assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='details-'+index).item.output).text,full('job-'+index));
  }
  assert.equal(posts,2,'a comparison must not launch new research');
  f.call([tool('read_research_details','stale',{jobId:'job-1',revision:2})],'stale');await until(()=>f.sent.some(e=>e.item?.call_id==='stale'));
  const unavailable=JSON.parse(f.sent.find(e=>e.item?.call_id==='stale').item.output);
  assert.equal(unavailable.status,'research_details_unavailable');assert.equal(unavailable.availableReports.length,2);
  await f.engine.configure({...config,tools},{sessionId:'physical-call',studentId:'other',confirmed:true},'scope');
  f.call([tool('read_research_details','cross-scope',{jobId:'job-1',revision:1})],'cross-scope');await until(()=>f.sent.some(e=>e.item?.call_id==='cross-scope'));
  assert.deepEqual(JSON.parse(f.sent.find(e=>e.item?.call_id==='cross-scope').item.output).availableReports,[]);
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`delivery v2 crosses the real browser control socket without cutting into speech (${language})`,async()=>{
 const answer=language==='en'?'The published annual tuition is 12345 dollars at Example University.':'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.';
 const qualification=language==='en'?'Housing is separate.':'La vivienda es aparte.';
 const events=[],jobs=[],primaryWrites=[];let idle=false,sound=0;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},config:{language},request:async(token,method,path,body)=>{
  jobs.push({method,body});return method==='POST'?{id:'job-delivery',status:'queued'}:method==='GET'?{status:'completed',result:{text:answer+'\n'+qualification,sources:[]}}:{status:'cancelled'};
 }});
 const raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>idle,getPlaybackVersion:()=>sound});
 channel.onmessage=event=>events.push(JSON.parse(event.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify(event)));
  const backend=event=>native({type:'response.event',delegation_id:'delegation',event});
  native({type:'session.input_transcript.delta',delta:language==='en'?'Can we discuss essays while you check?':'¿Podemos hablar de los ensayos mientras investigas?'});
  backend({type:'response.created',response:{id:'lookup'}});
  backend({type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published tuition',institution:'Example'})});
  backend({type:'response.completed',response:{id:'lookup'}});
  await until(()=>events.some(e=>e.type==='origen.research.supplied'));
  for(const e of provider.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'))native({type:'session.thinking.appended',client_event_id:e.event_id});
  await until(()=>events.some(e=>e.type==='origen.research.context_acknowledged'));
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0);
  await pause(450); // Caller transcript has settled; playback is still busy.
  native({type:'session.output_transcript.delta',delta:language==='en'?'We can start with the story you want to share.':'Podemos empezar con la historia que quieres compartir.'});sound++;
  await pause(1900);assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0,'no commentary while audio is playing');
  idle=true;await until(()=>provider.sent.some(e=>e.type==='session.commentary.append'),6000);
  const contribution=provider.sent.find(e=>e.type==='session.commentary.append');native({type:'session.commentary.appended',client_event_id:contribution.event_id});
  await until(()=>events.some(e=>e.deliveryStage==='commentary_acknowledged'));
  assert.ok(!events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'acknowledgment is not evidence of speech');
  idle=false;native({type:'session.output_transcript.delta',delta:answer+' '+qualification});sound++;
  await pause(1900);idle=true;await until(()=>events.some(e=>e.deliveryStage==='evidence_overlap_observed'),3000);
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs[0].body.language,language);
  assert.equal(primaryWrites.length,0);assert.ok(!provider.sent.some(e=>['response.cancel','session.input_audio.mute','session.instructions.append'].includes(e.type)));
  assert.ok(f.logs.some(e=>e.deliveryStage==='reply_observed'));assert.equal(f.logs.filter(e=>e.event==='voice.research.delivery'&&e.deliveryStage==='commentary_requested').length,1);
  // Check the protected amount as a standalone value, not five digits that
  // may coincidentally occur inside a random identifier or timestamp.
  assert.ok(!/\b12345\b/u.test(JSON.stringify(f.logs)));
  assert.ok(!JSON.stringify(f.logs).includes(answer));
 }finally{channel.close();await f.close();}
});

for(const [language,{answer,spoken}] of Object.entries(discussionExamples))test(`${language}: covered clarification keeps one worker job and its native paraphrase is not announced again over the control socket`,async()=>{
 const events=[],jobs=[],primaryWrites=[];let idle=false,sound=0,complete=false;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},config:{language},request:async(token,method,path,body)=>{
  jobs.push({method,body});return method==='POST'?{id:'job-original',status:'queued'}:method==='GET'?{status:complete?'completed':'running',...(complete?{result:{text:answer,sources:[]}}:{})}:{status:'cancelled'};
 }});
 const raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>idle,getPlaybackVersion:()=>sound});channel.onmessage=e=>events.push(JSON.parse(e.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=e=>provider.emit('message',Buffer.from(JSON.stringify(e)));
  const lookup=(callId,args)=>{for(const event of [{type:'response.created',response:{id:callId}},{type:'response.output_item.done',response_id:callId,item:tool('lookup_financial_aid',callId,args)},{type:'response.completed',response:{id:callId}}])native({type:'response.event',delegation_id:'delegation-'+callId,event});};
  const question=language==='en'?'Berkeley 2026–27 budgets comparing living on campus, off campus and with parents.':'Presupuestos de Berkeley 2026–27 dentro del campus, fuera del campus y con padres.';
  lookup('initial',{question,institution:'Berkeley'});
  await until(()=>provider.sent.some(e=>e.item?.call_id==='initial'));
  native({type:'session.input_transcript.delta',delta:language==='en'?'He is considering near campus, not on campus, compared with home.':'Quiere comparar vivir cerca del campus, no dentro, con vivir en casa.'});
  lookup('focus',{question:language==='en'?'Compare near-campus living and home.':'Compara vivir cerca del campus y en casa.',institution:'Berkeley',replaceRequestId:'initial',replaceRevision:1,replacementChange:{kind:'focus_existing',uncoveredNeed:''}});
  await until(()=>provider.sent.some(e=>e.item?.call_id==='focus'));
  const receipt=JSON.parse(provider.sent.find(e=>e.item?.call_id==='focus').item.output);
  assert.equal(receipt.jobId,'job-original');assert.equal(receipt.revision,1);assert.equal(receipt.reuseReason,'already_covered');assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  complete=true;await until(()=>events.some(e=>e.type==='origen.research.supplied'));
  await until(()=>events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
  // Native conversation starts using the finding before the estimated context
  // injection ACK, just as it did in the reported production session.
  native({type:'session.output_transcript.delta',delta:spoken});sound++;
  for(const e of provider.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'))native({type:'session.thinking.appended',client_event_id:e.event_id});
  await pause(1900);idle=true;
  await until(()=>events.some(e=>e.deliveryStage==='evidence_overlap_observed'),3000);
  native({type:'session.input_transcript.delta',delta:language==='en'?'Yes, that was very informative.':'Sí, eso me ayuda mucho.'});
  await pause(500);idle=false;native({type:'session.output_transcript.delta',delta:language==='en'?'Mm-hmm.':'Claro.'});sound++;
  await pause(1900);idle=true;await pause(4000);
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0,'no redundant result or caveat after the acknowledgment');
  assert.equal(provider.sent.filter(e=>e.type==='response.create').length,2,'one continuation per actual tool batch, none for delivery');
  assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  assert.equal(primaryWrites.length,0,'no browser provider writes during research or speech');
  assert.ok(!provider.sent.some(e=>['response.cancel','session.input_audio.mute','session.instructions.append'].includes(e.type)));
 }finally{channel.close();await f.close();}
});

for(const enabled of [false,true])test('authenticated socket selects production Decisions factory only when enabled: '+enabled,async()=>{
 const received=[];const f=await transportFixture({env:{NODE_ENV:'production',ORIGEN_DECISIONS_SUPPORT:String(enabled)},productionSessionFactory:options=>{received.push(options);return voiceControlSession(options);}});
 try{const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
 await until(()=>messages.some(row=>row.type==='ready'));assert.equal(received.length,enabled?1:0);
 if(enabled){assert.equal(received[0].subject,'owner');assert.equal(received[0].scope.studentId,'aiden');assert.equal(received[0].config.instructions,config.instructions);}
 assert.equal(f.providers[0].sent.filter(row=>['session.instructions.append','session.commentary.append'].includes(row.type)).length,0);
 }finally{await f.close();}
});

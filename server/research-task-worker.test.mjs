import test from 'node:test';
import assert from 'node:assert/strict';
import {processResearchJob} from './voice-research-worker.mjs';
import {createResearchTask,auditResearchTask} from '../src/researchTask.mjs';
import {researchRecoveryPlan,mergeRecoveryResearch,researchRecoveryOutcome} from './research-recovery.mjs';
import {publicRecord,publicFact,recordFixture} from './research-record.fixtures.mjs';
import {parseResearchBrief,researchBriefRequest} from './research-brief.mjs';

function provider(payload,url='https://eastview.edu/policy'){
 const text=JSON.stringify(payload).replaceAll('[1]','CITE');
 return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},
  {type:'message',content:[{type:'output_text',text,annotations:[...text.matchAll(/CITE/gu)].map(m=>({type:'url_citation',url,start_index:m.index,end_index:m.index+4}))}]}]};
}
function database(input){let claimed=false;const writes=[];return {writes,async query(sql,args){
 if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'task-test',input}]};}
 writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};
}};}
const saved=db=>db.writes.find(w=>w.sql.includes("status='completed'"))?.args[1];
for(const language of ['en','es']){
 test(`${language}: scoped support-office recovery preserves known contact and requests only missing hours`,()=>{
  const input={mode:'planning',language,institution:'UC Davis',question:language==='es'?'Contacto y horario de First-Generation Initiative en UC Davis':'Contact and hours for First-Generation Initiative at UC Davis'},task=createResearchTask(input);
  const record=publicRecord('student_support',language);record.scope.program='First-Generation Initiative';
  const first=recordFixture(language,'student_support','UC Davis First-Generation Initiative',record).result;
  const plan=researchRecoveryPlan(first,{...input,researchTask:task});
  assert.deepEqual(plan.gaps.map(gap=>gap.requiredFacts),[['hours']]);
  assert.equal(plan.gaps[0].subject,'UC Davis First-Generation Initiative');
  assert.equal(plan.gaps[0].knownEvidence.facts[0].key,'contact');
  assert.equal(plan.gaps[0].scope.program,'First-Generation Initiative');
  const unrelated=recordFixture(language,'student_support','UC Berkeley First-Generation Initiative',record).result;
  const other=researchRecoveryPlan(unrelated,{...input,researchTask:task});
  assert.equal(other.gaps[0].subject,'UC Davis');assert.equal(other.gaps[0].knownEvidence,undefined);
  assert.deepEqual(other.gaps[0].requiredFacts,['contact','hours']);
 });
 test(`${language}: rejected date cannot hide a verified fee or bind deadline recovery to that fee`,()=>{
  const input={mode:'admissions',language,institution:'Eastview College',question:language==='es'?'Fecha límite y costo de solicitud':'Application deadline and application fee'},task=createResearchTask(input);
  const deadline=recordFixture(language,'admissions','Eastview College — first-year deadline');
  deadline.payload.brief.findings[0].evidence.facts[0]={...publicFact(),kind:'date',status:'partial',date:null,value:'January 5; year unknown'};
  const fee=publicRecord('admissions',language);fee.facts=[publicFact({key:'application_fee',label:language==='es'?'Costo de solicitud':'Application fee',kind:'amount',amount:100,currency:'USD',unit:'per application',bound:'exact',date:null,time:null,timeZone:null})];fee.expectedFacts=['application_fee'];
  const feeFinding=recordFixture(language,'admissions','Eastview College — first-year application fee',fee).payload.brief.findings[0];feeFinding.aspect='tuition_fees';
  deadline.payload.brief.findings.push(feeFinding);deadline.payload.brief.nextStep='Submit by January 5, 2027';
  const result=parseResearchBrief({text:JSON.stringify(deadline.payload),sources:[deadline.source]},language);
  assert.match(result.voiceBrief.answer,/100/);assert.match(result.voiceBrief.qualification,language==='es'?/fecha límite.*confirmar/:/deadline.*confirmed/);
  assert.doesNotMatch(result.text,/structured|validated|earlier data|January 5/);assert.equal(result.voiceBrief.nextStep,'');assert.equal(result.voiceBrief.findings[0].status,'unverified');
  assert.equal(result.researchValidation.rejectedRecordCount,1);assert.equal(result.voiceBrief.findings[1].evidence.facts[0].amount,100);
  const plan=researchRecoveryPlan(result,{...input,researchTask:task});assert.equal(plan.gaps.length,1);assert.equal(plan.gaps[0].aspect,'deadline');assert.deepEqual(plan.gaps[0].requiredFacts,['deadline']);assert.equal(plan.gaps[0].knownEvidence,undefined);
  assert.equal(plan.gaps[0].subject,'Eastview College — first-year deadline');
 });
 test(`${language}: month/day without a verified year remains a partial text fact, never an invented date`,()=>{
  const record=publicRecord('admissions',language);record.complete=false;record.scope.cycle=null;
  record.facts[0]={...record.facts[0],kind:'text',status:'partial',value:language==='es'?'5 de enero':'January 5',date:null,time:null,timeZone:null,qualification:language==='es'?'El año aplicable no está confirmado.':'The applicable year is unconfirmed.'};
  const result=recordFixture(language,'admissions','Eastview College',record).result;
  assert.ok(result.voiceBrief.findings[0].evidence);assert.equal(result.voiceBrief.status,'partial');assert.equal(result.voiceBrief.findings[0].evidence.facts[0].date,null);
  assert.match(researchBriefRequest({input:'{}',instructions:''}).instructions,/month\/day.*kind:text/s);
 });
 test(`${language}: omitted requested deadline triggers only deadline recovery and publishes the award first`,async()=>{
  const input={mode:'planning',language,institution:'Eastview College',question:language==='es'?'Monto de beca y fecha límite':'Scholarship amount and deadline'};
  const firstRecord=publicRecord('scholarships',language);firstRecord.facts=firstRecord.facts.slice(0,1);firstRecord.expectedFacts=['award'];
  const nextRecord=publicRecord('scholarships',language);nextRecord.facts=nextRecord.facts.slice(1);nextRecord.expectedFacts=['deadline'];
  const first=recordFixture(language,'scholarships','Eastview College',firstRecord),next=recordFixture(language,'scholarships','Eastview College',nextRecord);
  next.payload.brief.findings[0].aspect='deadline';
  const db=database(input);let calls=0;
  await processResearchJob(db,{}, {log:()=>{},request:async(_,options)=>{
   const body=JSON.parse(options.body),request=JSON.parse(body.input);calls++;
   assert.ok(body.max_output_tokens<=6000);assert.equal(body.max_tool_calls,2);
   if(calls===2){assert.deepEqual(request.recovery.gaps[0].requiredFacts,['deadline']);assert.deepEqual(request.recovery.previouslyConsultedSources,['https://eastview.edu/policy']);
    const interim=db.writes.find(w=>w.args?.[1]?.researchPending);assert.ok(interim);assert.equal(interim.args[1].requestCoverage.status,'partial');}
   return new Response(JSON.stringify(provider(calls===1?first.payload:next.payload)));
  }});
  assert.equal(calls,2);const result=saved(db);assert.equal(result.requestCoverage.status,'complete');assert.equal(result.researchDiagnostics.recoveryStatus,'recovered');
  assert.equal(result.voiceBrief.findings[0].evidence.facts[0].amount,2500);assert.ok(!result.text.includes('999'));
 });
 test(`${language}: omitted requested entity remains a recovery target even when provider declares complete`,async()=>{
  const input={mode:'planning',language,institution:'Eastview College and Pine Valley College',question:language==='es'?'Compara la fecha límite':'Compare the deadline'};
  const first=recordFixture(language,'admissions','Eastview College'),next=recordFixture(language,'admissions','Pine Valley College'),db=database(input);let calls=0;
  await processResearchJob(db,{}, {log:()=>{},request:async(_,options)=>{
   calls++;if(calls===2){const recovery=JSON.parse(JSON.parse(options.body).input).recovery;assert.equal(recovery.gaps.length,1);assert.equal(recovery.gaps[0].subject,'Pine Valley College');assert.deepEqual(recovery.gaps[0].requiredFacts,['deadline']);}
   return new Response(JSON.stringify(provider(calls===1?first.payload:next.payload,calls===1?'https://eastview.edu/policy':'https://pinevalley.edu/policy')));
  }});
  assert.equal(calls,2);assert.equal(saved(db).requestCoverage.complete,true);assert.equal(saved(db).voiceBrief.findings.length,2);
 });
 test(`${language}: conflicting recovery preserves values as a flagged conflict instead of silently choosing one`,()=>{
  const input={mode:'planning',language,institution:'Eastview College',question:language==='es'?'Monto de beca y fecha límite':'Scholarship amount and deadline'},task=createResearchTask(input);
  const record=publicRecord('scholarships',language);record.facts[1]={...record.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
  const first=recordFixture(language,'scholarships','Eastview College',record).result,nextRecord=publicRecord('scholarships',language);nextRecord.facts[0].amount=3000;
  const next=recordFixture(language,'scholarships','Eastview College',nextRecord).result,plan=researchRecoveryPlan(first,{...input,researchTask:task});
  const merged=mergeRecoveryResearch(first,next,language,plan),fact=merged.voiceBrief.findings[0].evidence.facts[0];
  assert.equal(fact.amount,2500);assert.equal(fact.status,'partial');assert.equal(merged.researchConflicts.length,1);assert.equal(merged.researchConflicts[0].incoming.amount,3000);
  assert.equal(auditResearchTask(task,merged).status,'partial');assert.equal(researchRecoveryOutcome(merged,plan),'partial');
  assert.match(merged.voiceBrief.findings[0].qualification,language==='es'?/valores distintos/:/different values/);
 });
}

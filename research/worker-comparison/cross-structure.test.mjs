import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedResearchRecord} from '../../src/researchRecord.mjs';
import {createResearchTask,auditResearchTask,requestedResearchFacts,researchFindingMatchesTaskEntity,researchProgramScopeMatches} from '../../src/researchTask.mjs';
import {publicRecord,publicFact,recordFixture} from '../../server/research-record.fixtures.mjs';
import {researchRecoveryPlan,recoveryResearchRequest} from '../../server/research-recovery.mjs';
import {createScout,decisionAssessment,scopedScoutCatalog,supplementalPredicateAssessment} from './scout.mjs';
import {createSupplementStore} from './supplement-store.mjs';

for(const language of ['en','es']){
 const es=language==='es';
 test(`${language}: academic cycles normalize without inventing a year or changing the source object`,()=>{
  const record=publicRecord('student_support',language);record.scope.cycle='2026–2027';
  assert.equal(validatedResearchRecord(record,new Set([1])).scope.cycle,'2026-27');assert.equal(record.scope.cycle,'2026–2027');
  record.scope.cycle=es?'Otoño 2026':'Fall 2026';record.scope.term=null;
  const parsed=validatedResearchRecord(record,new Set([1]));assert.equal(parsed.scope.cycle,'2026');assert.equal(parsed.scope.term,'fall');
  record.scope.term='spring';assert.equal(validatedResearchRecord(record,new Set([1])),null);
  record.scope.cycle=es?'Otoño':'Fall';record.scope.term=null;assert.equal(validatedResearchRecord(record,new Set([1])),null);
 });
 test(`${language}: descriptor headings do not erase a verified institution fact or admit another program`,()=>{
  const record=publicRecord('financial_aid',language);record.scope.cycle='2026-27';record.scope.population='New full-time California-resident undergraduate students';
  record.facts=[publicFact({key:'tuition_fees',label:'Annual full-time California-resident undergraduate tuition and fees',kind:'amount',amount:1000,bound:'exact',currency:'USD',unit:'per academic year',date:null,time:null,timeZone:null})];record.expectedFacts=['tuition_fees'];
  const finding=recordFixture(language,'financial_aid','Eastview College full-time California-resident undergraduate tuition and fees',record).result.voiceBrief.findings[0];
  const task=createResearchTask({institution:'Eastview College',question:'2026-27 California-resident undergraduate tuition and fees',language});
  assert.equal(researchFindingMatchesTaskEntity(task,'Eastview College',finding),true);
  assert.equal(auditResearchTask(task,{voiceBrief:{findings:[finding]}}).complete,true);
  assert.equal(researchFindingMatchesTaskEntity(task,'Pine Valley College',finding),false);
  assert.equal(researchFindingMatchesTaskEntity(task,'Eastview College',{...finding,subject:'Eastview College Medical School'}),false);
  record.scope.program='Nursing';assert.equal(researchFindingMatchesTaskEntity(task,'Eastview College',{...finding,evidence:record}),false);
 });
 test(`${language}: cited partial dates remain useful without becoming verified for a requested year`,()=>{
  const record=publicRecord('admissions',language);record.scope.cycle=null;
  record.facts=[publicFact({kind:'text',status:'partial',date:null,time:null,timeZone:null,value:es?'5 de enero, año sin confirmar.':'January 5, year unconfirmed.',qualification:'Requested cycle is unverified.'})];record.complete=false;
  const result=recordFixture(language,'admissions','Eastview College',record).result;
  const audit=auditResearchTask(createResearchTask({question:'Fall 2027 application deadline',institution:'Eastview College',language}),result);
  assert.equal(audit.status,'partial');assert.equal(audit.complete,false);assert.equal(audit.verifiedCount,0);
 });
 test(`${language}: parent/adult procedures are recognized without turning cost questions into procedures`,()=>{
  assert.ok(requestedResearchFacts(es?'¿Cómo acepta un padre la invitación de FAFSA?':'How does a parent accept a FAFSA invitation?').some(x=>x.key==='steps'));
  assert.ok(requestedResearchFacts(es?'¿Cómo se inscribe un adulto en ESL?':'How does an adult enroll in ESL?').some(x=>x.key==='steps'));
  assert.ok(!requestedResearchFacts('How much does it cost to apply?').some(x=>x.key==='steps'));
 });
 test(`${language}: waiver instructions do not select an already-known fee amount as the answer`,()=>{
  const q=es?'¿Qué opciones de exención del costo de solicitud ofrece Eastview College?':'What application fee waiver options does Eastview College offer?';
  const keys=requestedResearchFacts(q,language).map(f=>f.key);
  assert.ok(keys.includes('fee_waiver'));assert.ok(!keys.includes('application_fee'));
  assert.ok(requestedResearchFacts(es?'¿Cuál es el monto del costo de solicitud y qué exenciones hay?':'What is the application fee amount and what fee waivers are offered?',language).some(f=>f.key==='application_fee'));
 });
 test(`${language}: bilingual program names resolve narrowly without changing credit status or another degree`,()=>{
  const q=es?'Clases de inglés como segundo idioma sin créditos':'Noncredit English as a Second Language classes';
  assert.equal(researchProgramScopeMatches(q,{topic:'enrollment',scope:{program:'ESL sin crédito (ESLNC)'}}),true);
  assert.equal(researchProgramScopeMatches(q,{topic:'enrollment',scope:{program:'Credit ESL'}}),false);
  assert.equal(researchProgramScopeMatches(q,{topic:'enrollment',scope:{program:'ESL Nursing Certificate'}}),false);
  assert.equal(researchProgramScopeMatches(es?'¿Qué es una Beca Pell?':'What is a Pell Grant?',{topic:'financial_aid',scope:{program:'Federal Pell Grant'}}),true);
 });
 test(`${language}: an empty structured result still creates one bounded missing-fact recovery plan`,()=>{
  const input={institution:'Eastview College',question:es?'Fecha límite y costo de solicitud':'Application deadline and application fee'},task=createResearchTask(input);
  const result={sources:[{url:'https://eastview.edu/overview'}],voiceBrief:{status:'unverified',findings:[],answer:'Unverified.',qualification:'Not established.'},researchDiagnostics:{attempts:[{actions:[{type:'open_page',status:'completed',url:'https://eastview.edu/overview'}],consultedSources:['https://eastview.edu/overview','https://eastview.edu/first-year/fees']} ]}};
  const plan=researchRecoveryPlan(result,{...input,researchTask:task});assert.equal(plan.reason,'requested_facts_missing');
  assert.deepEqual(new Set(plan.gaps.flatMap(g=>g.requiredFacts)),new Set(['deadline','application_fee']));
  const request=recoveryResearchRequest({model:'gpt-6-luna',input:'{}',instructions:''},result,plan),recovery=JSON.parse(request.input).recovery;
  assert.deepEqual(recovery.previouslyOpenedSources,['https://eastview.edu/overview']);assert.ok(recovery.unopenedSourceLeads.includes('https://eastview.edu/first-year/fees'));assert.equal(request.max_tool_calls,2);
 });
 test(`${language}: the supplemental ledger preserves primary facts, suppresses duplicates and quarantines conflicts`,()=>{
  const store=createSupplementStore(),source=recordFixture(language,'scholarships');store.put('primary',source.result);
  assert.equal(store.evaluate(source.result,{language}).reason,'already_known');
  const conflict=structuredClone(source.result);conflict.voiceBrief.findings[0].evidence.facts[0].amount=9999;
  const judged=store.evaluate(conflict,{language});assert.equal(judged.accepted,false);assert.equal(judged.conflicts,1);
  const extra=recordFixture(language,'student_support');const accepted=store.evaluate(extra.result,{language});assert.equal(accepted.accepted,true);
  assert.equal(store.records()[0].voiceBrief.findings[0].evidence.facts[0].amount,2500);
  store.invalidate();assert.equal(store.records().length,0);
 });
 test(`${language}: dynamic Decisions catalog and fresh pending-work check prevent duplicate execution`,async()=>{
  const catalog=[{id:'support_task',description:'An explicitly requested support contact.'}];
  const response={answers:[{type:'choice',name:'research_task',choice:'support_task',confidence:.8,probabilities:[{value:'none',probability:.05},{value:'support_task',probability:.95}]},{type:'predicate',name:'task_supported',probability:.95}]};
  assert.equal(decisionAssessment(response,undefined,catalog).selected,'support_task');
  let resolve,known=false,calls=0;
  const scout=createScout({mode:'decisions',catalog,isKnown:()=>known,client:{evaluate:()=>new Promise(r=>resolve=r)},research:()=>calls++,accept:()=>true});
  const running=scout.observe({language,turns:[{role:'user',text:'I need a support contact.'}]});known=true;resolve({response});
  assert.equal((await running).reason,'none_or_duplicate');assert.equal(calls,0);scout.close();
 });
 test(`${language}: known tasks and clearly different campuses are removed without authorizing the remaining task`,()=>{
  const catalog=[{id:'a',institution:'Eastview College'},{id:'b',institution:'Pine Valley College'},{id:'general',institution:''}];
  assert.deepEqual(scopedScoutCatalog({turns:[{text:'Eastview College'}],knownTaskIds:['a']},catalog).map(c=>c.id),['general']);
  assert.equal(scopedScoutCatalog({turns:[{text:es?'Esa universidad':'That college'}]},catalog).length,3,'an unresolved reference does not invent an institution');
  assert.equal(scopedScoutCatalog({turns:[{text:'Stanford'}]},[{id:'s',institution:'Stanford University'},{id:'d',institution:'UC Davis'}]).length,1);
 });
 test(`${language}: specific-need predicates reject ties and malformed evidence without treating probability as factual proof`,()=>{
  const catalog=[{id:'a'},{id:'b'}],response=(a,b)=>({answers:[{name:'need_a',type:'predicate',probability:a},{name:'need_b',type:'predicate',probability:b}]});
  assert.equal(supplementalPredicateAssessment(response(.95,.1),catalog).selected,'a');
  assert.equal(supplementalPredicateAssessment(response(.95,.9),catalog).reason,'ambiguous_needs');
  assert.equal(supplementalPredicateAssessment(response(.7,.1),catalog).selected,'none');
  assert.equal(supplementalPredicateAssessment(response(NaN,.1),catalog).reason,'invalid_predicates');
  assert.equal(supplementalPredicateAssessment({answers:[{name:'need_a',type:'predicate',probability:1},{name:'need_a',type:'predicate',probability:1}]},catalog).reason,'invalid_predicates');
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {costCampusName} from './campus.mjs';
import {costHousingScenario} from '../../server/voice-housing-scope.mjs';
import {createLocalCostLookup} from './local-provider.mjs';
import {localClient} from './postgres.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {researchRecoveryPlan} from '../../server/research-recovery.mjs';

for(const [name,expected]of [['University of California, Berkeley','UC Berkeley'],['Universidad de California en Berkeley','UC Berkeley'],['University of California at Davis','UC Davis'],['Universidad de California, Merced','UC Merced'],['UCB','UC Berkeley'],['UC Los Angeles','UCLA'],['UC',''],['Berkeley College','']])test(`exact campus identity: ${name}`,()=>assert.equal(costCampusName(name),expected||null));
for(const phrase of ['off campus in a rental','rent an apartment off campus','fuera del campus en un alquiler','en un apartamento de alquiler fuera del campus'])test(`explicit rental scenario: ${phrase}`,()=>assert.equal(costHousingScenario(phrase),'renting'));
for(const phrase of ['off campus, arrangement unspecified','fuera del campus, sin especificar','not in a rental off campus','off campus with relatives','he will not rent an apartment off campus','no va a alquilar un apartamento fuera del campus'])test(`do not invent a rental plan: ${phrase}`,()=>assert.notEqual(costHousingScenario(phrase),'renting'));

test('saved-call wording and its Spanish equivalent use PostgreSQL without a provider request or recovery',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit local database test required');return;}
 const archived=(await readFile(new URL('./.local/call-0cea-research.jsonl',import.meta.url),'utf8')).replace(/^\uFEFF/u,'').trim().split(/\r?\n/u).map(JSON.parse)[1];
 const c=await localClient();try{
  const lookup=createLocalCostLookup({query:c.query.bind(c)});
  for(const language of ['en','es'])await t.test(language,async()=>{
   const input=language==='en'?archived.request:{...archived.request,language:'es',institution:'Universidad de California, Berkeley',question:'Busca el costo de asistencia de pregrado publicado para un estudiante de transferencia residente de California que vivirá fuera del campus en un alquiler. Separa matrícula y cuotas obligatorias de otros gastos. Usa el año académico publicado más reciente como referencia e indica su año.'};
   let claimed=false;const writes=[],events=[];
   const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'local-match-test',input}]};}writes.push({sql,args});return {rows:[{status:'running'}]};}};
   const started=performance.now();
   await processResearchJob(db,{}, {lookupCatalog:lookup,log:event=>events.push(event),request:()=>assert.fail('matching a saved benchmark must not call Responses or search')});
   const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];
   assert.ok(result);assert.equal(result.catalogLocalTesting,true);assert.equal(result.voiceBrief.findings[0].budget.total,49692);
   assert.ok(result.voiceBrief.findings[0].budget.components.some(c=>c.key==='transportation'&&c.amount===1238));
   assert.match(result.voiceBrief.findings[0].qualification,language==='es'?/cohorte personal sin confirmar/:/personal cohort unconfirmed/);
   assert.equal(result.researchDiagnostics.attempts.length,0);
   assert.ok(events.some(e=>e.researchStage==='catalog_checked'&&e.outcome==='completed'));
   console.log(JSON.stringify({language,workerAndDatabaseMs:Math.round(performance.now()-started),providerRequests:0,recoveryRequests:0}));
  });
  await t.test('the saved web result does not repeat a supported benchmark fee lookup',()=>{
   assert.equal(researchRecoveryPlan(archived.result,archived.request),null);
   const result=structuredClone(archived.result),fee=result.voiceBrief.findings.find(f=>f.aspect==='tuition_fees');
   fee.evidence.facts[0].amount+=100;
   assert.ok(researchRecoveryPlan(result,archived.request),'a conflicting amount still needs recovery');
   assert.ok(researchRecoveryPlan(archived.result,{...archived.request,question:'Verify the actual transfer cohort tuition and full cost of attendance renting off campus.'}),'without permission to use a benchmark retain the missing-applicability check');
  });
 }finally{await c.end();}
});

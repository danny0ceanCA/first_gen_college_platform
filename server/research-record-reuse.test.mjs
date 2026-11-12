import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchReuse,cachedResearchForCoverage,reuseResearchRequest} from './research-reuse.mjs';
import {publicRecord,publicFact,recordFixture,recordTestNow as now} from './research-record.fixtures.mjs';

function saved(language='en',record=publicRecord('admissions',language),institution='Eastview College'){
 const {result}=recordFixture(language,record.topic,institution,record);
 return {status:'completed',finished_at:result.checkedAt,input:{mode:'admissions',institution,question:'Published application deadline'},result};
}
function request(language,question,institution='Eastview College'){
 return {mode:'admissions',language,question,institution};
}

for(const language of ['en','es']){
 test(`${language}: a missing comparison entity does not discard a verified deadline`,()=>{
  const question=language==='es'?'Compara la fecha límite de solicitud de Eastview College y Pine Valley College.':'Please compare Eastview College and Pine Valley College application deadlines.';
  const row=saved(language),plan=selectResearchReuse(request(language,question,'Eastview College; Pine Valley College'),[row],{now});
  assert.deepEqual(plan.lookupInstitutions,['Pine Valley College']);
  assert.equal(plan.reusedEvidence.length,1);
  assert.equal(plan.reusedEvidence[0].institution,'Eastview College');
  assert.equal(plan.reusedEvidence[0].coverage,'verified');
  assert.equal(plan.reusedEvidence[0].findings[0].evidence.facts[0].date,'2027-01-15');
  assert.equal(plan.reusedEvidence[0].findings[0].evidence.facts[0].timeZone,'America/Los_Angeles');
  assert.equal(plan.reusedEvidence[0].sources[0].checkedAt,row.result.sources[0].checkedAt);
  assert.deepEqual(plan.missingResearchFacts.map(f=>[f.entity,f.key]),[['Pine Valley College','deadline']]);
  assert.equal(cachedResearchForCoverage(plan),null);
 });
 test(`${language}: harmless request paraphrases reuse the same fact with its caveat`,()=>{
  const question=language==='es'?'Por favor, dime cuándo cierra la solicitud de Eastview College.':'Could you remind me when the application closes at Eastview College?';
  const row=saved(language),input=request(language,question),plan=selectResearchReuse(input,[row],{now});
  assert.deepEqual(plan.lookupInstitutions,[]);
  const cached=cachedResearchForCoverage(plan,input);
  assert.ok(cached);
  assert.equal(cached.voiceBrief.findings[0].evidence.facts[0].qualification,row.result.voiceBrief.findings[0].evidence.facts[0].qualification);
  assert.equal(cached.sources[0].checkedAt,row.result.sources[0].checkedAt);
 });
 test(`${language}: a deadline does not silently cover a newly requested application fee`,()=>{
  const question=language==='es'?'¿Cuál es la fecha límite y el costo de solicitud de Eastview College?':'What are the deadline and application fee at Eastview College?';
  const plan=selectResearchReuse(request(language,question),[saved(language)],{now});
  assert.equal(plan.reusedEvidence.length,1);
  assert.equal(plan.reusedEvidence[0].coverage,'reference');
  assert.deepEqual(plan.lookupInstitutions,['Eastview College']);
  assert.deepEqual(plan.missingResearchFacts.map(f=>f.key),['application_fee']);
  assert.equal(plan.reusedEvidence[0].findings[0].evidence.facts[0].date,'2027-01-15');
  assert.equal(cachedResearchForCoverage(plan),null);
  const body=reuseResearchRequest({input:'{}',instructions:''},plan),payload=JSON.parse(body.input);
  assert.deepEqual(payload.missingResearchFacts.map(f=>f.key),['application_fee']);
  assert.deepEqual(payload.researchTask.requirements.map(f=>f.key),['deadline','application_fee']);
 });
 test(`${language}: cached coverage is checked again against the latest question`,()=>{
  const base=request(language,language==='es'?'¿Cuál es la fecha límite de Eastview College?':'What is the deadline at Eastview College?');
  const plan=selectResearchReuse(base,[saved(language)],{now});
  assert.ok(cachedResearchForCoverage(plan));
  const changed=request(language,language==='es'?'Fecha límite y costo de solicitud':'Deadline and application fee');
  assert.equal(cachedResearchForCoverage(plan,changed),null);
  assert.equal(cachedResearchForCoverage(plan,{...base,forceRefresh:true}),null);
 });
 test(`${language}: both covered entities return without a new lookup`,()=>{
  const question=language==='es'?'Compara los plazos de Eastview College y Pine Valley College.':'Compare the deadlines at Eastview College and Pine Valley College.';
  const input=request(language,question,'Eastview College; Pine Valley College');
  const plan=selectResearchReuse(input,[saved(language),saved(language,publicRecord('admissions',language),'Pine Valley College')],{now});
  assert.deepEqual(plan.lookupInstitutions,[]);
  const cached=cachedResearchForCoverage(plan,input);assert.ok(cached);
  assert.deepEqual(cached.voiceBrief.findings.map(f=>f.subject),['Eastview College','Pine Valley College']);
  assert.equal(cached.sources.length,2);
  assert.equal(cached.voiceBrief.findings[1].evidence.facts[0].sourceCitation,'[2]');
 });
 test(`${language}: verified facts survive a partially unavailable record without inventing coverage`,()=>{
  const record=publicRecord('admissions',language);
  record.facts.push(publicFact({key:'application_fee',label:language==='es'?'Costo de solicitud':'Application fee',kind:'amount',status:'unverified',date:null,time:null,timeZone:null,sourceCitation:'',qualification:''}));
  record.expectedFacts.push('application_fee');record.complete=false;
  const question=language==='es'?'Fecha límite y costo de solicitud de Eastview College':'Deadline and application fee at Eastview College';
  const plan=selectResearchReuse(request(language,question),[saved(language,record)],{now});
  assert.equal(plan.reusedEvidence[0].findings[0].evidence.facts.length,1);
  assert.deepEqual(plan.missingResearchFacts.map(f=>f.key),['application_fee']);
  assert.equal(cachedResearchForCoverage(plan),null);
 });
}

test('paraphrase tolerance retains changed scope, qualifier, refresh and age guards',()=>{
 const row=saved();
 for(const question of ['What is the 2028 application deadline?','When does the transfer application close?','When does the engineering application close?','When does the spring application close?','When does the international application close?']){
  assert.equal(cachedResearchForCoverage(selectResearchReuse(request('en',question),[row],{now})),null,question);
 }
 const base=request('en','What is the deadline at Eastview College?');
 assert.equal(cachedResearchForCoverage(selectResearchReuse({...base,forceRefresh:true},[row],{now})),null);
 assert.equal(cachedResearchForCoverage(selectResearchReuse(base,[row],{now:now+301000})),null);
 const stale=structuredClone(row);stale.result.sources[0].checkedAt=new Date(now-301000).toISOString();
 assert.equal(cachedResearchForCoverage(selectResearchReuse(base,[stale],{now})),null);
 const plan=selectResearchReuse(base,[row],{now});
 for(const question of ['What is the 2028 application deadline?','When does the transfer application close?','What is the international application deadline?','What is the nursing program deadline?','What is the online application deadline?','What is the housing application deadline?']){
  assert.equal(cachedResearchForCoverage(plan,{...base,question}),null,question);
 }
});
test('an ambiguous deadline and an unrelated amount cannot be selected by their type alone',()=>{
 const record=publicRecord();record.facts[0].key='regular_deadline';record.facts[0].label='Regular deadline';
 record.facts.push({...record.facts[0],key:'priority_deadline',label:'Priority deadline',date:'2026-12-15'});record.expectedFacts=record.facts.map(f=>f.key);
 assert.equal(cachedResearchForCoverage(selectResearchReuse(request('en','When is it due?'),[saved('en',record)],{now})),null);
 const award=publicRecord('scholarships');
 assert.equal(cachedResearchForCoverage(selectResearchReuse(request('en','What is the application fee at Eastview College?'),[saved('en',award)],{now})),null);
});
test('an incomplete sequence retains its known step without claiming to be a complete procedure',()=>{
 const record=publicRecord('process');record.complete=false;
 record.facts[1]={...record.facts[1],status:'unverified',value:null,sourceCitation:''};
 const plan=selectResearchReuse(request('en','What are the steps at Eastview College?'),[saved('en',record)],{now});
 assert.equal(plan.reusedEvidence.length,1);
 assert.equal(plan.reusedEvidence[0].findings[0].evidence.facts.length,1);
 assert.equal(plan.reusedEvidence[0].coverage,'reference');
 assert.deepEqual(plan.missingResearchFacts.map(f=>f.key),['steps']);
 assert.equal(cachedResearchForCoverage(plan),null);
});
test('official government evidence follows the shared policy while unsafe and stale sources stay excluded',()=>{
 const row=saved(),input=request('en','What is the deadline at Eastview College?');
 row.result.sources[0].url='https://csac.ca.gov/published-deadline';
 assert.ok(cachedResearchForCoverage(selectResearchReuse(input,[row],{now})));
 for(const url of ['https://csac.ca.gov.example.com/policy','https://secret@csac.ca.gov/policy','https://csac.ca.gov:8080/policy','http://csac.ca.gov/policy']){
  const changed=structuredClone(row);changed.result.sources[0].url=url;
  assert.equal(cachedResearchForCoverage(selectResearchReuse(input,[changed],{now})),null,url);
 }
});
for(const language of ['en','es'])test(`${language}: equivalent long academic-year wording reuses without erasing a distinct requested year`,()=>{
 const record=publicRecord('admissions',language);record.scope.cycle='2026-27';record.scope.term=null;
 const row=saved(language,record),question=language==='es'?'Fecha límite de solicitud de Eastview College para 2026-2027':'Application deadline at Eastview College for 2026-2027';
 const input=request(language,question),plan=selectResearchReuse(input,[row],{now});
 assert.deepEqual(plan.lookupInstitutions,[]);assert.ok(cachedResearchForCoverage(plan,input));
 assert.equal(cachedResearchForCoverage(selectResearchReuse({...input,question:question.replace('2026-2027','2027-2028')},[row],{now})),null);
});
for(const language of ['en','es'])test(`${language}: an explicitly named campus office is reusable without broad campus aliases`,()=>{
 const record=publicRecord('student_support',language);record.scope.program='First-Generation Initiative';
 const subject='Eastview College First-Generation Initiative';
 const {result}=recordFixture(language,'student_support',subject,record);
 const row={status:'completed',finished_at:result.checkedAt,input:{mode:'planning',institution:'Eastview College',question:'First-Generation Initiative contact'},result};
 const question=language==='es'?'Contacto de First-Generation Initiative en Eastview College':'Contact for First-Generation Initiative at Eastview College';
 const input={mode:'planning',language,institution:'Eastview College',question};
 const plan=selectResearchReuse(input,[row],{now});
 assert.deepEqual(plan.lookupInstitutions,[]);
 assert.equal(plan.reusedEvidence[0].institution,'Eastview College');
 assert.equal(cachedResearchForCoverage(plan,input).voiceBrief.findings[0].subject,subject);
 const generic={...input,question:language==='es'?'Contacto de Eastview College':'Contact for Eastview College'};
 assert.equal(cachedResearchForCoverage(selectResearchReuse(generic,[row],{now})),null);
 for(const wrong of ['Pine Valley College First-Generation Initiative','Eastview Collegeland First-Generation Initiative','Eastview College North Campus First-Generation Initiative']){
  const changed=structuredClone(row);changed.result.voiceBrief.findings[0].subject=wrong;
  assert.equal(cachedResearchForCoverage(selectResearchReuse(input,[changed],{now})),null,wrong);
 }
});

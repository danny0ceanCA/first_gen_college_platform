import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchTask,auditResearchTask,researchTaskRelationship,requestedResearchFacts} from './researchTask.mjs';
import {recordFixture,publicRecord,publicFact} from '../server/research-record.fixtures.mjs';

for(const language of ['en','es']){
 test(`${language}: task keeps a requested fee missing even when extraction calls its deadline complete`,()=>{
  const task=createResearchTask({language,institution:'Eastview College',question:language==='es'?'¿Cuál es la fecha límite y el costo de solicitud?':'What is the application deadline and application fee?'});
  const result=recordFixture(language).result,coverage=auditResearchTask(task,result);
  assert.equal(coverage.status,'partial');assert.equal(coverage.complete,false);assert.equal(coverage.verifiedCount,1);
  assert.deepEqual(coverage.missing.map(f=>f.key),['application_fee']);
  const evidence=publicRecord('admissions',language);evidence.facts.push(publicFact({key:'application_fee',label:'Application fee',kind:'amount',amount:40,bound:'exact',currency:'USD',unit:'per application',date:null,time:null,timeZone:null}));
  evidence.expectedFacts.push('application_fee');
  assert.equal(auditResearchTask(task,recordFixture(language,'admissions','Eastview College',evidence).result).complete,true);
 });
 test(`${language}: missing college remains requested independently of successful findings`,()=>{
  const task=createResearchTask({language,institution:'Eastview College; Pine Valley College',question:language==='es'?'Compara las fechas límite.':'Compare application deadlines.'});
  const coverage=auditResearchTask(task,recordFixture(language).result);
  assert.deepEqual(task.entities,['Eastview College','Pine Valley College']);assert.equal(coverage.missing[0].entity,'Pine Valley College');
 });
 test(`${language}: explicitly named campus program matches only that same campus and program`,()=>{
  const question=language==='es'?'Contacto de First-Generation Initiative en UC Davis':'Contact for First-Generation Initiative at UC Davis';
  const task=createResearchTask({question,institution:'UC Davis',language});
  const record=publicRecord('student_support',language);record.scope.program='First-Generation Initiative';
  assert.equal(auditResearchTask(task,recordFixture(language,'student_support','UC Davis First-Generation Initiative',record).result).complete,true);
  for(const subject of ['UC Berkeley First-Generation Initiative','UC Daviswood First-Generation Initiative','UC Davis Sacramento Campus First-Generation Initiative'])assert.equal(auditResearchTask(task,recordFixture(language,'student_support',subject,record).result).complete,false,subject);
  const broad=createResearchTask({question:language==='es'?'Contacto de UC Davis':'Contact for UC Davis',institution:'UC Davis',language});
  assert.equal(auditResearchTask(broad,recordFixture(language,'student_support','UC Davis',record).result).complete,false);
 });
 test(`${language}: a different year, term, population or application type is useful but not complete`,()=>{
  const questions=language==='es'?['Fecha límite de solicitud de 2028','Fecha límite de solicitud para primavera de 2027','Fecha límite de solicitud de posgrado','Fecha límite de solicitud de vivienda']:['2028 application deadline','Spring 2027 application deadline','Graduate application deadline','Housing application deadline'];
  for(const question of questions){
   const task=createResearchTask({language,institution:'Eastview College',question});
   const audit=auditResearchTask(task,recordFixture(language).result);
   assert.equal(audit.status,'partial',question);assert.equal(audit.complete,false,question);
  }
  assert.equal(auditResearchTask(createResearchTask({language,institution:'Eastview College',question:language==='es'?'Fecha límite de solicitud':'Application deadline'}),recordFixture(language).result).complete,true);
  for(const question of ['International application deadline','Nursing program application deadline','Online application deadline'])assert.equal(auditResearchTask(createResearchTask({question,institution:'Eastview College'}),recordFixture(language).result).complete,false,question);
 });
 test(`${language}: conjunctive documents and fee requests cannot be satisfied by just a deadline`,()=>{
  const questions=language==='es'?['Fecha límite y documentos que necesito para la solicitud','Fecha límite de solicitud y cuota']:['What documents do I need and what is the application deadline?','What are the application deadline and required documents?','What are the admissions deadline and prerequisites?','What are the application deadline and fee?'];
  for(const question of questions)assert.equal(auditResearchTask(createResearchTask({language,institution:'Eastview College',question}),recordFixture(language).result).complete,false,question);
  assert.equal(createResearchTask({question:'2026–2027 application deadline'}).scope.cycle,'2026-27');
  assert.equal(createResearchTask({question:'Compare 2026 and 2027 deadlines'}).scope.cycle,'2026,2027');
 });
 test(`${language}: additions preserve old entities and objectives but explicit scope correction wins`,()=>{
  const old=createResearchTask({language,institution:'Eastview College',question:'Fall 2027 application deadline'});
  const next=createResearchTask({language,institution:'Pine Valley College',retainedEntities:old.entities,question:language==='es'?'¿Y Pine Valley College para primavera 2028?':'And Pine Valley College for spring 2028?'},old);
  assert.equal(next.revision,2);assert.deepEqual(next.entities,['Eastview College','Pine Valley College']);assert.equal(next.requirements[0].key,'deadline');assert.equal(next.scope.term,'spring');assert.equal(next.scope.cycle,'2028');
 });
 test(`${language}: process and support requests use generic facts rather than budget requirements`,()=>{
  const questions=language==='es'?['Pasos para solicitar','Contacto y horario de la oficina','Ubicación de tutoría']:['Steps to apply','Office contact and hours','Tutoring center location'];
  assert.deepEqual(questions.map(q=>requestedResearchFacts(q).map(f=>f.key)),[['steps'],['contact','hours'],['location']]);
 });
 test(`${language}: tuition contrast does not request a total and instead can correct the same topic`,()=>{
  assert.deepEqual(requestedResearchFacts(language==='es'?'Separa la matrícula del costo total de asistencia.':'Separate tuition from total cost of attendance.').map(f=>f.key),['tuition_fees']);
  const cost=createResearchTask({question:language==='es'?'Costo total de UC Irvine':'Total cost at UC Irvine'});
  assert.equal(researchTaskRelationship(language==='es'?'Mejor dime el costo total de UCLA.':'Tell me the UCLA total instead.',cost),'related');
 });
 test(`${language}: ordinary scope clarification stays related while tutoring after costs is a new request`,()=>{
  const cost=createResearchTask({question:language==='es'?'Costo total de Eastview':'Total cost at Eastview'});
  const admission=createResearchTask({question:language==='es'?'Fecha límite de admisión':'Admissions deadline'});
  assert.equal(researchTaskRelationship(language==='es'?'¿Dónde está el centro de tutoría?':'Where is the tutoring center?',cost),'changed');
  assert.equal(researchTaskRelationship(language==='es'?'¿Eso incluye estudiantes de transferencia?':'Does that include transfer applicants?',admission),'related');
  assert.equal(researchTaskRelationship(language==='es'?'¿Dónde está la biblioteca?':'Where is the library?',cost),'changed');
 });
 test(`${language}: unverified and incomplete steps cannot satisfy a request`,()=>{
  const record=publicRecord('process',language);record.facts[0].status='unverified';record.facts[0].value=null;record.facts[0].sourceCitation='';
  const task=createResearchTask({language,institution:'Eastview College',question:language==='es'?'Pasos para solicitar':'Steps to apply'});
  assert.equal(auditResearchTask(task,recordFixture(language,'process','Eastview College',record).result).complete,false);
 });
}

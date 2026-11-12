import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifiedFindingCoverage,qualificationsObserved} from './qualified-observation.mjs';
import {typedPortionObserved} from './pause-delivery.mjs';
import {publicRecord,recordFixture} from '../../server/research-record.fixtures.mjs';

for(const language of ['en','es']){
 const es=language==='es';
 const cases=[
  {id:'transit',value:es?'Estudiantes de Eastview College pueden viajar gratis en el autobús local.':'Eastview College students can ride the local bus service without a fare.',condition:es?'Se requiere identificación estudiantil vigente.':'A current student identification card is required.'},
  {id:'grants',value:es?'Estudiantes de Eastview College generalmente no devuelven la beca.':'Eastview College students generally do not repay the grant.',condition:es?'Se puede requerir devolución por retiro o pago excesivo.':'Repayment may be required after withdrawal or an overpayment.'},
  {id:'esl',value:es?'Eastview College ofrece cursos de inglés sin créditos gratuitos.':'Eastview College offers free noncredit English language courses.',condition:es?'Esto no establece disponibilidad de ayuda en español.':'This does not establish availability of Spanish language assistance.'},
 ];
 for(const c of cases)test(`${language}: ${c.id} benefit alone cannot suppress its exception or condition`,()=>{
  const record=publicRecord('student_support',language);record.facts[0].value=c.value;record.facts[0].qualification=c.condition;
  const row=recordFixture(language,'student_support','Eastview College',record);
  const finding=row.result.voiceBrief.findings[0],text=c.value+' '+c.condition+' '+finding.qualification;
  assert.equal(typedPortionObserved(row.result,c.value),false);
  assert.equal(typedPortionObserved(row.result,text),true);
  const missing=qualifiedFindingCoverage(finding,c.value);
  assert.equal(missing.qualificationObserved,false);assert.equal(missing.confirmed,false);
  assert.equal(qualificationsObserved(finding,text),true);
  assert.equal(qualificationsObserved(finding,c.value+' '+(es?'¿'+c.condition.replace('.','?'):c.condition.replace('.','?'))+' '+finding.qualification),false,'a question is not delivery');
 });
 test(`${language}: all verified facts and finding-wide conditions remain obligations across separate sentences`,()=>{
  const record=publicRecord('student_support',language),first=cases[0];
  record.facts[0].value=first.value;record.facts[0].qualification=first.condition;
  const second=es?'Eastview College ofrece el servicio solo durante el semestre académico.':'Eastview College offers this service only during the academic semester.';
  record.facts.push({...record.facts[0],key:'availability',value:second,qualification:es?'Confirma las fechas publicadas.':'Check the published dates.'});record.expectedFacts.push('availability');
  const row=recordFixture(language,'student_support','Eastview College',record),wide=row.result.voiceBrief.findings[0].qualification;
  const partial=first.value+' '+first.condition+' '+wide;
  assert.equal(typedPortionObserved(row.result,partial),false,'one matching clause cannot retire a different undelivered fact');
  assert.equal(typedPortionObserved(row.result,partial+' '+second+' '+record.facts[1].qualification),true);
 });
}

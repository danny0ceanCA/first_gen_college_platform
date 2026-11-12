import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrimaryDeliveryGate} from './primary-delivery-gate.mjs';
import {publicRecord,publicFact,recordFixture} from '../../server/research-record.fixtures.mjs';

for(const language of ['en','es']){
 const es=language==='es';
 function fixture(){
  const record=publicRecord('admissions',language),row=recordFixture(language,'admissions','Eastview College',record);
  const question=es?'¿Cuál es la fecha límite de solicitud de Eastview College?':'What is the application deadline at Eastview College?';
  const text=es?'Para solicitantes de primer año de otoño 2027 en Eastview College, la fecha límite de solicitud es 15 ene 2027 a las 23:59 hora del Pacífico. Solo envío en línea. Consulta las condiciones de la fuente.':
   'For fall 2027 first-year applicants at Eastview College, the application deadline is Jan 15, 2027 at 23:59 Pacific Time. Online submission only. The source conditions apply.';
  const logs=[],gate=createPrimaryDeliveryGate({log:e=>logs.push(e)});
  gate.start('primary',{question,language});
  const speech=(overrides={},spoken=text)=>gate.speech({jobId:'primary',revision:1,evidenceVersion:1,playbackObserved:true,completedPortions:3,speechOutcome:'complete',...overrides},spoken);
  return {gate,row,record,text,logs,speech};
 }
 test(`${language}: only the matching primary job's qualified observed speech opens the gate`,()=>{
  const f=fixture();assert.equal(f.gate.canDeliver(),false);f.gate.ready('primary',{result:f.row.result});assert.equal(f.gate.canDeliver(),false);
  f.speech({jobId:'unrelated'});f.speech({revision:9});f.speech({evidenceVersion:2});f.speech({playbackObserved:false});f.speech({completedPortions:0});f.speech({speechOutcome:'forced_flush'});
  assert.equal(f.gate.canDeliver(),false);f.speech({},es?'Eastview College tiene una fecha publicada.':'Eastview College has a published deadline.');assert.equal(f.gate.canDeliver(),false);
  f.speech();assert.equal(f.gate.canDeliver(),true);
 });
 test(`${language}: a completed qualified portion after mm-hmm is eligible without treating an interruption as completion`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});f.speech({speechOutcome:'substantive_interruption'});assert.equal(f.gate.canDeliver(),false);
  f.speech({speechOutcome:'acknowledgment_overlap'});assert.equal(f.gate.canDeliver(),true);
 });
 test(`${language}: unchanged recovery and an unrequested fee cannot reset the answered deadline`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});f.speech();assert.equal(f.gate.canDeliver(),true);
  f.record.expectedFacts.push('application_fee');
  f.record.facts.push(publicFact({key:'application_fee',label:'Application fee',kind:'amount',amount:100,bound:'exact',currency:'USD',unit:'per application',date:null,time:null,timeZone:null,qualification:'Nonrefundable.'}));
  const updated=recordFixture(language,'admissions','Eastview College',f.record);
  f.gate.ready('primary',{version:2,result:updated.result});assert.equal(f.gate.canDeliver(),true);
  f.gate.ready('unrelated',{result:updated.result});assert.equal(f.gate.canDeliver(),true);
 });
 test(`${language}: changed requested facts and revisions require new evidence rather than a stale completed event`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});f.speech();
  f.record.facts[0].date='2027-02-01';const next=recordFixture(language,'admissions','Eastview College',f.record);
  f.gate.ready('primary',{version:2,result:next.result});assert.equal(f.gate.canDeliver(),false);
  f.speech();assert.equal(f.gate.canDeliver(),false);
  f.speech({evidenceVersion:2},f.text.replace(es?'15 ene 2027':'Jan 15, 2027',es?'1 feb 2027':'Feb 1, 2027'));assert.equal(f.gate.canDeliver(),true);
  f.gate.start('primary',{revision:2,question:'Deadline',language});f.gate.ready('primary',{revision:1,result:next.result});assert.equal(f.gate.canDeliver(),false);
  f.gate.end('primary','cancelled');assert.equal(f.gate.canDeliver(),true);
 });
 test(`${language}: a condition delivered in a subsequent completed thought remains linked to the same task`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});
  const split=f.text.indexOf('. ');f.speech({},f.text.slice(0,split+1));assert.equal(f.gate.canDeliver(),false);
  f.speech({},f.text.slice(split+2));assert.equal(f.gate.canDeliver(),true);
  assert.equal(f.logs.at(-1).missingFacts,0);assert.equal(f.logs.at(-1).missingConditions,0);
 });
 test(`${language}: a corrected cycle cannot be contaminated by the old cycle's completed transcript`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});f.speech();
  f.record.scope.cycle='2028';f.record.scope.validThrough='2028-01-15';f.record.facts[0].date='2028-01-15';
  f.gate.ready('primary',{version:2,result:recordFixture(language,'admissions','Eastview College',f.record).result});assert.equal(f.gate.canDeliver(),false);
  f.speech({evidenceVersion:2},f.text.replaceAll('2027','2028'));assert.equal(f.gate.canDeliver(),true);
 });
 test(`${language}: a newly established prerequisite is not discarded as an optional recovery detail`,()=>{
  const f=fixture();f.gate.ready('primary',{result:f.row.result});f.speech();
  const value=es?'Debes crear una cuenta en el portal de Eastview College antes de enviar.':'You must create an Eastview College portal account before submitting.';
  const qualification=es?'La cuenta por sí sola no envía la solicitud.':'The account alone does not submit an application.';
  f.record.facts.push(publicFact({key:'portal_requirement',label:'Portal prerequisite',kind:'requirement',value,date:null,time:null,timeZone:null,qualification}));f.record.expectedFacts.push('portal_requirement');
  f.gate.ready('primary',{version:2,result:recordFixture(language,'admissions','Eastview College',f.record).result});assert.equal(f.gate.canDeliver(),false);
  f.speech({evidenceVersion:2},f.text+' '+value+' '+qualification);assert.equal(f.gate.canDeliver(),true);
 });
}

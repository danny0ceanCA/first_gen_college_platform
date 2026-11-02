import {outcomeDefinition,validateOutcomeEventDate} from './outcomeEvidence.mjs';
const fail=()=>{throw Object.assign(Error('invalid_outcome_observation'),{status:400});};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const text=(v,max,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const day=(on,timeZone)=>validateOutcomeEventDate({on,precision:on===null?'unknown':'day',timeZone}).on;
export const observationLabels={en:{supports:'supports this claim',contradicts:'contradicts this claim',cannot_establish:'cannot establish this claim',student_account:'the student’s statement',direct_observation:'my direct observation',declared_record_review:'a record I report checking',yes:'yes',no:'no',unknown:'unknown',submission_receipt:'submission receipt',decision_notice:'decision notice',office_message:'office message',institution_record:'institution record',other_record:'other record'},es:{supports:'respalda esta afirmación',contradicts:'contradice esta afirmación',cannot_establish:'no permite establecer esta afirmación',student_account:'la declaración del estudiante',direct_observation:'mi observación directa',declared_record_review:'un registro que reporto haber revisado',yes:'sí',no:'no',unknown:'no se sabe',submission_receipt:'comprobante de entrega',decision_notice:'aviso de decisión',office_message:'mensaje de la oficina',institution_record:'registro institucional',other_record:'otro registro'}};
export function validateOutcomeObservation(v){
 exact(v,['claim','selection','position','basis','observation','observedOn','eventOn','timeZone','sourceReference','dependsOnStudentStatement']);
 exact(v.claim,['definitionId','definitionVersion','scope','claimStatus','decision']);const c=v.claim;
 if(!outcomeDefinition(c.definitionId,c.definitionVersion))fail();exact(c.scope,['institution','term','cycle']);
 const limits={institution:200,term:100,cycle:128};for(const k of Object.keys(limits))if(c.scope[k]!==null&&!text(c.scope[k],limits[k]))fail();
 if(!['occurred','not_occurred','pending','unknown','goal_changed'].includes(c.claimStatus))fail();
 if(c.definitionId==='decision_received'&&c.claimStatus==='occurred'){if(!['approved','denied','other','unknown'].includes(c.decision))fail();}else if(c.decision!==null)fail();
 exact(v.selection,['kind','entryId','quote']);if(!['question','note'].includes(v.selection.kind)||!text(v.selection.quote,1000)||v.selection.kind==='question'&&v.selection.entryId!==null||v.selection.kind==='note'&&!text(v.selection.entryId,128))fail();
 if(!['supports','contradicts','cannot_establish'].includes(v.position)||!['student_account','direct_observation','declared_record_review'].includes(v.basis)||!text(v.observation,1200)||!['yes','no','unknown'].includes(v.dependsOnStudentStatement))fail();
 if(v.basis==='student_account'&&v.dependsOnStudentStatement!=='yes'||v.position!=='cannot_establish'&&(Object.values(c.scope).some(x=>x===null)||c.claimStatus==='unknown'))fail();
 if(v.observedOn===null)fail();day(v.observedOn,v.timeZone);day(v.eventOn,v.timeZone);if(v.eventOn!==null&&v.eventOn>v.observedOn)fail();
 if(v.sourceReference!==null){exact(v.sourceReference,['kind','on']);if(!['submission_receipt','decision_notice','office_message','institution_record','other_record'].includes(v.sourceReference.kind))fail();day(v.sourceReference.on,v.timeZone);if(v.sourceReference.on!==null&&v.sourceReference.on>v.observedOn)fail();}
 if(v.basis==='declared_record_review'&&v.sourceReference===null||v.basis!=='declared_record_review'&&v.sourceReference!==null)fail();
 return {...v,observation:v.observation.trim(),claim:{...c,scope:Object.fromEntries(Object.entries(c.scope).map(([k,s])=>[k,s===null?null:s.trim()]))}};
}
export function validateOutcomeDispute(v){exact(v,['detail','visibility']);if(!text(v.detail,800)||!['private','shared'].includes(v.visibility))fail();return {detail:v.detail.trim(),visibility:v.visibility};}

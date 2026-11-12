// Fictional official-source records for deterministic bilingual tests. No
// student or real-world policy data; never used as production research.
import {parseResearchBrief} from './research-brief.mjs';
export const recordTestNow=Date.parse('2026-11-11T08:00:00Z');
export const recordCheckedAt=new Date(recordTestNow-1000).toISOString();
export function publicFact(overrides={}){return {key:'deadline',label:'Application deadline',kind:'date',status:'verified',value:null,amount:null,upperAmount:null,bound:null,currency:null,unit:null,date:'2027-01-15',time:'23:59',timeZone:'America/Los_Angeles',order:null,sourceCitation:'[1]',qualification:'Online submission only.',...overrides};}
export function publicRecord(topic='admissions',language='en'){
 const es=language==='es',scope={cycle:'2027',term:'fall',population:es?'Solicitantes de primer año':'First-year applicants',program:null,jurisdiction:null,enrollment:null,delivery:null,validThrough:'2027-01-15'};
 const deadline=publicFact({label:es?'Fecha límite de solicitud':'Application deadline',qualification:es?'Solo envío en línea.':'Online submission only.'});
 const award=publicFact({key:'award',label:es?'Beca anual':'Annual scholarship',kind:'amount',amount:2500,bound:'up_to',currency:'USD',unit:es?'por año':'per year',date:null,time:null,timeZone:null,qualification:es?'Renovación sujeta a requisitos; no es una garantía.':'Renewal requirements apply; not guaranteed.'});
 const rule=publicFact({key:'eligibility',label:es?'Requisito publicado':'Published eligibility rule',kind:'rule',value:es?'Inscripción a tiempo completo.':'Full-time enrollment.',date:null,time:null,timeZone:null,qualification:es?'Regla publicada; no determina tu elegibilidad.':'Published rule; not your eligibility determination.'});
 const steps=[1,2].map(order=>publicFact({key:'step_'+order,label:es?['Prepara la solicitud','Envía la solicitud'][order-1]:['Prepare application','Submit application'][order-1],kind:'step',order,value:es?['Revisa los requisitos.','Usa el portal oficial.'][order-1]:['Review the requirements.','Use the official portal.'][order-1],date:null,time:null,timeZone:null,qualification:es?'No se ha enviado nada.':'Nothing has been submitted.'}));
 let facts=topic==='scholarships'?[award,deadline]:topic==='financial_aid'?[rule]:topic==='housing'?[{...rule,key:'housing_requirement',label:es?'Solicitud de vivienda':'Housing application',value:es?'Se requiere una solicitud aparte.':'A separate application is required.'}]:topic==='process'?steps:topic==='programs'?[{...rule,key:'program_requirement'}]:topic==='student_support'?[publicFact({key:'contact',kind:'text',label:es?'Oficina de apoyo':'Support office',value:es?'Visita la oficina de apoyo estudiantil.':'Visit the student support office.',date:null,time:null,timeZone:null,qualification:es?'Confirma el horario publicado.':'Confirm the published office hours.'})]:[deadline];
 if(topic==='housing')scope.delivery='in_person';
 return {topic,scope,complete:true,expectedFacts:facts.map(f=>f.key),facts};
}
export function recordFixture(language='en',topic='admissions',subject='Eastview College',record=publicRecord(topic,language)){
 const qualification=language==='es'?'Consulta las condiciones de la fuente. [1]':'The source conditions apply. [1]';
 const finding={subject,aspect:topic==='admissions'?'deadline':topic==='housing'?'housing':topic==='financial_aid'?'eligibility':'other',status:'verified',answer:'Conflicting old prose 999 [1].',qualification,budget:null,evidence:record};
 const payload={brief:{status:'verified',answer:finding.answer,qualification,nextStep:'',findings:[finding]},report:'Conflicting old prose 999 [1].'};
 const source={url:'https://'+(subject.startsWith('East')?'eastview':'pinevalley')+'.edu/policy',title:'Fictional published policy',checkedAt:recordCheckedAt};
 return {finding,payload,record,source,result:parseResearchBrief({text:JSON.stringify(payload),sources:[source],checkedAt:recordCheckedAt},language)};
}

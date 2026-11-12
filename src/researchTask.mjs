import {normalizedText, researchRecordAudit} from './researchRecord.mjs';
import {researchSubjectIdentity} from './researchFindings.mjs';
import {budgetAudit} from './publishedBudget.mjs';
import {requestedResearchAspects} from './researchQuestion.mjs';

// Application-owned objectives, separate from a model's self-reported coverage.
// These are reusable fact shapes, not separate research flows per college/topic.
// Keep the original question as well: lexical recognition is deliberately not a
// claim that every possible intent can be inferred by these patterns.
const definitions = [
 ['deadline','date','Deadline','Fecha límite',/\b(?:deadlines?|due dates?|application close|applications? close|close date|fechas? limite|plazos?|vence|vencimiento|cierra|cierran)\b/u],
 ['application_fee','amount','Application fee','Costo de solicitud',/\b(?:application fees?|fee to apply|cost to apply|(?:costo|cuota|tarifa|cobro)(?: de| para)? (?:la )?(?:solicitud|solicitar))\b/u],
 ['fee_waiver','rule','Fee waiver','Exención de pago',/\b(?:fee waivers?|waiv\w* (?:the |an? )?(?:application )?fee|exencion\w*|exoneracion\w*)\b/u],
 ['eligibility','rule','Eligibility','Elegibilidad',/\b(?:eligib\w*|qualif\w*|who can|quien puede|calific\w*)\b/u],
 ['requirements','requirement','Requirements','Requisitos',/\b(?:requirements?|prerequisites?|required documents?|documents? (?:(?:do i |will i )?need|needed|required)|requisitos?|prerrequisitos?|documentos? (?:necesarios|requeridos|que necesito))\b/u],
 ['steps','step','Steps','Pasos',/\b(?:steps?|how (?:do i|to|can i) (?:apply|submit|request|enroll|register)|where (?:do i|to|can i) (?:apply|submit)|pasos?|como (?:solicito|solicitar|enviar|inscrib\w*)|donde (?:entrego|envio|solicito))\b/u],
 ['contact','text','Contact','Contacto',/\b(?:contact|phone|email|who (?:do|can) i (?:call|ask)|contacto|telefono|correo|con quien)\b/u],
 ['location','text','Location','Ubicación',/\b(?:location|address|where is|where are|ubicacion|direccion|donde (?:esta|estan|queda))\b/u],
 ['hours','text','Hours','Horario',/\b(?:office hours|opening hours|hours|horario|horarios|a que hora)\b/u],
 ['duration','number','Duration','Duración',/\b(?:duration|how long|cuanto (?:tiempo|dura)|duracion)\b/u],
 ['format','text','Format','Modalidad',/\b(?:online|in person|hybrid|en linea|presencial|hibrid\w*|format|modalidad)\b/u],
 ['availability','rule','Availability','Disponibilidad',/\b(?:availability|available|offered|disponib\w*|ofrece|ofrecen)\b/u],
 ['award_amount','amount','Award amount','Monto de beca',/\b(?:award amount|scholarship amount|how much (?:is|does) (?:the |this )?(?:scholarship|grant)|monto (?:de (?:la )?)?beca|cuanto (?:es|da) (?:la |esta )?beca)\b/u],
 ['total_budget','amount','Total cost','Costo total',/\b(?:cost of attendance|coa|total costs?|total budget|costo (?:total|de asistencia)|presupuesto(?: total)?)\b/u],
 ['tuition_fees','amount','Tuition and fees','Matrícula y cuotas',/\b(?:tuition|matricula|aranceles)\b/u],
 ['housing','amount','Housing','Vivienda',/\b(?:housing costs?|rent costs?|costo (?:de (?:la )?)?(?:vivienda|alojamiento|alquiler))\b/u],
];
const definitionByKey=new Map(definitions.map(d=>[d[0],d]));
export function requestedResearchFacts(question,language='en'){
 const q=normalizedText(question);
 const found=definitions.filter(d=>d[4].test(q));
 // Procedure requests remain procedures when the subject is not "I", and in
 // Spanish constructions such as "cómo acepta un padre". Cost/duration
 // questions mentioning an action do not request its full workflow.
 if(!found.some(d=>d[0]==='steps')&&
  (/\bhow (?!much\b|many\b|long\b)[^.!?]{0,55}\b(?:apply|submit|request|enroll|register|accept)\b/u.test(q)||
   /\bcomo [^.!?]{0,55}\b(?:acept\w*|inscrib\w*|solicit\w*|envi\w*|registr\w*)\b/u.test(q)))found.push(definitionByKey.get('steps'));
 if(!found.some(d=>d[0]==='application_fee')&&/\b(?:application|apply|solicitud|solicitar)\b/u.test(q)&&/\b(?:fee|cuota|tarifa)\b/u.test(q)&&!/\b(?:tuition|matricula)\b/u.test(q))found.push(definitionByKey.get('application_fee'));
 // A delivery/population qualifier is not itself a request for another fact.
 const aspects=requestedResearchAspects(question);
 const filtered=found.filter(d=>
  // Asking how a fee can be waived does not ask for the fee amount again.
  (d[0]!=='application_fee'||!found.some(item=>item[0]==='fee_waiver')||/\b(?:how much|fee amount|amount of|cuanto cuesta|cuanto es|monto|deadline|fecha limite)\b/u.test(q))&&
  (d[0]!=='total_budget'||!found.some(item=>item[0]==='tuition_fees')||aspects.includes('total_budget'))&&
  (d[0]!=='format'||found.length===1||/\b(?:format|modalidad|online or|en linea o|is it online|es en linea)\b/u.test(q)));
 return filtered.map(([key,kind,en,es])=>({key,kind,label:language==='es'?es:en}));
}
export function researchTaskEntities(value){
 const names=Array.isArray(value)?value:String(value||'').split(/;|\s+(?:and|y|versus|vs\.?)\s+/iu);
 const seen=new Set();return names.map(v=>String(v).trim().slice(0,180)).filter(v=>{const key=researchSubjectIdentity(v);if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,16);
}
function explicitScope(question){
 const q=normalizedText(question),years=[...String(question).matchAll(/\b20\d{2}(?:[-–](?:20)?\d{2})?\b/gu)].map(m=>m[0].replace('–','-').replace(/^(20\d{2})-20(\d{2})$/u,'$1-$2'));
 const options={term:{fall:/\b(?:fall|otono)\b/u,spring:/\b(?:spring|primavera)\b/u,summer:/\b(?:summer|verano)\b/u,winter:/\b(?:winter|invierno)\b/u},
  housing:{renting:/\b(?:renting|rents?|alquil\w*|rentando)\b/u,with_family:/\b(?:with (?:family|parents|relatives)|con (?:familia|familiares|padres))\b/u,on_campus:/\b(?:residence halls?|dorms?|on campus|residencias universitarias)\b/u},
  enrollment:{part_time:/\b(?:part time|tiempo parcial)\b/u,full_time:/\b(?:full time|tiempo completo)\b/u}};
 const scope={};if(years.length)scope.cycle=[...new Set(years)].join(',');
 for(const [key,values] of Object.entries(options)){const selected=Object.entries(values).filter(([,re])=>re.test(q)).map(([value])=>value);if(selected.length===1)scope[key]=selected[0];}
 return scope;
}
export function createResearchTask(input={},previous=null){
 const question=String(input.question||'').trim().slice(0,3000),language=input.language==='es'?'es':'en';
 const direct=requestedResearchFacts(question,language);
 const inherited=previous?.version===1&&Array.isArray(previous.requirements)?previous.requirements:[];
 const requirements=direct.length?direct:inherited.length?inherited:[{key:'answer',kind:'text',label:language==='es'?'Respuesta solicitada':'Requested answer'}];
 const entities=researchTaskEntities([...(input.retainedEntities||[]),...researchTaskEntities(input.institution)]);
 return {version:1,revision:Number.isSafeInteger(previous?.revision)?previous.revision+1:1,question,language,entities,
  requirements:requirements.map(({key,label,kind})=>({key,label,kind})),scope:{...(previous?.scope||{}),...explicitScope(question)}};
}
function factMatches(fact,requirement){
 const text=normalizedText(fact.key+' '+fact.label),key=requirement.key;
 if(key==='answer')return true;
 if(normalizedText(fact.key)===normalizedText(key))return true;
 if(definitionByKey.get(key)?.[4].test(text))return true;
 if(key==='deadline')return fact.kind==='date'&&!/\b(?:opening|opens|abre|inicio)\b/u.test(text);
 if(key==='steps')return fact.kind==='step';
 if(key==='requirements')return fact.kind==='requirement';
 if(key==='eligibility')return fact.kind==='rule'&&/\b(?:eligib\w*|qualif\w*|requisito|rule|regla)\b/u.test(text);
 if(key==='award_amount')return fact.kind==='amount'&&/\b(?:award|scholarship|grant|beca|monto)\b/u.test(text);
 return false;
}
export function researchFactMatchesRequirement(fact,requirement){return factMatches(fact,requirement);}
export function researchFindingMatchesTaskEntity(task,entity,finding){
 const expected=researchSubjectIdentity(entity),actual=researchSubjectIdentity(finding.subject);
 if(!expected||actual===expected)return true;
 const applicantSuffix=/^(?:first year applicants?|solicitantes de primer ano)$/u;
 const suffix=actual.startsWith(expected+' ')?actual.slice(expected.length+1):'';
 if(finding.evidence?.topic==='admissions'&&applicantSuffix.test(suffix)&&/\b(?:first year|primer ano)\b/u.test(normalizedText(finding.evidence.scope?.population)))return true;
 const program=normalizedText(finding.evidence?.scope?.program);
 const question=' '+normalizedText(task?.question)+' ';
 if(program&&question.includes(' '+program+' ')&&actual===expected+' '+program)return true;
 // Legacy extraction sometimes appends population/facet words to the entity.
 // Require a bounded descriptor vocabulary corroborated by typed scope or
 // fact labels. Arbitrary office/program/campus suffixes remain distinct.
 if(suffix&&finding.evidence&&researchProgramScopeMatches(task?.question,finding.evidence)){
  const stem=w=>w.length>4&&w.endsWith('s')?w.slice(0,-1):w;
  const descriptors=new Set(('and of de del la las el los y new entering first year full time part california resident nonresident undergraduate graduate transfer tuition fees application regular decision deadline fall spring summer winter students applicants cost attendance budget annual academic total noncredit esl nuevo nuevos ingresante ingresantes primer ano tiempo completo parcial residente residentes california pregrado posgrado transferencia matricula cuotas solicitud regular decision fecha limite otono primavera verano invierno estudiantes solicitantes costo asistencia presupuesto anual academico total sin credito creditos ingles segundo idioma').split(' ').map(stem));
  const record=finding.evidence;
  const supported=new Set(normalizedText([record.scope.population,record.scope.cycle,record.scope.term,record.scope.enrollment,...record.facts.map(f=>f.label)].filter(Boolean).join(' ')).split(' ').map(stem));
  const words=suffix.split(' ').map(stem);
  if(words.length<=24&&words.every(w=>supported.has(w)&&(descriptors.has(w)||/^\d{2,4}$/u.test(w))))return true;
 }
 return false;
}
function scopeCovers(task,record){
 const scope=record.scope||{},requested=task?.scope||{},q=normalizedText(task?.question);
 // A dated benchmark remains useful evidence, but cannot complete a request
 // explicitly about a different cycle, population, or delivery scenario.
 if(requested.cycle&&requested.cycle!==scope.cycle)return false;
 if(requested.term&&requested.term!==scope.term)return false;
 if(requested.enrollment&&scope.enrollment!==requested.enrollment&&scope.enrollment!=='both')return false;
 const population=normalizedText(scope.population);
 for(const [ask,match,opposite] of [
  [/\b(?:graduate|masters?|doctoral|posgrado|maestria|doctorado)\b/u,/\b(?:graduate|masters?|doctoral|posgrado|maestria|doctorado)\b/u,/\b(?:undergraduate|pregrado)\b/u],
  [/\b(?:undergraduate|pregrado)\b/u,/\b(?:undergraduate|pregrado)\b/u,/\b(?:graduate|posgrado)\b/u],
  [/\b(?:transfer|transferencia|traslado)\b/u,/\b(?:transfer|transferencia|traslado)\b/u,/\b(?:first year|freshman|primer ano)\b/u],
  [/\b(?:first year|freshman|primer ano)\b/u,/\b(?:first year|freshman|primer ano)\b/u,/\b(?:transfer|transferencia|traslado)\b/u],
 ])if(ask.test(q)&&(!match.test(population)||opposite.test(population)))return false;
 if(/\b(?:international|internacional)\b/u.test(q)&&!/\b(?:international|internacional)\b/u.test(population))return false;
 if(/\b(?:nonresident|out of state|no residente)\b/u.test(q)&&!/\b(?:nonresident|out of state|no residente)\b/u.test(population))return false;
 if(/\b(?:resident|residente)\b/u.test(q)&&/\b(?:nonresident|no residente)\b/u.test(population)&&!/\b(?:nonresident|no residente)\b/u.test(q))return false;
 for(const [delivery,pattern] of [['online',/\b(?:online|en linea)\b/u],['in_person',/\b(?:in person|presencial)\b/u],['hybrid',/\b(?:hybrid|hibrido)\b/u]])if(pattern.test(q)&&scope.delivery!==delivery&&scope.delivery!=='any')return false;
 const namesProgram=/\b(?:program|major|department|carrera|programa|departamento)\b/u.test(q);
 if(!researchProgramScopeMatches(task?.question,record))return false;
 if(namesProgram&&!scope.program&&!/\b(?:which|what|any|que|cual|cualquier) (?:program|major|department|carrera|programa|departamento)\b|\b(?:office or program|oficina o programa)\b/u.test(q))return false;
 // Specific application types take precedence over the generic word application.
 const specific=[['housing',/\b(?:housing|dorms?|residence|vivienda|alojamiento)\b/u],['scholarships',/\b(?:scholarships?|becas?)\b/u],['financial_aid',/\b(?:financial aid|fafsa|ayuda financiera)\b/u],['enrollment',/\b(?:registration|enrollment|inscripcion)\b/u]];
 const topics=specific.filter(([,re])=>re.test(q)).map(([topic])=>topic);
 // Spanish "beca Pell" is federal aid, not just a private-scholarship topic.
 if(/\bpell\b/u.test(q)&&!topics.includes('financial_aid'))topics.push('financial_aid');
 if(topics.length&&!topics.includes(record.topic)&&record.topic!=='process')return false;
 if(!topics.length&&/\b(?:admission\w*|application|admision\w*|solicitud)\b/u.test(q)&&!['admissions','process'].includes(record.topic))return false;
 return true;
}
export function researchProgramScopeMatches(question,record){
 const q=normalizedText(question),program=normalizedText(record.scope?.program);
 if(!program)return true;
 if((' '+q+' ').includes(' '+program+' ')||/\b(?:same program|mismo programa)\b/u.test(q))return true;
 // Bilingual names/acronyms can identify the same program without literal
 // substring equality. These bounded aliases never match a campus or another
 // named degree, and noncredit remains distinct from credit-bearing ESL.
 const concept=value=>value.replace(/\b(?:federal pell grants?|beca(?:s)? (?:federal(?:es)? )?pell)\b/gu,'pell')
  .replace(/\b(?:english as a second language|ingles como segundo idioma|ingles segundo idioma)\b/gu,'esl')
  .replace(/\b(?:noncredit|non credit|sin creditos?)\b/gu,'noncredit').replace(/\beslnc\b/gu,'noncredit esl');
 const programConcept=concept(program),questionConcept=concept(q);
 if(programConcept==='pell'&&/\bpell\b/u.test(questionConcept))return true;
 if(/^(?:(?:noncredit|esl)\s*)+$/u.test(programConcept)&&/\bnoncredit\b/u.test(programConcept)&&/\besl\b/u.test(programConcept)&&
  /\bnoncredit\b/u.test(questionConcept)&&/\besl\b/u.test(questionConcept))return true;
 if(/\b(?:office or program|oficina o programa)\b/u.test(q))return true;
 if(/\b(?:program|major|department|carrera|programa|departamento)\b/u.test(q))return false;
 return record.topic==='admissions'&&/^(?:undergraduate admissions?|admision(?:es)? de pregrado)$/u.test(program)&&/\b(?:first year|primer ano|undergraduate|pregrado)\b/u.test(q)||
  ['process','financial_aid'].includes(record.topic)&&/^(?:federal fafsa|fafsa federal|fafsa)$/u.test(program)&&/\bfafsa\b/u.test(q);
}
function findingCovers(finding,requirement,task){
 if(!['verified','partial'].includes(finding.status))return false;
 if(finding.evidence){
  const record=finding.evidence;
  if(!scopeCovers(task,record))return false;
  const facts=record.facts.filter(f=>f.status==='verified'&&factMatches(f,requirement));
  if(!facts.length)return false;
  if(requirement.key==='steps'&&!researchRecordAudit(record).complete)return false;
  const check=researchRecordAudit({...record,complete:true,expectedFacts:facts.map(f=>f.key),facts});
  return check.complete;
 }
 if(finding.status!=='verified')return false;
 if(requirement.key==='total_budget'&&finding.budget)return budgetAudit(finding.budget).complete;
 if(requirement.key==='answer')return Boolean(finding.answer&&finding.sourceIds?.length);
 return finding.aspect===requirement.key&&Boolean(finding.sourceIds?.length||/\[\d+\]/u.test(finding.answer||''));
}
export function auditResearchTask(task,result={}){
 const findings=result.voiceBrief?.findings||[],entities=task?.entities?.length?task.entities:[''];
 const requirements=task?.requirements||[],missing=[];let verifiedCount=0;
 for(const entity of entities){
  const scoped=findings.filter(f=>researchFindingMatchesTaskEntity(task,entity,f));
  for(const requirement of requirements){
   if(scoped.some(f=>findingCovers(f,requirement,task)))verifiedCount++;
   else missing.push({entity,...requirement});
  }
 }
 const useful=findings.some(f=>['verified','partial'].includes(f.status)&&Boolean(f.sourceIds?.length||/\[\d+\]/u.test(f.answer||''))&&(!f.evidence||f.evidence.facts.some(fact=>fact.status==='verified'||fact.status==='partial'&&[fact.value,fact.amount,fact.date].some(value=>value!==null&&value!==undefined))));
 return {status:!missing.length&&requirements.length?'complete':useful?'partial':'unavailable',complete:requirements.length>0&&!missing.length,missing,verifiedCount};
}
// Topic cues identify clear switches, while scope questions remain conversational.
// Unknown requests are not automatically authorized as new searches.
const topicPatterns=[['cost',/\b(?:tuition|costs?|budgets?|coa|matricula|costos?|presupuestos?)\b/u],['admission',/\b(?:admission\w*|applications?|apply|admision\w*|solicitud|solicitar)\b/u],['scholarship',/\b(?:scholarship\w*|grants?|becas?)\b/u],['housing',/\b(?:housing|dorms?|residence|alojamiento|vivienda)\b/u],['tutoring',/\b(?:tutor\w*|tutoria\w*)\b/u],['counseling',/\b(?:counsel\w*|orientacion|consejer\w*)\b/u],['career',/\b(?:career\w*|jobs?|employment|empleo\w*|profesion\w*)\b/u],['program',/\b(?:major\w*|degree\w*|program\w*|carrera\w*)\b/u],['financial_aid',/\b(?:financial aid|fafsa|ayuda financiera)\b/u],['enrollment',/\b(?:registration|enrollment|inscripcion|registr\w*)\b/u],['transport',/\b(?:bus|buses|parking|transit|estacionamiento|autobus\w*)\b/u],['accessibility',/\b(?:disabilit\w*|accommodation\w*|discapacidad\w*|adaptacion\w*)\b/u]];
export function researchTaskRelationship(question,task){
 const q=normalizedText(question),prior=normalizedText(task?.question);
 if(!q)return 'unknown';
 if(/\b(?:change (?:the )?(?:topic|subject)|different question|cambiemos de tema|otra pregunta)\b/u.test(q))return 'changed';
 const currentTopics=topicPatterns.filter(([,re])=>re.test(q)).map(([key])=>key),oldTopics=topicPatterns.filter(([,re])=>re.test(prior)).map(([key])=>key);
 if(oldTopics.length&&currentTopics.some(topic=>!oldTopics.includes(topic))&&!currentTopics.some(topic=>oldTopics.includes(topic)))return 'changed';
 if(currentTopics.some(topic=>oldTopics.includes(topic)))return 'related';
 if(/\b(?:does that|is that|what does that|that include|what about|same|guaranteed|transfer applicants|submit it|include eso|eso incluye|es garantizado|y para|mismo|entrego eso|envio eso)\b/u.test(q))return 'related';
 const required=requestedResearchFacts(question),keys=new Set(task?.requirements?.map(r=>r.key)||[]);
 if(keys.has('total_budget')&&/\btotal\b/u.test(q)&&!currentTopics.length)return 'related';
 if(required.some(r=>keys.has(r.key)))return 'related';
 if(task?.entities?.some(entity=>q.includes(normalizedText(entity))))return 'related';
 // A clear, self-contained new request need not contain a known topic word.
 // This protects new topics without expanding a fixed taxonomy forever.
 if(/^(?:(?:please|por favor) )?(?:where is|where are|what is|what are|how do i|how can i|donde esta|donde estan|que es|que son|como puedo)\b/u.test(q)&&
   !/\b(?:it|that|this|those|they|eso|esto|esa|ese|esos|esos|estas)\b/u.test(q)){
  const neutral=new Set('where is are what how do can i the a an of for to in at on me please donde esta estan que es son como puedo el la los las un una de del para por en favor'.split(' '));
  const words=text=>text.split(' ').filter(word=>word.length>2&&!neutral.has(word));
  const oldWords=new Set(words(prior)),newWords=words(q);
  if(oldWords.size&&newWords.length&&!newWords.some(word=>oldWords.has(word)))return 'changed';
 }
 return 'unknown';
}

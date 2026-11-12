import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchSubjectIdentity} from '../src/researchFindings.mjs';
import {normalizedText as fold,researchRecordAudit,remapResearchRecord,researchRecordFinding,withoutRecordAuditNotes} from '../src/researchRecord.mjs';
import {createResearchTask,auditResearchTask,requestedResearchFacts,researchFactMatchesRequirement,researchFindingMatchesTaskEntity,researchProgramScopeMatches} from '../src/researchTask.mjs';
import {researchSourceAllowed as official} from './research-source-policy.mjs';
const names=value=>String(value||'').split(/;|\s+(?:and|y|versus|vs\.?)\s+/iu).map(s=>s.trim()).filter(Boolean);
const fresh=(value,now)=>Number.isFinite(Date.parse(value))&&now-Date.parse(value)>=0&&now-Date.parse(value)<300000;
const classes=[
 ['date',/\b(?:deadline|deadlines|due date|when|fecha|plazo|cuando)\b/u],
 ['amount',/\b(?:award amount|how much|amount|cuanto|monto|importe|maximum|maximo)\b/u],
 ['rule',/\b(?:eligibility|eligible|qualify|rules?|requisitos|elegibilidad|calificar)\b/u],
 ['step',/\b(?:steps?|how (?:do|to)|where (?:do|to)|pasos?|como|donde)\b/u],
];
const topics=[['scholarships',/\b(?:scholarships?|becas?)\b/u],['admissions',/\b(?:admissions?|application|solicitud|admision)\b/u],['housing',/\b(?:housing|residence|vivienda|alojamiento)\b/u],['financial_aid',/\b(?:financial aid|fafsa|ayuda financiera)\b/u],['enrollment',/\b(?:enrollment|registration|inscripcion)\b/u],['programs',/\b(?:programs?|majors?|programas?|carreras?)\b/u],['student_support',/\b(?:support office|student support|oficina de apoyo|apoyo estudiantil)\b/u],['careers',/\b(?:careers?|employment|empleo|profesion)\b/u]];
export function recordScopeMatches(question,record,{now=Date.now()}={}){
 const q=fold(question),s=record.scope;
 const canonicalCycle=value=>String(value||'').replace('–','-').replace(/^(20\d{2})-20(\d{2})$/u,'$1-$2');
 const years=[...question.matchAll(/\b20\d{2}(?:[-–](?:20)?\d{2})?\b/gu)].map(m=>canonicalCycle(m[0]));
 if(years.some(year=>!s.cycle||year!==canonicalCycle(s.cycle)))return false;
 const terms=[['fall',/\b(?:fall|otono)\b/u],['spring',/\b(?:spring|primavera)\b/u],['summer',/\b(?:summer|verano)\b/u],['winter',/\b(?:winter|invierno)\b/u]];
 if(terms.some(([term,re])=>re.test(q)&&s.term!==term))return false;
 const population=fold(s.population);
 for(const [re,own,opposite] of [
  [/\b(?:graduate|masters?|doctoral|posgrado|maestria|doctorado)\b/u,/\b(?:graduate|masters?|doctoral|posgrado|maestria|doctorado)\b/u,/\b(?:undergraduate|pregrado)\b/u],
  [/\b(?:undergraduate|pregrado)\b/u,/\b(?:undergraduate|pregrado)\b/u,/\b(?:graduate|posgrado)\b/u],
  [/\b(?:transfer|transferencia|traslado)\b/u,/\b(?:transfer|transferencia|traslado)\b/u,/\b(?:first year|freshman|primer ano)\b/u],
  [/\b(?:first year|freshman|primer ano)\b/u,/\b(?:first year|freshman|primer ano)\b/u,/\b(?:transfer|transferencia|traslado)\b/u],
  [/\b(?:international|internacional)\b/u,/\b(?:international|internacional)\b/u,/^$/u],
 ])if(re.test(q)&&(!own.test(population)||opposite.test(population)))return false;
 const choices=[['part_time',/\b(?:part time|medio tiempo|tiempo parcial)\b/u,'enrollment'],['full_time',/\b(?:full time|tiempo completo)\b/u,'enrollment'],['online',/\b(?:online|en linea)\b/u,'delivery'],['in_person',/\b(?:in person|presencial)\b/u,'delivery'],['hybrid',/\b(?:hybrid|hibrido)\b/u,'delivery']];
 if(choices.some(([v,re,key])=>re.test(q)&&s[key]!==v&&s[key]!==({enrollment:'both',delivery:'any'}[key])))return false;
 if(!researchProgramScopeMatches(question,record))return false;
 if(/\b(?:major|program|department|carrera|programa|departamento)\b/u.test(q)&&!s.program)return false;
 const today=new Date(now).toISOString().slice(0,10);
 if(s.validThrough&&s.validThrough<today&&!years.length)return false;
 if(record.facts.some(f=>f.kind==='date'&&f.date&&f.date<today)&&!years.length)return false;
 // Explicit source-population geography cannot be silently switched.
 if(/\b(?:international|nonresident|out of state|internacional|no residente)\b/u.test(q)&&!/(?:international|nonresident|out of state|internacional|no residente)/u.test(population))return false;
 if(/\b(?:resident|residente)\b/u.test(q)&&/\b(?:nonresident|no residente)\b/u.test(population))return false;
 if(s.jurisdiction&&/\b(?:residents? of|residentes? de|in the state of|en el estado de)\b/u.test(q)&&!q.includes(fold(s.jurisdiction)))return false;
 return true;
}
export function selectedRecordFacts(question,record,{allowImplicit=false}={}){
 const q=fold(question),requestedTopics=topics.filter(([,re])=>re.test(q)).map(([topic])=>topic);
 if(requestedTopics.length&&!requestedTopics.includes(record.topic))return null;
 const requirements=requestedResearchFacts(question);
 const kinds=classes.filter(([,re])=>re.test(q)).map(([kind])=>kind);
 const named=record.facts.filter(f=>q.includes(fold(f.label))||q.includes(fold(f.key).replaceAll('_',' ')));
 if(!requirements.length&&!kinds.length&&!named.length)return allowImplicit?record.facts:null;
 const selected=[];
 // Select by the requested fact, not just its type: an award amount cannot
 // satisfy an application fee. Missing facts leave useful siblings reusable;
 // the independent task audit below decides whether a new lookup is needed.
 const requests=requirements.length?requirements:kinds.map(kind=>({kind}));
 for(const request of requests){
  const candidates=record.facts.filter(f=>request.key?researchFactMatchesRequirement(f,request):f.kind===request.kind||(request.kind==='rule'&&f.kind==='requirement'));
  const exact=candidates.filter(f=>named.includes(f));
  if(exact.length)selected.push(...exact);
  else if(candidates.length===1)selected.push(candidates[0]);
  else if(request.kind==='step')selected.push(...candidates);
  else if(candidates.length>1)return null;
 }
 selected.push(...named);
 return [...new Set(selected)];
}
function hasNewQualifier(question,finding,institutions){
 const record=finding.evidence;
 const known=new Set(fold([institutions,record.topic,...Object.values(record.scope),...record.facts.flatMap(f=>[f.label,f.key,f.value,f.qualification])].join(' ')).replaceAll('_',' ').split(' '));
 const neutral=new Set(('what when where is are was were the a an for of to in at on and or can could you me tell remind again please about how much amount maximum deadline deadlines due date dates admissions admission application scholarship scholarships eligibility eligible qualify rule rules requirement requirements step steps process published source official year first fall spring summer winter same program '+
 'do does did repeat explain compare comparison versus with applications close closes closing fee fees cost apply contact location address hours duration format availability available offered '+
 'cual cuales que cuando donde es son fue eran el la los las un una para de del al en y o puede puedes podria me decir recuerdas otra vez por favor cuanto monto importe maximo fecha fechas limite plazo plazos admision admisiones solicitud beca becas requisitos elegibilidad calificar regla reglas paso pasos proceso publicado publicada oficial fuente ano primer primavera verano invierno otono mismo programa '+
 'dime recuerdame repite explica compara comparar comparacion con contra frente cierra cierran vence vencen vencimiento costo cuota tarifa cobro solicitar contacto ubicacion direccion horario horarios duracion modalidad disponibilidad disponible ofrece ofrecen').split(' '));
 return fold(question).replaceAll('_',' ').split(' ').some(word=>word.length>2&&!/^\d+$/u.test(word)&&!known.has(word)&&!neutral.has(word));
}
function savedEntry(input,row,institution,findings,start,now){
 const sources=row.result.sources||[],byId=new Map(sources.map((s,i)=>[s.id??i+1,s])),ids=[...new Set(findings.flatMap(f=>f.sourceIds))];
 if(!ids.length||ids.some(id=>!byId.has(id)||!official(byId.get(id).url)||!fresh(byId.get(id).checkedAt||row.result.checkedAt,now)))return null;
 const refs=new Map(ids.map((id,i)=>[id,'R'+(start+i+1)]));
 const remap=text=>text.replace(/\[(\d+)\]/gu,(_,id)=>'['+refs.get(Number(id))+']');
 return {institution,question:row.input.question,coverage:'verified',checkedAt:new Date(Math.min(...ids.map(id=>Date.parse(byId.get(id).checkedAt||row.result.checkedAt)))).toISOString(),
  findings:findings.map(f=>({...f,answer:remap(f.answer),qualification:remap(f.qualification),evidence:remapResearchRecord(f.evidence,remap)})),
  sources:ids.map(id=>{const source=byId.get(id);return {ref:refs.get(id),url:source.url,title:source.title,checkedAt:source.checkedAt||row.result.checkedAt};})};
}
export function structuredRecordReuse(input,records,{now=Date.now()}={}){
 if(input.forceRefresh||!['admissions','finance','planning','loans'].includes(input.mode))return null;
 const targets=names(input.institution);if(!targets.length||targets.length>4)return null;
 const researchTask=createResearchTask(input);
 const entries=[];let ref=0;
 for(const name of targets){
  let entry;
  for(const row of records.slice(0,8)){
   if(row.status!=='completed'||row.input?.mode!==input.mode||!fresh(row.finished_at||row.result?.checkedAt,now))continue;
   const candidates=(researchBriefSelection(row.result).findings||[]).filter(f=>f.evidence&&['verified','partial'].includes(f.status)&&researchFindingMatchesTaskEntity(researchTask,name,f)&&recordScopeMatches(input.question,f.evidence,{now})&&!hasNewQualifier(input.question,f,targets.join(' ')));
   const selected=candidates.flatMap(f=>{
    const facts=selectedRecordFacts(input.question,f.evidence)?.filter(f=>f.status==='verified');if(!facts?.length||!researchRecordAudit({...f.evidence,complete:true,expectedFacts:facts.map(f=>f.key),facts}).complete)return [];
    const procedure=facts.some(f=>f.kind==='step');
    const evidence={...f.evidence,complete:procedure?f.evidence.complete:true,expectedFacts:procedure?f.evidence.expectedFacts:facts.map(f=>f.key),facts};
    const normalized=researchRecordFinding(evidence,withoutRecordAuditNotes(f.qualification),input.language);
    return [{...f,status:normalized.audit.complete?'verified':'partial',evidence,answer:normalized.answer,qualification:normalized.qualification}];
   });
   if(!selected.length||selected.length>1&&new Set(selected.map(f=>f.aspect)).size<selected.length)continue;
   entry=savedEntry(input,row,name,selected,ref,now);if(entry)break;
  }
  if(!entry)continue;
  entry.coverage=auditResearchTask({...researchTask,entities:[name]},{voiceBrief:{findings:entry.findings}}).complete?'verified':'reference';
  ref+=entry.sources.length;entries.push(entry);
 }
 if(!entries.length||entries.flatMap(e=>e.findings).length>8)return null;
 const audit=auditResearchTask(researchTask,{voiceBrief:{findings:entries.flatMap(e=>e.findings)}});
 return {reusedEvidence:entries,lookupInstitutions:targets.filter(name=>audit.missing.some(f=>researchSubjectIdentity(f.entity)===researchSubjectIdentity(name))),missingResearchFacts:audit.missing,researchTask};
}
export function structuredRecordAddition(input,base,{now=Date.now()}={}){
 if(input.forceRefresh||base?.status!=='completed'||base.input?.mode!==input.mode||!fresh(base.finished_at||base.result?.checkedAt,now))return null;
 const old=names(base.input.institution),target=names(input.institution);
 if(!old.length||old.length>4||target.length!==1||old.some(name=>researchSubjectIdentity(name)===researchSubjectIdentity(target[0])))return null;
 const findings=(researchBriefSelection(base.result).findings||[]).filter(f=>f.evidence&&f.status==='verified');
 if(!findings.length||findings.some(f=>!researchRecordAudit(f.evidence).complete||!recordScopeMatches(input.question,f.evidence,{now})))return null;
 const selected=findings.filter(f=>selectedRecordFacts(input.question,f.evidence,{allowImplicit:true})?.length);
 if(!selected.length||new Set(selected.map(f=>JSON.stringify([f.evidence.topic,f.evidence.scope,f.evidence.expectedFacts]))).size!==1)return null;
 const entries=[];let ref=0;
 for(const institution of old){
  const scoped=selected.filter(f=>researchSubjectIdentity(f.subject)===researchSubjectIdentity(institution));if(!scoped.length)return null;
  const entry=savedEntry(input,base,institution,scoped,ref,now);if(!entry)return null;entries.push(entry);ref+=entry.sources.length;
 }
 const record=selected[0].evidence;
 // The old source's expiration is provenance, not the new option's deadline.
 const {validThrough,...scope}=record.scope;
 const question=(input.language==='es'?'Verifica solo ':'Verify only ')+target[0]+': '+JSON.stringify({topic:record.topic,scope,requestedFacts:record.expectedFacts})+'. '+(input.language==='es'?'Conserva las cifras, fuentes y condiciones anteriores sin volver a investigarlas. No sustituyas una fecha vencida por una actual.':'Retain the previous facts, sources and conditions without researching them again. Do not substitute an expired deadline for a current one.');
 return {question,institution:target[0],lookupInstitutions:target,reusedEvidence:entries,comparisonAddition:true};
}

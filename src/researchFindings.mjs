import {validatedBudget} from './publishedBudget.mjs';
import {validatedResearchRecord} from './researchRecord.mjs';
// Small, source-linked units of a research result. These are reference data,
// never instructions or a claim that the caller heard/understood a finding.
export const researchAspects=['tuition_fees','total_budget','housing','deadline','eligibility','other'];
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function validatedResearchFindings(result={}){
 const findings=result.voiceBrief?.findings||result.findings;
 if(!Array.isArray(findings)||findings.length>8)return [];
 const sources=new Set((result.sources||[]).map((source,index)=>source.id??index+1));
 return findings.filter(f=>f&&typeof f.subject==='string'&&f.subject.trim()&&f.subject.length<=160&&researchAspects.includes(f.aspect)&&
  ['verified','partial','unverified'].includes(f.status)&&typeof f.answer==='string'&&f.answer.trim()&&f.answer.length<=700&&
  typeof f.qualification==='string'&&f.qualification.length<=700).flatMap(f=>{
   const sourceIds=[...new Set([...`${f.answer}\n${f.qualification} ${f.evidence?JSON.stringify(f.evidence.facts):''}`.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1])))];
   if(sourceIds.some(id=>!sources.has(id))||(f.status!=='unverified'&&!sourceIds.length))return [];
   const budget=f.budget&&validatedBudget(f.budget,sources);
   if(f.budget&&!budget)return [];
   const evidence=f.evidence&&validatedResearchRecord(f.evidence,sources);
   if(f.evidence&&(!evidence||budget))return [];
   return [{subject:f.subject,aspect:f.aspect,status:f.status,answer:f.answer,qualification:f.qualification,sourceIds,...(budget?{budget}:{}),...(evidence?{evidence}:{})}];
  });
}
const aspectPatterns={
 tuition_fees:/\b(?:tuition|fees?|matricula|cuotas?|colegiatura|aranceles?)\b/u,
 total_budget:/\b(?:total|budget|budgets|presupuesto|presupuestos|cost of attendance|costo de asistencia)\b/u,
 housing:/\b(?:housing|dorms?|living|rent|vivienda|alojamiento|residencia|vivir|alquiler)\b/u,
 deadline:/\b(?:deadlines?|due date|fecha limite|plazo|plazos)\b/u,
 eligibility:/\b(?:eligib\w*|qualify|calific\w*|requisitos)\b/u,
};
export function researchFocus(text){
 return Object.entries(aspectPatterns).filter(([,pattern])=>pattern.test(fold(text))).map(([aspect])=>aspect);
}
const normalizeSubject=value=>fold(value).replace(/\b(?:university of california|universidad de california)\b/gu,'uc')
 .replace(/\b(?:california state university|universidad estatal de california)\b/gu,'csu');
export function researchSubjectIdentity(subject){
 // Generated subjects sometimes append population/housing without a delimiter.
 // Strip only recognizable scenario suffixes, not arbitrary name words (e.g.
 // Santa Cruz, North Campus, or California State University).
 return normalizeSubject(String(subject).split(/\s+[—–]\s+|\s*\(/u)[0])
  .replace(/\s+(?=(?:(?:california|in state|out of state) )?(?:residents?|nonresidents?)\b|(?:new |entering )?(?:undergraduates?|graduates?|transfers?)\b|off campus\b|on campus\b|residence halls?\b|apartments?\b|(?:estudiantes |alumnos )|residentes? de\b|fuera del campus\b|dentro del campus\b|20\d{2}\b).*/u,'').trim();
}
export function findingSubjectMentioned(subject,text,{exact=false}={}){
 const normalized=normalizeSubject(text),name=researchSubjectIdentity(subject);
 if(!name)return false;
 const parts=name.split(' ').filter(w=>!['university','universidad','college','of','de','the','california','uc','csu'].includes(w));
 if(!parts.length)return false;
 const acronym=name.split(' ').map(w=>['uc','csu'].includes(w)?w:w[0]).join('');
 const contains=phrase=>exact?normalized===phrase:` ${normalized} `.includes(` ${phrase} `);
 return !!normalized&&(contains(name)||(parts.length&&contains(parts.join(' ')))||
  (acronym.length>=3&&contains(acronym)));
}
export function focusedResearchFindings(findings,text,aspects=researchFocus(text)){
 const subjects=findings.filter(f=>findingSubjectMentioned(f.subject,text));
 const candidates=subjects.length?subjects:findings;
 const focused=aspects.length?candidates.filter(f=>aspects.includes(f.aspect)||f.evidence&&aspects.some(aspect=>
  aspect==='deadline'&&f.evidence.facts.some(fact=>fact.kind==='date')||
  aspect==='eligibility'&&f.evidence.facts.some(fact=>['rule','requirement'].includes(fact.kind))||
  aspect==='housing'&&f.evidence.topic==='housing')):candidates;
 // No matching facet is not evidence that an unrelated answer satisfies it.
 return focused;
}

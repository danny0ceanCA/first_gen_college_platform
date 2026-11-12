import {isResearchAcknowledgment} from '../src/researchSpeechObservation.mjs';
import {validatedResearchFindings} from '../src/researchFindings.mjs';
import {createResearchTask,researchTaskRelationship,researchFindingMatchesTaskEntity} from '../src/researchTask.mjs';
import {requestedResearchAspects} from '../src/researchQuestion.mjs';
import {comparisonFindings,visualSubjectName} from './voice-comparison-update.mjs';
import {costHousingScenario} from './voice-housing-scope.mjs';
import {hasCoaBreakdown} from './coa-evidence.mjs';
import {requestsCoa} from './coa-evidence.mjs';

function relatedFollowup(question,text,task){
 text=String(text||'').replace(/^[\s.,…]+/u,'').trim();
 const relation=researchTaskRelationship(text,task||createResearchTask({question}));
 if(relation==='changed')return false;
 if(relation==='related')return true;
 // Preserve the established budget clarification behavior while older jobs
 // without a structured task are still in the session history.
 if(!requestsCoa(question)&&! /\b(?:budgets?|tuition|fees|presupuesto|matrícula|cuotas)\b/iu.test(question||''))return false;
 if(/\b(?:forget|instead|change (?:the )?topic|let['’]s (?:move|switch)|olvida|en cambio|cambiemos)\b/iu.test(text))return false;
 return /\b(?:costs?|pay|paying|bill(?:ed|s)?|charges?|expenses?|tuition|fees|budget|includes?|estimates?|costo|costos|pagar|pago|factura|cobran|cargos|gastos|matrícula|cuotas|presupuesto|incluye|estimad[oa])\b/iu.test(text)||
  /^(?:(?:right|okay|ok|yes|yeah|si|sí|claro|vale)[,\s]*)*(?:i (?:remember|understand)(?: that)?|ya (?:recuerdo|entiendo)|lo recuerdo)[.!\s]*$/iu.test(text)||
  /^(?:well|sorry|uh|um|eh|bueno|perd[oó]n|i|yo)(?:[,.\s]+(?:uh|um|eh|i|yo))*[.!\s]*$/iu.test(text);
}

function taskForJob(job){return job.result?.researchTask||job.input?.researchTask||job.query?.researchTask||
 createResearchTask({question:job.question||job.query?.question||'',language:job.query?.language,
  institution:job.query?.visualComparisonCampus||job.query?.institution||''});}
function requestedTableAspects(task,question){
 const aspects=requestedResearchAspects(question);
 if(aspects.length)return aspects;
 if(/\b(?:costs?|costos?|coste)\b/iu.test(question||''))return ['total_budget'];
 const kinds=(task?.requirements||[]).map(requirement=>requirement.kind);
 const mapped=[...new Set(kinds.map(kind=>kind==='date'?'deadline':['rule','requirement'].includes(kind)?'eligibility':'other'))];
 return mapped.length?mapped:['other'];
}
function preserveRequestedColumns(table,task){
 const requested=(task?.entities||[]).map(visualSubjectName).filter(Boolean);
 const missing=requested.filter(subject=>!table.columns.some((column,index)=>
  researchFindingMatchesTaskEntity(task,subject,{subject:column})||table.rows.some(row=>row.cells[index]?.evidence&&
   researchFindingMatchesTaskEntity(task,subject,{subject:column,evidence:row.cells[index].evidence}))));
 return missing.length?{...table,columns:[...table.columns,...missing],rows:table.rows.map(row=>({...row,cells:[...row.cells,...missing.map(()=>null)]}))}:table;
}

function researchTable(result,now){
 const entries=comparisonFindings(result,{now,forVisual:true})||[];
 const unresolved=validatedResearchFindings(result).filter(finding=>finding.status!=='verified'&&
  !entries.some(entry=>entry.sourceSubject===finding.subject&&entry.aspect===finding.aspect));
 const dimensions=[...entries,...unresolved.map(finding=>({...finding,sourceSubject:finding.subject,
  subject:visualSubjectName(finding.subject)})).filter(finding=>finding.subject)];
 if(!dimensions.length)return null;
 const useScopes=new Set(dimensions.map(entry=>entry.subject+'|'+entry.aspect)).size<dimensions.length;
 const columnFor=entry=>useScopes||entry.sources?.some(source=>source.catalogValidity)?entry.sourceSubject:entry.subject;
 const columns=[...new Set(dimensions.map(columnFor))];
 const rows=[...new Set(dimensions.map(entry=>entry.aspect))].map(aspect=>({
  aspect,cells:columns.map(subject=>{
   const entry=entries.find(finding=>columnFor(finding)===subject&&finding.aspect===aspect)||
    dimensions.find(finding=>finding.evidence&&columnFor(finding)===subject&&finding.aspect===aspect);
   return entry?{scope:entry.sourceSubject,answer:entry.answer,qualification:entry.qualification,status:entry.status,...(entry.budget?{budget:entry.budget}:{}),...(entry.evidence?{evidence:entry.evidence}:{}),
    sources:(entry.sources||[]).map(({id,title,url})=>({id,title,url}))}:null;
  }),
 }));
 const unverifiedTotals=columns.filter(column=>
  dimensions.some(finding=>columnFor(finding)===column&&finding.aspect==='total_budget'&&finding.status==='unverified')&&
  !entries.some(finding=>columnFor(finding)===column&&finding.aspect==='total_budget'));
 const unverifiedCells=dimensions.filter(finding=>finding.status==='unverified').map(finding=>({column:columnFor(finding),aspect:finding.aspect}));
 return {columns,rows,unverifiedTotals,unverifiedCells};
}

// The worker supplies the evidence. Transcript observations only decide
// whether to open a result now or put it quietly into this call's history.
const openHousingQuestion=question=>costHousingScenario(question)==='off_campus'||
 /\b(?:off[- ]campus arrangement|modalidad fuera del campus)\b[^.!?]{0,90}\b(?:unspecified|sin especificar)\b/iu.test(question||'');
const housingAnswer=text=>/^\s*(?:(?:renting|alquilando|alquiler)(?:\s*,?\s*(?:off[- ]campus|fuera del campus))?|(?:living|staying) with (?:family|relatives)|con (?:familia|familiares))[.!\s]*$/iu.test(text);
const repeatRequest=/^\s*¿?(?:repeat (?:that|it)|say that again|(?:can|could) you (?:repeat (?:that|it)|say that again)|rep[ií]telo|repite(?: eso)?|(?:puedes|podr[ií]as) repetir(?:lo| eso)?)[.!?\s]*$/iu;
export function voiceVisualCards({emit,now=Date.now}){
 let turn=0,speaking=false,tracked;
 const deferred=new Map();
 function publish(job,researchTurn,housingQuestion){
  const task=taskForJob(job);
  let table=job.result&&researchTable(job.result,now());
  if(!table&&job.status==='failed'){
   const columns=(task.entities||[]).map(visualSubjectName).filter(Boolean).slice(0,8);
   const aspects=requestedTableAspects(task,job.question||job.query?.question||tracked?.question||'');
   if(columns.length)table={columns,rows:aspects.map(aspect=>({aspect,cells:columns.map(()=>null)})),
    unverifiedTotals:aspects.includes('total_budget')?columns:[],unverifiedCells:columns.flatMap(column=>aspects.map(aspect=>({column,aspect})))};
  }
  if(!table)return;
  table=preserveRequestedColumns(table,task);
  const housing=costHousingScenario(job.question||job.query.question)||(housingQuestion?'off_campus':undefined);
  const rentalBenchmark=housing==='off_campus'&&validatedResearchFindings(job.result).some(finding=>
   hasCoaBreakdown(finding)&&(finding.budget?.housing==='renting'&&finding.budget.assumed||costHousingScenario(finding.subject+' '+finding.answer)==='renting'&&
   /\b(?:benchmark|referencia)\b/iu.test(finding.qualification)&&
   /\b(?:unconfirmed|not confirmed|assumed|sin confirmar|no confirmad[oa]|supuest[oa])\b/iu.test(finding.qualification)));
  const catalogBudgets=job.result?.catalogLocalTesting?validatedResearchFindings(job.result).flatMap(f=>f.budget?[f.budget]:[]):[];
  const scopeNote=catalogBudgets.some(b=>b.housing==='unspecified')?
   (job.query.language==='es'?'Referencia de viajero/remoto; falta confirmar si corresponde a vivir con familiares.':'Commuter/remote benchmark; applicability to living with family is unconfirmed.'):
   catalogBudgets.some(b=>b.housing==='off_campus')?
   (job.query.language==='es'?'Referencia publicada fuera del campus; confirma si corresponde a su vivienda.':'Published off-campus benchmark; confirm whether it fits the student’s housing.') : undefined;
  const event={type:'origen.visual.research',report:{
   id:job.id,language:job.query.language==='es'?'es':'en',table,pending:job.status==='running',researchTask:task,
   // Only an authorized, scope-compatible addition extends table history.
   // A changed scenario uses comparisonBaseJobId and must not restore old facts.
   ...(job.query.retainedComparisonJobId?{comparisonBaseId:job.query.retainedComparisonJobId}:{}),
   ...(job.query.visualComparisonBaseId?{comparisonReferenceId:job.query.visualComparisonBaseId}:{}),
   // Catalog columns already carry their own published housing category and
   // qualifications. A requested personal scenario must not hide a labelled
   // source benchmark (generic off-campus or commuter), or relabel it as fact.
   housingScenario:job.result?.catalogLocalTesting?undefined:job.query.confirmedHousingChoice||(rentalBenchmark?'renting':housing),
   ...(scopeNote?{scopeNote}:{}),
   ...(job.query.confirmedHousingChoice?{confirmedHousingChoice:job.query.confirmedHousingChoice}:{}),
   ...(job.query.visualComparisonBaseId&&!job.query.visualComparisonCampus?{compareHousing:true}:{}),
   ...(rentalBenchmark&&!job.query.confirmedHousingChoice?{housingBenchmark:true}:{}),updatedAt:now(),
  },present:researchTurn===turn};
  if(researchTurn===turn&&speaking)deferred.set(job.id,{turn,event,housingQuestion,question:job.question,task});
  emit(event);
 }
 return {
  inputStarted(){speaking=true;},
  callerTurn(text){
   speaking=false;
   const words=typeof text==='string'?text.replace(/\[[^\]]*(?:\]|$)/gu,'').trim():'';
   const pending=tracked||[...deferred.values()].at(-1),question=pending?.question;
   if(words&&!isResearchAcknowledgment(words)&&!repeatRequest.test(words)&&!relatedFollowup(question,words,pending?.task)&&
    !((tracked?.housingQuestion||[...deferred.values()].some(entry=>entry.housingQuestion))&&housingAnswer(words)))turn++;
   for(const entry of deferred.values())if(entry.turn===turn)emit({...entry.event,present:true});
   deferred.clear();
  },
  trackResearch(key,question,task){tracked={key,turn,question,task:task||createResearchTask({question}),housingQuestion:openHousingQuestion(question)};deferred.clear();},
  cancelResearch(){tracked=undefined;deferred.clear();},
  reset(){tracked=undefined;deferred.clear();speaking=false;emit({type:'origen.visual.research.reset'});},
  presentRetained(job,present){publish(job,present?turn:-1,openHousingQuestion(job.question));},
  receiveResearch(job){
   if(!tracked||tracked.key!==job.query.requestKey)return;
   const {turn:researchTurn,housingQuestion}=tracked;
   if(job.status!=='running')tracked=undefined;
   publish(job,researchTurn,housingQuestion);
  },
 };
}

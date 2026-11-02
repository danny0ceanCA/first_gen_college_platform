import {retrievalTerms} from './history-retrieval.mjs';
import {guidanceProgress} from '../src/guidanceFollowThrough.mjs';

export const NEXT_STEP_POLICY='binder-next-step-v1';
const day=86400000;
const fold=text=>String(text||'').toLowerCase().normalize('NFD').replace(/\p{M}/gu,'');
const generic=new Set(['college','student','help','want','need','learn','universidad','estudiante','ayuda','quiero','necesito','aprender']);
const terms=text=>retrievalTerms(fold(text)).filter(t=>t.length>=4&&!generic.has(t));
const topicWords={transfer:/\b(transfer|transferencia|transferir|courses?|cursos?)\b/,costs:/\b(aid|costs?|tuition|scholarships?|becas?|costos?|financiera)\b/,applications:/\b(piqs?|essays?|applications?|ensayos?|solicitudes?)\b/,options:/\b(majors?|careers?|carreras?)\b/};
const topicsFor=input=>input.workspace?.topic?[input.workspace.topic]:['finance','loans'].includes(input.mode)?['costs']:input.mode==='admissions'?['applications']:input.mode==='planning'?['options','transfer']:['options','transfer','costs','applications'];
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
function targetDays(value,now){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=timestamp(value);if(time===null||new Date(time).toISOString().slice(0,10)!==value)return null;
 return Math.round((time-Date.parse(new Date(now).toISOString().slice(0,10)))/day);
}
const scopeMatches=(item,scope)=>!item.evidence?.scope||!scope||item.evidence.scope.kind===scope.kind&&item.evidence.scope.studentId===scope.studentId;
const fromParent=item=>item.speaker==='parent'||item.reportedBy==='parent'||item.evidence?.speaker==='parent'||item.evidence?.reportedBy==='parent';

// Pure selection over an already authorized, bounded workspace. This is not an
// authorization boundary or a database query. Never persist a score as a fact.
export function rankBinderNextSteps(input,{now=Date.now()}={}){
 const workspace=input.workspace||{},scope=workspace.scope,topics=topicsFor(input);
 const goals=(input.studentBrief?.memories||[]).filter(m=>m.category==='goal'&&m.status==='confirmed'&&scopeMatches(m,scope)&&!(input.role==='student'&&fromParent(m))).slice(0,4);
 const goalWords=new Set(goals.flatMap(g=>terms(g.content)));
 const goalTopics=new Set(Object.entries(topicWords).filter(([,pattern])=>goals.some(g=>pattern.test(fold(g.content)))).map(([topic])=>topic));
 const eligible=item=>scopeMatches(item,scope)&&(!item.topic||topics.includes(item.topic))&&!item.hidden&&!item.withdrawn&&!item.connectionEnded;
 const candidates=[];
 function add(kind,item,base,reason){
  if(!eligible(item))return;
  const text=kind==='action'?item.action||item.title:kind==='coordinator-guidance'?item.body:item.content;
  if(!text?.trim())return;
  let score=base;const reasons=[reason];
  if(terms(text).some(word=>goalWords.has(word))||goalTopics.has(item.topic)){score+=15;reasons.push('matches-confirmed-goal');}
  const updated=timestamp(item.updatedAt||item.editedAt||item.createdAt);
  if(updated!==null&&updated<=now){
   if(now-updated<=30*day){score+=5;reasons.push('recent-context');}
   else if(now-updated>180*day){score-=15;reasons.push('older-context');}
  }
  if(kind==='action'){
   const days=targetDays(item.personalTargetDate,now);
   if(days!==null&&days>=0&&days<=7){score+=25;reasons.push('personal-target-within-week');}
   else if(days!==null&&days>7&&days<=30){score+=10;reasons.push('personal-target-within-month');}
   else if(days!==null&&days<0&&days>=-30){score+=15;reasons.push('personal-target-passed');}
  }
  candidates.push({...item,kind,ranking:{policy:NEXT_STEP_POLICY,score,reasons},_text:fold(text).trim()});
 }
 for(const item of (workspace.actions||[]).slice(0,5))if(!item.followUpControlled&&['not-started','in-progress'].includes(item.status))add('action',item,60,'accepted-unfinished-step');
 for(const item of (workspace.notes||[]).slice(0,6))if(item.kind==='question'&&!(input.role==='student'&&fromParent(item)))add('question',item,50,'saved-unresolved-question');
 const guidance=workspace.relatedCoordinatorGuidance;
 if(input.role==='student'&&scope?.kind==='student'&&guidance&&guidanceProgress(guidance.followThrough).shouldOffer)add('coordinator-guidance',guidance,40,'optional-coordinator-suggestion');
 candidates.sort((a,b)=>b.ranking.score-a.ranking.score); // Stable ties retain server selection order.
 const seen=new Set();return candidates.filter(c=>{if(seen.has(c._text))return false;seen.add(c._text);return true;}).map(({_text,...candidate})=>candidate);
}

export function selectBinderOpening(input,options){
 if(input.openingDecision!==undefined)return input.openingDecision?.opening||null;
 if(input.onboarding===true||input.routeConversations&&input.targetConfirmed!==true||input.continuing||input.continuity?.length||input.scopeRestart||input.workspaceRefreshOnly||input.workspace?.selection||!(input.experience?.usedApp||input.experience?.usedVoice))return null;
 return rankBinderNextSteps(input,options)[0]||null;
}

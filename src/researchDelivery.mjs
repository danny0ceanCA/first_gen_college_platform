import {researchContextPackets,selectedResearchContextFindings,focusedResearchContextFacts} from './liveResearchContext.mjs';
import {researchBriefSelection} from './researchBrief.mjs';
import {researchAnswerOverlap,researchLimitationOverlap,researchPortionObserved,researchScopeCompatible,researchFindingHasOnlyUnverifiedFacts,researchImplicitLimitationObserved,researchBudgetTotalObserved} from './researchDiscussion.mjs';
import {focusedResearchFindings,findingSubjectMentioned,researchSubjectIdentity} from './researchFindings.mjs';
import {requestedResearchAspects} from './researchQuestion.mjs';
import {isResearchAcknowledgment} from './researchSpeechObservation.mjs';
import {createResearchTask,researchTaskRelationship,requestedResearchFacts,researchFactMatchesRequirement} from './researchTask.mjs';
import {researchSpokenFinding,researchCaveatObservation} from './researchAnswerDelivery.mjs';
export {researchAnswerOverlap} from './researchDiscussion.mjs';

// A delivery opportunity is separate from a completed job. This controller never
// starts research, cancels speech, requests a backend response, or changes scope.
// Transcript overlap is conservative duplicate suppression, NOT a semantic
// grader or proof the listener heard/understood the answer.
const words=text=>String(text||'').replace(/\[\d+\]/gu,'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const evidenceText=text=>words(text).join(' ');
// An affirmative like “sure” can accept an offer. Keep its ordinary reply
// opportunity. Only passive listening cues release a result immediately.
const passiveAcknowledgment=text=>isResearchAcknowledgment(text)&&
 /^(?:okay|ok|right|alright|all right|mhm|mm ?hmm?|mm|hmm|i see|got it|vale|entiendo|ya veo|aha|aja)$/u.test(evidenceText(text));
const rental=/\b(?:rent\w*|apartment\w*|alquil\w*|apartament\w*)\b/u;
// Release a completed courtesy/progress reply without claiming research was
// delivered. Playback and sentence-boundary guards still own the floor.
const progressOnly=text=>!/[?¿？]/u.test(text)&&!/[\d$€£]/u.test(text)&&
 /^(?:(?:sure|okay|ok|yes|of course|claro|si|bien|vale)\s+)*(?:(?:i ll|i will|let me|i am|i m) (?:check|checking|look|look up|look into)(?:\s+(?:that|this|it|for you))*|(?:voy a|dejame|estoy) (?:revisar|revisando|consultar|consultando|comprobar|comprobando)(?:\s+(?:eso|esto|lo|para ti))*|just (?:a moment|one moment)|un momento)$/u.test(evidenceText(text));
const relatives=/\b(?:relatives|family|parents|familia\w*|padres)\b/u;
function housingQuestion(text){
 return String(text||'').split(/(?<=[.!?])\s+/u).some(part=>{
  const value=evidenceText(part);
  return /[?？]/u.test(part)&&rental.test(value)&&relatives.test(value);
 });
}
function housingClarification(job){
 if(job.researchPending||job.failed||job.selection.evidenceFormat!=='brief-v1')return;
 const [headline,,fallbackQuestion]=job.selection.text.split('\n');
 const question=job.result?.voiceBrief?.nextStep||fallbackQuestion;
 const findings=job.selection.findings||[];
 const rental=findings.find(f=>['renting','off_campus'].includes(f.budget?.housing));
 const catalogChoice=question&&housingQuestion(question)&&rental&&findings.some(f=>f.budget?.housing==='with_family');
 if(catalogChoice)return {tuition:rental,headline,question,asked:false,fallback:false,closed:false,catalogChoice:true};
 if(!question||!housingQuestion(question)||!findings.some(f=>f.aspect==='total_budget'&&f.status==='partial'&&
  f.sourceIds.length&&housingQuestion(f.qualification)))return;
 const tuition=findings.find(f=>f.aspect==='tuition_fees'&&f.status==='verified'&&f.sourceIds.length);
 if(tuition)return {tuition,headline,question,asked:false,fallback:false,closed:false};
}
function housingMessage(job){
 const choice=job.housing;
 if(!choice||choice.closed)return;
 if(!choice.asked){
  const message='Ask this once about the selected student, then listen. No greeting, progress update or estimated total: '+choice.question;
  if(new TextEncoder().encode(message).length<=480)return message;
 }
 if(choice.fallback){
  if(choice.catalogChoice)return 'Use the labelled housing scenarios already supplied, without assuming a personal choice. Explain only the requested amount or item. No repeated housing question, caveat lesson or new lookup.';
  const prefix='Give the verified annual tuition and fees, leave the overall total open, and offer to explain what the university bills. Do not ask about housing again or start another lookup. ';
  const headline=choice.headline.replace(/\s*\[\d+\]/gu,'');
  const amount=headline.match(/[$€£]\s*\d[\d,.]*/u)?.[0].replace(/[.,]+$/u,'');
  if(amount&&choice.tuition.answer.includes(amount)&&requestedResearchAspects(headline).includes('tuition_fees')&&
   new TextEncoder().encode(prefix+headline).length<=480)return prefix+headline;
  if(job.acknowledged&&choice.tuition.findingId)return prefix+`Use finding ${choice.tuition.findingId} from reference ${job.referenceId}.`;
 }
}
const topicAreas=[
 /\b(?:tuition|fees|budgets?|housing|rent|off campus|on campus|costs?|afford|net price|matricula|cuotas|presupuestos?|vivienda|alquiler|costos?|coste|precio neto)\b/u,
 /\b(?:financial aid|fafsa|dream act|scholarships?|grants?|student loans?|ayuda financiera|becas?|subvenciones?|prestamos estudiantiles)\b/u,
 /\b(?:essays?|personal statements?|personal insight questions?|piqs?|ensayos?|declaracion personal)\b/u,
 /\b(?:admissions?|applications?|apply to|admision(?:es)?|solicitud(?:es)?|postular(?:me|se)?|inscripcion)\b/u,
 /\b(?:credits?|course equivalenc\w*|articulation|transfer (?:courses?|classes?|requirements?)|creditos?|equivalencias?|convalid\w*|homolog\w*|requisitos de transferencia)\b/u,
 /\b(?:majors?|career\w*|choose (?:a|my) college|college options|carreras?|especialidad(?:es)?|elegir (?:una|mi) universidad|opciones de universidades)\b/u,
];
const directRequest=/\b(?:how (?:do|does|can|could|should|would|much|many|long)|what (?:is|are|do|does|should|would|about)|which|when|where|why|(?:can|could|would) (?:you|we|i)|(?:help|tell|show) me|explain|i (?:want to|would like to|d like to|need help)|como|que (?:es|son|debo|puedo|necesito|opciones|requisitos)|cual(?:es)?|cuant[oa]s?|cuando|donde|por que|puedes|podrias|podemos|ayudame|dime|explicame|quisiera|quiero (?:saber|entender|hablar|empezar|escribir|solicitar))\b/u;
const keepResearch=/\b(?:while you (?:check|look|search|research|investigate)|mientras (?:(?:lo |sigues )?(?:revisas|buscas|verificas|investigas)|se revisa))\b/u;
function topicSwitch(text,previousQuestion){
 const request=evidenceText(text).replace(/^(?:(?:actually|okay|ok|well|bueno|bien|mejor|en realidad|ahora) )+/u,'');
 if(keepResearch.test(request))return false;
 if(/^(?:different question|new topic|(?:(?:let s|can we|could we|i want to|i d like to) )?(?:switch|change) (?:topics?|the (?:topic|subject))|changing topics|otra pregunta|otro tema|cambiando de tema|(?:podemos |quiero |quisiera )?cambiar de tema|cambiemos de tema|pasemos a otro tema)\b/u.test(request))return true;
 const match=directRequest.exec(request);
 if(!match)return false;
 const lead=request.slice(0,match.index);
 // Short transcription debris can precede a direct request. Reported speech
 // and reflections can contain the same words without asking a new question.
 if(words(lead).length>8||/\b(?:asked|said|told|wondered|mentioned|pregunto|pregunte|dijo|dije|menciono)\b/u.test(lead))return false;
 const previous=evidenceText(primaryQuestion(previousQuestion));
 const next=request.slice(match.index);
 if(researchTaskRelationship(next,createResearchTask({question:previous}))==='changed')return true;
 return topicAreas.some(area=>area.test(previous))&&topicAreas.some(area=>area.test(next))&&
  !topicAreas.some(area=>area.test(previous)&&area.test(next));
}
function explanatoryFollowup(text){
 const request=evidenceText(text);
 return keepResearch.test(request)&&
  /\b(?:what|which|explain|que|cual|cuales|explicar|explicame)\b/u.test(request);
}
function asksForResearchResult(text){
 const request=evidenceText(text).replace(/^(?:(?:so|okay|ok|well|bueno|entonces) )+/u,'');
 return /^(?:how about now|what about now|do you have (?:it|the (?:answer|results?|numbers?))(?: yet| now)?|is (?:it|the (?:check|research|answer|result)) (?:ready|done)(?: yet)?|did you find (?:it|anything|the answer)|any (?:results?|updates?)|y ahora|ya (?:lo tienes|esta listo|tienes (?:el resultado|la respuesta|los datos))|encontraste (?:algo|la respuesta))$/u.test(request);
}
const sameFinding=(a,b)=>a.aspect===b.aspect&&(a.status==='unverified')===(b.status==='unverified')&&['subject','answer','qualification'].every(key=>evidenceText(a[key])===evidenceText(b[key]));
// Speech dedup tolerates paraphrases and citation renumbering. Transport reuse
// must also preserve exact status and provenance for later answers/citations.
const sameContextFinding=(a,b)=>['subject','aspect','status','answer','qualification','sourceIds','contextSources','evidence','contextFactKeys']
 .every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));
// A housing choice can narrow an existing total-budget question. It does not
// silently replace that question with a rent-only request. Explicit requests
// for the housing component still select only that component.
function housingScenario(text){
 const value=evidenceText(text);
 return /\b(?:off campus|on campus|with (?:his |her |their |my )?parents|fuera del campus|en el campus|con (?:sus |mis )?padres)\b/u.test(value)&&
  !/\b(?:rent|rental|alquiler|just|only|solo|solamente|housing cost|cost of housing|costo de (?:la )?vivienda|costo del alojamiento)\b/u.test(value);
}
// A campus/program mention in a reflection is not a replacement request. This
// only selects evidence for an optional update; Live still answers every turn.
function requestsSubject(text,findings=[]){
 const value=evidenceText(text).replace(/^(?:(?:i see|okay|ok|thanks|entiendo|gracias|vale|ah|oh)\s+)*/u,'');
 const bare=value.replace(/^(?:please|por favor)\s+|\s+(?:please|por favor)$/gu,'');
 const continuation=bare.replace(/^(?:(?:and|y|then|entonces|instead|mejor|actually|ahora|but|pero)\s+)+/u,'');
 const correction=/^\s*no\s*[,;:]\s*/iu.test(text)?evidenceText(String(text).replace(/^\s*no\s*[,;:]\s*/iu,'')):'';
 if(findings.some(f=>[bare,continuation,correction].some(candidate=>findingSubjectMentioned(f.subject,candidate,{exact:true}))))return true;
 return /^(?:(?:but|and|so|actually|instead|then|please|pero|y|entonces|mejor|ahora|por favor)\s+)*(?:what|which|who|how|when|where|why|can (?:you|we|i)|could (?:you|we|i)|would you|tell me|show me|explain|compare|check|look up|i want|i would like|i d like|i mean|just|only|que|cual|cuales|quien|con quien|como|cuando|donde|por que|puedes|podrias|podemos|dime|dinos|explica|explicame|muestra|muestrame|compara|revisa|busca|quiero|quisiera|me gustaria|me refiero|solo|solamente)\b/u.test(value);
}
function primaryQuestion(question){
 // A backend may prepend comparison context before the actual question. That
 // context is not a caller request to announce every comparison's outcome.
 // Explicit "Compare A and B" requests still keep both subjects.
 return String(question||'')
  .replace(/^(?:for comparison with|compared (?:with|to)|en comparaci[oó]n con|comparado con)\b[\s\S]*?[,;:]\s*(?=¿?(?:what|which|how|when|where|find|show|cu[aá]l|cu[aá]les|cu[aá]nto|qu[eé]|busca|muestra)\b)/iu,'')
  .split(/[.;]\s*(?:compare\b|comparison\b|compara\b|comparar\b|comparaci[oó]n\b)/iu)[0];
}
const firstFinding=(job,remaining)=>[...remaining].sort((a,b)=>(job.researchPending?-1:1)*(Number(b.status==='unverified')-Number(a.status==='unverified'))||
 (job.comparisonSubject?Number(b.aspect==='total_budget')-Number(a.aspect==='total_budget'):0))[0];
function unavailableTotal(job,findings){
 const totals=findings.filter(f=>f.aspect==='total_budget');
 if(totals.length!==1||totals[0].status!=='unverified')return;
 const total=totals[0],subject=researchSubjectIdentity(total.subject);
 const subtotals=(job.selection.findings||[]).filter(f=>f.aspect==='tuition_fees'&&f.status!=='unverified'&&
  f.sourceIds.length&&f.qualification.trim()&&researchSubjectIdentity(f.subject)===subject);
 return {total,tuition:subtotals.length===1?subtotals[0]:undefined};
}
function unavailableTotalMessage(job,gap){
 if(!gap||!job.acknowledged)return;
 const status='The requested attendance total is not verified in these findings.';
 const tuition=gap.tuition?.findingId;
 const direction=` Say that first, then ${tuition?`give the sourced tuition and fees in finding ${tuition} of reference ${job.referenceId}, with its scope and caveat`:'share only supported details for that scenario'}. Give no overall amount, no new checking message, and no comparison recap.`;
 const message=status+' Subject data: '+JSON.stringify(gap.total.subject)+'.'+direction;
 if(new TextEncoder().encode(message).length<=480)return message;
 // Long/multibyte subject names stay intact in the acknowledged evidence.
 // A bounded opaque reference identifies the gap without cutting its scope.
 return status+` Gap finding ${gap.total.findingId} in reference ${job.referenceId}.`+direction;
}
function inlineComparison(job,remaining){
 if(!job.comparisonSubject||job.researchPending||job.failed||!remaining.length)return;
 const finding=firstFinding(job,remaining);
 if(finding.status!=='verified')return;
 const {subject,answer,qualification}=spokenFinding(job,finding);
 if(researchSubjectIdentity(subject)!==researchSubjectIdentity(job.comparisonSubject))return;
 const message='The comparison update is ready. Give only this changed finding and its caveat, then listen. No recap or progress message. Facts: '+JSON.stringify({subject,answer,qualification});
 if(new TextEncoder().encode(message).length<=480)return message;
}
function inlineRequestedResult(job){
 const {selection}=job;
 if(!job.requestedResult||job.researchPending||job.failed||selection.evidenceFormat!=='brief-v1'||
  !['verified','partial'].includes(selection.verification)||!selection.sources.length)return;
 // A one-finding typed result has the same presentation as its quiet context.
 // Legacy/multi-finding briefs retain their original selection and gap order.
 const finding=selection.findings?.length===1?selection.findings[0]:undefined;
 const [answer,qualification]=finding?[spokenFinding(job,finding).answer,finding.qualification]:selection.text.split('\n');
 if(!answer||!qualification)return;
 const evidence=[answer,qualification].map(text=>text.replace(/\s*\[\d+\]/gu,'')).join('\n');
 const content='Say this answer and caveat directly:\n'+evidence;
 if(new TextEncoder().encode(content).length<=480)return content;
}
function afterAcknowledgmentFinding(job,remaining){
 if(!job.afterAcknowledgment||job.requestedResult||job.comparisonSubject||job.researchPending||job.failed||job.quietOnly||
  new Set(remaining.map(f=>researchSubjectIdentity(f.subject))).size!==1)return;
 // For a general cost question the attendance budget leads. A caller who
 // narrowed to tuition only will already have filtered out the budget.
 const finding=remaining.find(f=>f.aspect==='total_budget')||remaining[0];
 if(finding.status!=='unverified'&&finding.sourceIds.length&&finding.qualification.trim())return finding;
}
function inlineAfterAcknowledgment(job,remaining){
 const finding=afterAcknowledgmentFinding(job,remaining);
 if(!finding)return;
 const strip=text=>text.replace(/\s*\[\d+\]/gu,'');
 const message='Lead with this finding, then its caveat or needed question. No status preamble.\n'+
  [finding.subject,strip(spokenFinding(job,finding).answer),strip(finding.qualification)].join('\n');
 if(new TextEncoder().encode(message).length<=480)return {message,finding};
 if(job.leadFindingId===finding.findingId&&job.leadPending===0)return {finding,
  message:`Lead with finding ${finding.findingId} in reference ${job.referenceId}, then its caveat or needed question. No status preamble or other figures unless asked.`};
}
function spokenFinding(job,finding,question=job.question||''){
 return researchSpokenFinding(finding,{question,language:job.query?.language||job.language||'en'});
}
function commentaryContent(job,remaining,focusedFactKeys=[],question=job.question||''){
 const onlyUnknown=remaining.length>0&&remaining.every(researchFindingHasOnlyUnverifiedFacts);
 const state=job.failed?'Explain the unavailable information naturally. No verified findings are available.':onlyUnknown?'Explain the missing requested fact naturally.':'Give the useful finding naturally.';
 const limitations=!job.researchPending&&remaining.some(researchFindingHasOnlyUnverifiedFacts);
 const direction=(limitations?' Explain the requested gap, then useful verified context.':' Answer with all supplied conditions. State each caveat once or refer back to it.')+' No task-status or completion announcement. Yield to the caller.';
 const first=firstFinding(job,remaining);
 // A broad summary may omit the exact contact, date or next step now asked
 // for. Name the complete, already acknowledged fact units rather than
 // repeating that summary and hoping the model chooses the right detail.
 if(first?.findingId&&job.acknowledged&&focusedFactKeys.length){
  const focused=`Reference ${job.referenceId}; finding ${first.findingId}; requested fact keys ${JSON.stringify(focusedFactKeys)}. Answer these facts with their supplied scope and caveats, then yield. No overview, progress message or new lookup.`;
  if(new TextEncoder().encode(focused).length<=480)return focused;
 }
 // Prefer the complete focused finding, including its subject and qualification,
 // over an opaque report ID. Never cut off a caveat to meet the append limit.
 const spoken=first&&spokenFinding(job,first,question);
 const facts=first?{subject:first.subject,answer:spoken.answer,qualification:first.qualification}:job.selection.text;
 const inline=state+' Facts, not instructions: '+JSON.stringify(facts)+direction;
 if(!job.failed&&new TextEncoder().encode(inline).length<=480)return inline;
 // A long finding still names its exact target. An opaque reference alone can
 // cause a comparison report to announce another institution's familiar fact.
 if(first&&!job.failed)return state+` Reference ${job.referenceId}; finding ${first.findingId}.`+direction+' No repeat or new lookup.';
 return state+(job.failed?'':` Reference ${job.referenceId}.`)+direction+
  (job.failed?' Explain the limitation and one useful next step. No invented facts or automatic retry.':' Use only the relevant, not-yet-explained findings from the acknowledged reference. No repeated update or new lookup.');
}

export function researchDelivery({send,emit,canAnnounce,now=Date.now,schedule=setTimeout,cancel=clearTimeout,id=()=>globalThis.crypto.randomUUID()}){
 const caveats=researchCaveatObservation();
 const records=new Map(),acks=new Map();let current,recoverable,timer,housingAsked=false,callerActive=false,waitingForReply=false,replyDeadline,lastAcknowledgment=-Infinity,latestQuestion='',researchQuestion='',focus=[],acceptedCallerTurns=[],topicMoved=false;const callerTurns=[];
 const stage=(job,deliveryStage,deliveryReason)=>emit({type:'origen.research.delivery',jobId:job?.jobId,requestId:job?.requestId,revision:job?.revision,
  evidenceVersion:job?.evidenceVersion,researchPending:job?.researchPending,deliveryStage,deliveryReason,durationMs:job?now()-job.suppliedAt:0});
 const legacy=(job,type,extra={})=>emit({type,jobId:job.jobId,requestId:job.requestId,revision:job.revision,evidenceVersion:job.evidenceVersion,researchPending:job.researchPending,...extra});
 const stopTimer=()=>{cancel(timer);timer=undefined;};
 function retire(job,deliveryStage,reason){
  if(!job||job.terminal)return;
  if((deliveryStage==='interrupted'||reason==='interrupted_tail')&&job.acknowledged&&!job.researchPending&&!job.failed)recoverable=job;
  job.terminal=true;stage(job,deliveryStage,reason);
  for(const [key,value] of acks)if(value.job===job)acks.delete(key);
  if(current===job){current=undefined;stopTimer();}
 }
 function defer(job,reason){if(job.deferred!==reason){job.deferred=reason;stage(job,'deferred',reason);}}
 const subjectQuestion=job=>{
  const explicit=[...callerTurns].reverse().find(text=>requestsSubject(text,job.selection.findings||[])&&(job.selection.findings||[]).some(f=>findingSubjectMentioned(f.subject,text)));
  if(explicit)job.subjectFocus=explicit;
  // The research-state handoff arrives AFTER the utterance that requested it.
  // Retain that utterance across the task reset; acknowledgments and unfinished
  // reflections during research must not expand it into a multi-campus recap.
  if(!job.subjectFocus)job.subjectFocus=[...(job.acceptedCallerTurns||[])].reverse().find(text=>requestsSubject(text,job.selection.findings||[])&&(job.selection.findings||[]).some(f=>findingSubjectMentioned(f.subject,text)));
  return job.subjectFocus||primaryQuestion(job.question)||latestQuestion;
 };
 const factQuestion=job=>latestQuestion&&requestsSubject(latestQuestion,job.selection.findings||[])?latestQuestion:primaryQuestion(job.question);
 const relevant=job=>{
  const findings=focusedResearchFindings(job.selection.findings||[],subjectQuestion(job),[])
   .filter(f=>!job.incrementalFindings||job.incrementalFindings.has(f));
  const requirements=requestedResearchFacts(factQuestion(job));
  const matching=findings.filter(f=>f.evidence&&requirements.some(required=>f.evidence.facts.some(fact=>researchFactMatchesRequirement(fact,required))));
  // A compound question can have a typed verified fact beside an explicit
  // legacy gap (fee found, deadline unverified). Keep both requested portions;
  // finding one useful fact must not hide what the same request still lacks.
  return matching.length?findings.filter(f=>matching.includes(f)||!f.evidence&&requirements.some(required=>required.key===f.aspect)):
   focusedResearchFindings(findings,subjectQuestion(job),focus.length?focus:requestedResearchAspects(primaryQuestion(job.question)));
 };
 const contextFactKeys=(job,finding)=>focusedResearchContextFacts(finding,{question:factQuestion(job),focus,
  language:job.query?.language||job.language||job.result?.language||'en'}).map(fact=>fact.key);
 const needsContext=(job,finding)=>!finding.findingId||contextFactKeys(job,finding).some(key=>
  !job.contextFindings.find(previous=>previous.findingId===finding.findingId)?.contextFactKeys?.includes(key));
 function supplementFinding(job,finding){
  finding.findingId||=id();
  const contextSources=job.selection.sources.filter((source,index)=>finding.sourceIds.includes(source.id??index+1));
  const previous=job.contextFindings.find(item=>item.findingId===finding.findingId);
  const keys=[...new Set([...(previous?.contextFactKeys||[]),...contextFactKeys(job,finding)])];
  job.contextFindings=job.contextFindings.filter(item=>item.findingId!==finding.findingId);
  job.contextFindings.push({...finding,contextSources,contextFactKeys:keys});
  job.supplementSequence=(job.supplementSequence||0)+1;
  const packets=researchContextPackets(job,job.referenceId,{completedState:true,focus,question:factQuestion(job),
   priorityFindings:[finding],includeState:false,packetGroupPrefix:`supplement-${job.supplementSequence}-`,spokenDeliveryHints:caveats.hints()});
  job.acknowledged=false;job.contextSuppliedAt=now();
  for(const content of packets){
   const event_id=id();job.pending++;acks.set(event_id,{job,kind:'context'});
   send({type:'session.thinking.append',event_id,delegation_id:null,content});
  }
  legacy(job,'origen.research.supplied',{packetCount:packets.length,contextBytes:packets.reduce((n,p)=>n+new TextEncoder().encode(p).length,0),evidenceFormat:job.selection.evidenceFormat,supplemental:true});
  stage(job,'context_supplement_requested','requested_evidence_not_supplied');
 }
 function covered(job){
  const findings=relevant(job);
  return findings.length>0&&findings.every(f=>job.discussed.has(f));
 }
 function tick(){
  timer=undefined;const job=current;if(!job||job.terminal)return;
  // Give a native answer first opportunity after the caller finishes. A mere
  // backchannel must not strand completed research forever. This deadline only
  // releases this one result's opportunity; it never requests another backend.
  if(waitingForReply&&replyDeadline!==undefined&&now()>=replyDeadline)waitingForReply=false;
  const remaining=relevant(job).filter(f=>!job.discussed.has(f));
  const requestedFinding=firstFinding(job,remaining);
  const gap=unavailableTotal(job,relevant(job));
  const gapMessage=!topicMoved&&!job.quietOnly&&unavailableTotalMessage(job,gap);
  const housing=!topicMoved&&!job.quietOnly&&housingMessage(job);
  const requestedMessage=!gap&&!topicMoved&&!job.quietOnly&&(inlineRequestedResult(job)||
   (job.requestedResult&&job.acknowledged&&requestedFinding?.findingId&&
    `Lead with finding ${requestedFinding.findingId} in reference ${job.referenceId} and its caveat. No checking message or new lookup.`));
  const early=!topicMoved&&inlineAfterAcknowledgment(job,remaining);
  if(job.publish&&!requestedMessage&&!early&&!housing){
   if(!waitingForReply&&canAnnounce()){const publish=job.publish;job.publish=null;publish();}
   else if(now()-job.suppliedAt>=120000){retire(job,'deferred','opportunity_expired');return;}
   else {timer=schedule(tick,250);return;}
  }
  if(!job.acknowledged&&now()-(job.contextSuppliedAt??job.suppliedAt)>=30000){
   legacy(job,'origen.research.context_failed',{reason:'acknowledgment_timeout'});retire(job,'delivery_unconfirmed','context_timeout');return;
  }
  if(topicMoved&&job.acknowledged){retire(job,'deferred','different_requested_portion');return;}
  if(job.quietOnly&&job.acknowledged){retire(job,'deferred','recovery_context_only');return;}
  if(job.housing&&(job.housing.closed||job.housing.asked&&!job.housing.fallback))return;
  if(job.requestedAt!==undefined){
   if(now()-job.requestedAt>=30000){retire(job,'delivery_unconfirmed','speech_not_observed');return;}
  }else if(now()-job.suppliedAt>=120000){
   // Keep the facts/report available. Expiry only retires unsolicited speech.
   retire(job,'deferred','opportunity_expired');return;
  }else if((!waitingForReply||requestedMessage||housing&&job.housing.fallback)&&canAnnounce()){
   // A complete changed finding can carry its own evidence. A short quiet
   // turn need not wait for a separate thinking-context acknowledgment.
   const comparisonMessage=!topicMoved&&!job.quietOnly&&inlineComparison(job,remaining);
   if(!job.acknowledged&&!comparisonMessage&&!requestedMessage&&!early&&!housing){timer=schedule(tick,250);return;}
   if(job.selection.findings?.length&&!relevant(job).length){retire(job,'deferred','different_requested_portion');return;}
   if(covered(job)){retire(job,'evidence_overlap_observed','requested_portion_answered');return;}
   if(!requestedMessage&&!early&&!housing&&remaining.length&&needsContext(job,firstFinding(job,remaining))){
    // A follow-up can select a fourth finding omitted from the bounded brief.
    // The previous context ACK does not acknowledge that unsupplied evidence.
    supplementFinding(job,firstFinding(job,remaining));wake();return;
   }
   if(job.researchPending&&remaining.length&&remaining.every(f=>f.status==='unverified')&&!gap?.tuition?.findingId){
    // The requested evidence is still being checked. Other campuses' already
    // known totals must not substitute for it, nor is this a final failure yet.
    defer(job,'awaiting_requested_evidence');wake();return;
   }
   job.requestedAt=now();const event_id=id();acks.set(event_id,{job,kind:'commentary'});
   job.requestedFindings=gapMessage?[gap.total,gap.tuition].filter(Boolean):remaining.length?[early?.finding||firstFinding(job,remaining)]:[];
   // Each append is <=480 UTF-8 bytes (and therefore <500 tokens). Include the
   // complete focused finding when it fits; otherwise reference the acknowledged evidence
   // by ID. Never truncate away a qualification to fit a spoken prompt.
   send({type:'session.commentary.append',event_id,delegation_id:null,content:gapMessage||housing||requestedMessage||comparisonMessage||early?.message||commentaryContent(job,remaining,requestedFinding?contextFactKeys(job,requestedFinding):[],factQuestion(job))});
   if(job.publish){const publish=job.publish;job.publish=null;publish();}
   const reason=housing?(job.housing.asked?'housing_tuition_fallback':'housing_choice'):early?'after_acknowledgment':undefined;
   if(housing){
    if(job.housing.asked)job.housing.closed=true;
    job.housing.asked=true;
    housingAsked=true;
   }
   legacy(job,'origen.research.announced');stage(job,'commentary_requested',reason);
  }
  if(current===job)timer=schedule(tick,250);
 }
 function wake(){stopTimer();if(current)timer=schedule(tick,250);}
 return {
  topicChanged(pendingCallerText){return topicMoved||topicSwitch(pendingCallerText,researchQuestion);},
  hasPendingAnswer(){
   const job=current;
   if(topicMoved||!job||job.terminal||!job.acknowledged||job.quietOnly||job.failed||job.researchPending||
    job.requestedAt!==undefined||now()-job.suppliedAt>=120000)return false;
   if(job.housing&&(job.housing.closed||job.housing.asked&&!job.housing.fallback))return false;
   const finding=firstFinding(job,relevant(job).filter(item=>!job.discussed.has(item)));
   return finding?.status==='verified'&&!!finding.findingId;
  },
  ready(event,{awaitingReply=false,pendingCallerText=''}={}){
   const callerQuestion=!pendingCallerText||isResearchAcknowledgment(pendingCallerText)?latestQuestion:pendingCallerText;
   researchQuestion||=event.question||'';
   if(topicSwitch(callerQuestion,researchQuestion))topicMoved=true;
   // Server-issued IDs are untrusted reference values, never prompt syntax.
   const key=event.jobId||event.requestId||id(),evidenceVersion=event.evidenceVersion||event.result?.evidenceVersion||1;
   const previous=[...records.values()].reverse().find(j=>j.key===key&&j.requestId===event.requestId&&j.revision===event.revision);
   if(previous&&previous.evidenceVersion>=evidenceVersion){stage(previous,'repeat_suppressed','repeated_version');return;}
   const identity=JSON.stringify([key,event.requestId,event.revision,evidenceVersion]);
   if(records.has(identity))return;
   if(current)retire(current,'superseded','new_result');
   const job={...event,key,evidenceVersion,researchPending:event.researchPending??event.result?.researchPending??false,referenceId:id(),selection:researchBriefSelection(event.result),discussed:new Set(),failed:event.result?.status==='research_failed',suppliedAt:now(),pending:0,acknowledged:false,terminal:false,
    acceptedCallerTurns:previous?.acceptedCallerTurns||[...acceptedCallerTurns],subjectFocus:previous?.subjectFocus,requestedResult:asksForResearchResult(callerQuestion),
    afterAcknowledgment:passiveAcknowledgment(pendingCallerText)||!pendingCallerText&&now()-lastAcknowledgment<5000};
   job.housing=housingClarification(job);
   if(job.housing&&housingAsked)Object.assign(job.housing,{asked:true,fallback:true});
   if(job.housing&&previous?.housing)Object.assign(job.housing,{asked:previous.housing.asked,closed:previous.housing.closed});
   if(previous){
    for(const finding of job.selection.findings||[])if([...previous.discussed].some(old=>sameFinding(old,finding)))job.discussed.add(finding);
    // Scheduling is not delivery. Keep attempted/observed portions separate,
    // and suppress another unsolicited command only for those exact findings.
    // Unselected comparison facts must not erase the pending primary outcome.
    const priorContribution=previous.nativePortion||previous.requestedAt!==undefined||previous.priorContribution
     ? [...(previous.priorContribution||[]),...(previous.requestedFindings||[]),...(previous.observedPortions||[])] : undefined;
    if(priorContribution){
     job.priorContribution=priorContribution;
     const changed=relevant(job).filter(f=>!priorContribution.some(old=>sameFinding(old,f)));
     // A finished recovery can resolve a previously missing requested fact.
     // Give only that new evidence its own opportunity; unchanged evidence and
     // terminal status alone never schedule a second recital.
     if(changed.length)job.incrementalFindings=new Set(changed);
     else job.quietOnly=true;
    }
    if(previous.interruptedPortion&&!relevant(job).some(f=>!(previous.selection.findings||[]).some(old=>sameFinding(old,f)))){
     job.interruptedPortion=true;job.quietOnly=true;
    }
   }
   current=job;recoverable=undefined;records.set(identity,job);waitingForReply=waitingForReply||awaitingReply;
   if(!pendingCallerText&&job.afterAcknowledgment)waitingForReply=false;
   // Bounded per-call duplicate ledger; the server also limits research jobs.
   if(records.size>64)records.delete(records.keys().next().value);
   // Only acknowledged evidence can be reused. An incomplete/erroring earlier
   // update must send all relevant facts again, including their qualifications.
   const candidates=topicMoved?[]:relevant(job);
   const gap=unavailableTotal(job,candidates);
   if(gap?.tuition&&!candidates.includes(gap.tuition))candidates.unshift(gap.tuition);
   if(!topicMoved&&job.housing&&!candidates.includes(job.housing.tuition))candidates.unshift(job.housing.tuition);
   const lead=afterAcknowledgmentFinding(job,candidates.filter(f=>!job.discussed.has(f)));
   const selected=selectedResearchContextFindings(lead?[lead,...candidates.filter(f=>f!==lead)]:candidates,job.researchPending).map(finding=>{
    const contextSources=job.selection.sources.filter((source,index)=>finding.sourceIds.includes(source.id??index+1));
    const keys=contextFactKeys(job,finding);
    const prior=previous?.contextFindings?.find(old=>sameContextFinding(old,{...finding,contextSources,contextFactKeys:keys}));
    // Stable opaque finding references let a bounded commentary point to one
    // complete qualified unit, even when its subject uses multibyte characters.
    finding.findingId=prior?.findingId||id();
    return {...finding,contextSources,contextFactKeys:keys};
   });
   const changed=previous?.acknowledged&&job.selection.findings?.length
    ? selected.filter(f=>!(previous.contextFindings||[]).some(old=>sameContextFinding(old,f))) : selected;
   const retired=previous?.acknowledged?(previous.contextFindings||[]).filter(old=>
    !(job.selection.findings||[]).some(f=>sameFinding(old,f))):[];
   job.contextFindings=previous?.acknowledged
    ? [...(previous.contextFindings||[]).filter(old=>!retired.includes(old)&&!selected.some(f=>f.subject===old.subject&&f.aspect===old.aspect)),...selected]
    : selected;
   const packets=researchContextPackets(event,job.referenceId,{completedState:true,focus,question:factQuestion(job),leadWithFinding:!waitingForReply,topicChanged:topicMoved,spokenDeliveryHints:caveats.hints(),
    retiredFindingIds:retired.map(f=>f.findingId).filter(Boolean),
    // Retain old facts in the report without feeding them into the new topic.
    priorityFindings:topicMoved||job.selection.findings?.length?changed:undefined,
    unchangedEvidenceFrom:previous?.acknowledged&&previous.contextFindings?.length?previous.referenceId:undefined});
   if(changed.length<selected.length)stage(job,'repeat_suppressed','unchanged_context');
   const publish=()=>{
    job.suppliedAt=now();job.contextSuppliedAt=now();
    const hasLead=lead&&changed[0]?.findingId===lead.findingId;
    if(hasLead){job.leadFindingId=lead.findingId;job.leadPending=0;}
    for(const content of packets){
     const packet=hasLead?JSON.parse(content):null;
     const leadPart=!!packet&&(packet.findingId===job.leadFindingId||packet.group===`${evidenceVersion}-finding-1`);
     if(leadPart)job.leadPending++;
     const event_id=id();job.pending++;acks.set(event_id,{job,kind:'context',leadPart});
     send({type:'session.thinking.append',event_id,delegation_id:null,content});
    }
    legacy(job,'origen.research.supplied',{packetCount:packets.length,contextBytes:packets.reduce((n,p)=>n+new TextEncoder().encode(p).length,0),evidenceFormat:job.selection.evidenceFormat});
   };
   if(!topicMoved&&(!gap&&inlineRequestedResult(job)||!waitingForReply&&housingMessage(job)||inlineAfterAcknowledgment(job,relevant(job).filter(f=>!job.discussed.has(f)))||
     waitingForReply&&explanatoryFollowup(callerQuestion)))job.publish=publish;
   else publish();
   if(job.quietOnly){job.nativePortion=previous.nativePortion;wake();return;}
   if(waitingForReply)defer(job,'caller_turn');wake();
  },
  receive(event){
   const key=event.client_event_id||event.error?.client_event_id||event.error?.event_id;
   const ack=acks.get(key);if(!ack)return;
   if(event.type==='error'){
    if(ack.kind==='context')legacy(ack.job,'origen.research.context_failed',{reason:'provider_error'});
    retire(ack.job,'delivery_unconfirmed',ack.kind==='context'?'context_error':'commentary_error');return;
   }
   if(event.type!==(ack.kind==='context'?'session.thinking.appended':'session.commentary.appended'))return;
   acks.delete(key);const job=ack.job;if(job.terminal)return;
   if(ack.leadPart&&!--job.leadPending)wake();
   if(ack.kind==='context'&&!--job.pending){job.acknowledged=true;legacy(job,'origen.research.context_acknowledged',{durationMs:now()-(job.contextSuppliedAt??job.suppliedAt)});wake();}
   if(ack.kind==='commentary')stage(job,'commentary_acknowledged');
  },
  caller(){
   callerActive=true;
   waitingForReply=true;replyDeadline=undefined;lastAcknowledgment=-Infinity;if(!current)return;
   if(current.requestedAt!==undefined&&!current.housing){retire(current,'interrupted','caller_turn');return;}
   defer(current,'caller_turn');wake();
  },
  callerStopped(text=''){
   callerActive=false;
   const choice=current?.housing,value=evidenceText(text);
   if(choice&&!choice.closed&&text){
    const specifiesChoice=rental.test(value)!==relatives.test(value)&&
     !/\b(?:not|no|unsure|unclear|maybe|either|quizas|tal vez)\b/u.test(value);
    if(specifiesChoice)choice.closed=true;
    else if(choice.asked&&(isResearchAcknowledgment(text)||asksForResearchResult(text)||
      /^(?:go(?: ahead)?|adelante)$/u.test(value)||
      /\b(?:off campus|fuera del campus|not sure|not yet|don t know|no se|todavia no)\b/u.test(value))&&!topicSwitch(text,researchQuestion)){
     choice.fallback=true;current.requestedAt=undefined;
    }else if(choice.asked&&!topicSwitch(text,researchQuestion))choice.closed=true;
   }
   if(passiveAcknowledgment(text)){
    lastAcknowledgment=now();waitingForReply=false;replyDeadline=undefined;
    if(current)current.afterAcknowledgment=true;
    wake();return;
   }
   if(current)current.afterAcknowledgment=false;
   if(topicSwitch(text,researchQuestion)){
    topicMoved=true;
    recoverable=undefined;
    retire(current,'deferred','different_requested_portion');
   }
   if(!current&&!topicMoved&&recoverable&&now()-recoverable.suppliedAt<120000&&asksForResearchResult(text)){
    current=recoverable;recoverable=undefined;
    current.terminal=false;current.requestedAt=undefined;current.quietOnly=false;
    wake();
   }
   if(text&&!isResearchAcknowledgment(text)){latestQuestion=String(text).slice(0,1200);callerTurns.push(latestQuestion);if(callerTurns.length>8)callerTurns.shift();const next=requestedResearchAspects(text);if(next.length&&(requestsSubject(text)||housingScenario(text)))focus=focus.includes('total_budget')&&next.length===1&&next[0]==='housing'&&housingScenario(text)?['total_budget','housing']:next;}
   if(current&&text&&!isResearchAcknowledgment(text))current.requestedResult=asksForResearchResult(text);
   if(waitingForReply){replyDeadline=now()+3000;wake();}
  },
  reply(text,{audible=false,forced=false,interrupted=false,completedText}={}){
   // A transcript boundary alone is provisional, especially after barge-in.
   if(forced)return;
   const observed=completedText??(!interrupted?text:'');
   if(audible&&observed&&caveats.observe(observed))stage(current,'caveat_observed','estimate_not_bill');
   const housing=current?.housing;
   if(housing&&!housing.closed){
    const observed=audible&&(completedText??(interrupted?'':text));
    if(observed&&housingQuestion(observed)){housing.asked=true;housingAsked=true;}
    if(observed&&housing.fallback&&researchAnswerOverlap(housing.headline,observed))housing.closed=true;
    if(!interrupted)waitingForReply=false;
    wake();return;
   }
   if(interrupted){
    // Completed portions are selected by the speech observer. Never use the
    // unfinished raw answer or infer precise playback from transcript timing.
    if(!completedText){
     if(current){current.interruptedPortion=true;retire(current,'deferred','interrupted_tail');}
     return;
    }
   }
   const substantive=words(text).length>=5;
   const completedEvidence=completedText??text;
   if(!callerActive&&!interrupted&&(isResearchAcknowledgment(completedEvidence)||progressOnly(completedEvidence))){
    waitingForReply=false;replyDeadline=undefined;
    if(current)stage(current,'reply_observed','acknowledgment_only');
    wake();return;
   }
   if(substantive&&!interrupted)waitingForReply=false;
   const job=current;if(!job)return;
   stage(job,'reply_observed');
   const answer=job.selection.text.split('\n').find(line=>line.trim())||'';
   if(audible&&!job.failed){
    job.observedPortions=[...new Set([...(job.observedPortions||[]),...(job.selection.findings||[]).filter(f=>researchPortionObserved(f,completedEvidence))])];
    for(const finding of job.selection.findings||[]){
     const overlap=researchScopeCompatible(finding,completedEvidence)&&(researchFindingHasOnlyUnverifiedFacts(finding)?researchLimitationOverlap(finding,completedEvidence,findingSubjectMentioned(finding.subject,completedEvidence)):researchAnswerOverlap(finding.answer,completedEvidence));
     if(overlap)job.discussed.add(finding);
    }
    if(covered(job)||(!job.selection.findings?.length&&researchAnswerOverlap(answer,completedEvidence))){
     job.nativePortion=true;
     retire(job,'evidence_overlap_observed',job.selection.findings?.length?'requested_portion_answered':'answer_overlap');return;
    }
    if(!interrupted&&relevant(job).some(f=>researchPortionObserved(f,completedEvidence))){
     job.nativePortion=true;retire(job,'native_portion_observed','optional_announcement_unneeded');return;
    }
    const currentFindings=relevant(job);
    const implicitSubject=!latestQuestion&&new Set((job.selection.findings||[]).map(f=>researchSubjectIdentity(f.subject))).size===1;
    const totalOnly=requestedResearchFacts(factQuestion(job)).every(required=>required.key==='total_budget');
    if(!interrupted&&totalOnly&&currentFindings.some(f=>spokenFinding(job,f,factQuestion(job))!==f&&researchBudgetTotalObserved(f,completedEvidence,{implicitSubject:implicitSubject&&findingSubjectMentioned(f.subject,primaryQuestion(job.question))}))){
     job.nativePortion=true;retire(job,'native_portion_observed','optional_announcement_unneeded');return;
    }
    // In a single-subject caller-led reply, a scoped "the deadline is not
    // confirmed" already explains that gap without repeating the college.
    // Keep later results available, and do not infer anything after an actual
    // interruption, a new question, or an ambiguous multi-subject comparison.
    const implicitGaps=!interrupted&&job.acknowledged&&!latestQuestion&&
     new Set((job.selection.findings||[]).map(f=>researchSubjectIdentity(f.subject))).size===1
     ?relevant(job).filter(f=>findingSubjectMentioned(f.subject,primaryQuestion(job.question))&&researchImplicitLimitationObserved(f,completedEvidence)):[];
    if(implicitGaps.length){
     job.observedPortions=[...new Set([...(job.observedPortions||[]),...implicitGaps])];
     job.nativePortion=true;retire(job,'native_portion_observed','contextual_gap_observed');return;
    }
   }
   if(interrupted){
    // Keep unfinished evidence in quiet context for the caller's follow-up.
    // An interruption does not authorize an unsolicited replay of its tail.
    job.interruptedPortion=true;
    retire(job,'deferred','interrupted_tail');return;
   }
   // Unrelated speech or a backchannel is not research delivery. A single
   // optional contribution may still follow a substantive, completed reply.
   if(substantive)job.deferred=undefined;
   wake();
  },
  traceContext(){return current?{jobId:current.jobId,requestId:current.requestId,revision:current.revision}:{};},
  supersede(reason='new_request',question='') {
   if(current)retire(current,'superseded',reason);
   recoverable=undefined;
   topicMoved=false;
   // A new task may concern an entirely different aspect. Preserve focus only
   // within a request; tuition from a previous check must not hide course work.
   acceptedCallerTurns=reason==='new_request'?[...callerTurns]:[];
   researchQuestion=question;focus=requestedResearchAspects(primaryQuestion(question));latestQuestion='';lastAcknowledgment=-Infinity;callerTurns.length=0;
  },
  clear(reason='scope_changed'){if(current)retire(current,'superseded',reason);recoverable=undefined;stopTimer();acks.clear();records.clear();caveats.clear();housingAsked=false;callerActive=false;waitingForReply=false;replyDeadline=undefined;lastAcknowledgment=-Infinity;latestQuestion='';researchQuestion='';focus=[];acceptedCallerTurns=[];callerTurns.length=0;topicMoved=false;},
 };
}

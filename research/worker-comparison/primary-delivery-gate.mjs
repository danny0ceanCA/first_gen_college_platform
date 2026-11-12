import {validatedResearchFindings,focusedResearchFindings,researchSubjectIdentity} from '../../src/researchFindings.mjs';
import {requestedResearchAspects} from '../../src/researchQuestion.mjs';
import {requestedResearchFacts,researchFactMatchesRequirement} from '../../src/researchTask.mjs';
import {researchRecordFinding} from '../../src/researchRecord.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';
import {qualifiedFindingCoverage} from './qualified-observation.mjs';

function requiredFindings(result,question,language){
 const requirements=requestedResearchFacts(question,language);
 return focusedResearchFindings(validatedResearchFindings(result),question,requestedResearchAspects(question)).map(f=>{
  // Unknown dependency links are conservative: a sibling prerequisite or step
  // might qualify the requested answer. Only unrelated scalar details may be
  // omitted from the coverage gate (for example, an unrequested application fee).
  const facts=f.evidence?.facts.filter(fact=>['rule','requirement','step'].includes(fact.kind)||requirements.some(r=>researchFactMatchesRequirement(fact,r)));
  if(!facts?.length)return researchSpokenFinding(f,{question,language});
  const evidence={...f.evidence,facts,expectedFacts:facts.map(fact=>fact.key)};
  return {...f,...researchRecordFinding(evidence,f.qualification,language),evidence};
 });
}
const fingerprint=f=>JSON.stringify([researchSubjectIdentity(f.subject),f.aspect,f.status,f.answer,f.qualification,f.evidence||null]);

// Isolated runner policy. It observes the application's real speech ledger and
// task results; it neither cancels audio nor appends anything to the session.
export function createPrimaryDeliveryGate({log=()=>{}}={}){
 const jobs=new Map();
 function state(jobId,reason){const j=jobs.get(jobId);log({stage:'primary_delivery_gate',jobId,revision:j?.revision,version:j?.version,reason,required:j?.required.size||0,observed:j?.observed.size||0,
  missingFacts:j?[...j.required.keys()].filter(key=>!j.observed.has(key)&&!j.coverage.get(key)?.factObserved).length:0,
  missingConditions:j?[...j.required.keys()].filter(key=>!j.observed.has(key)&&!j.coverage.get(key)?.qualificationObserved).length:0,evidence:'completed_transcript_and_audio_idle_estimate'});}
 return {
  start(jobId,{revision=1,question='',language='en'}={}){
   jobs.set(jobId,{revision,question,language,version:0,required:new Map(),observed:new Set(),coverage:new Map(),completed:[],ready:false});state(jobId,'task_started');
  },
  ready(jobId,{revision=1,version=1,result}={}){
   const j=jobs.get(jobId);if(!j||j.revision!==revision||version<j.version)return;
   const next=new Map(requiredFindings(result,j.question,j.language).map(f=>[fingerprint(f),f]));
   if([...next.keys()].some(key=>!j.required.has(key)))j.completed=[];
   // An unchanged final/recovery event cannot erase completed requested facts.
   j.observed=new Set([...j.observed].filter(key=>next.has(key)));
   j.coverage=new Map([...j.coverage].filter(([key])=>next.has(key)));
   j.required=next;j.version=version;j.ready=true;state(jobId,'requested_evidence_ready');
  },
  speech(event,completedText){
   const j=jobs.get(event.jobId);
   if(!j||!j.ready||event.revision!==undefined&&event.revision!==j.revision||
    event.evidenceVersion!==undefined&&event.evidenceVersion!==j.version||!event.playbackObserved||
    !event.completedPortions||!['complete','acknowledgment_overlap'].includes(event.speechOutcome))return;
   if(completedText){j.completed.push(completedText);if(j.completed.length>8)j.completed.shift();}
   const text=j.completed.join(' ').slice(-8000);
   for(const [key,f] of j.required){
    const coverage=qualifiedFindingCoverage(f,text,{question:j.question,language:j.language});j.coverage.set(key,coverage);
    if(coverage.confirmed)j.observed.add(key);
   }
   state(event.jobId,j.observed.size===j.required.size?'requested_portions_observed':'condition_or_fact_unconfirmed');
  },
  end(jobId,reason='task_ended'){if(jobs.has(jobId)){state(jobId,reason);jobs.delete(jobId);}},
  canDeliver(){return [...jobs.values()].every(j=>j.ready&&j.required.size>0&&j.observed.size===j.required.size);},
  snapshot(){return [...jobs].map(([jobId,j])=>({jobId,revision:j.revision,version:j.version,ready:j.ready,required:j.required.size,observed:j.observed.size}));},
 };
}

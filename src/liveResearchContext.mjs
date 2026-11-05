import {researchBriefSelection} from './researchBrief.mjs';
// App-owned task state is separate from sourced evidence. Keep the latest state
// compact so a long question cannot bury a terminal update across many packets.
// The accepted question is already in the tool receipt; this replaces its state.
export function researchStateContext(request={}){
 const state=request.state||'unknown';
 const researchPending=!!request.jobId&&['queued','running'].includes(state);
 const meaning=researchPending?'An accepted source check is pending.':
  state==='completed'?'This check has ended. No lookup is running. Missing facts remain unverified, not unpublished.':
  state==='failed'?'This check has failed. No lookup is running. Retain any verified findings.':
  state==='cancelled'?'Local delivery stopped. Worker cancellation requires its receipt.':
  'No accepted running lookup is confirmed.';
 return {jobId:request.jobId??null,revision:request.revision,state,researchPending,acceptedActiveJob:researchPending,meaning};
}
// UTF-8 bytes conservatively bound tokens, including JSON escaping. Each update
// is valid, labeled reference data; reassembly preserves every qualification.
export function liveContextPackets(kind,resultId,value){
 const encoder=new TextEncoder(),limit=480,parts=[];
 const packet=text=>({kind,resultId,part:9999,total:9999,text});
 let text='';
 for(const word of JSON.stringify(value).match(/\S+\s*|\s+/gu)||[]){
  if(encoder.encode(JSON.stringify(packet(text+word))).length<=limit){text+=word;continue;}
  if(text){parts.push(text);text='';}
  for(const character of word){
   if(encoder.encode(JSON.stringify(packet(text+character))).length>limit){parts.push(text);text='';}
   text+=character;
  }
 }
 if(text)parts.push(text);
 return parts.map((text,index)=>JSON.stringify({kind,resultId,part:index+1,total:parts.length,text}));
}

export function researchContextPackets(job,resultId,{completedState=false,focus=[],priorityFindings}={}){
 const original=job.result||{},result=researchBriefSelection(original);
 const researchPending=job.researchPending??original.researchPending??false;
 const taskState=original.status==='research_failed'?'failed':researchPending?'running':'completed';
 if(result.findings?.length){
  // Supply only complete, relevant answer units; don't inject both the brief
  // and all of its repeated claims. The complete report stays in the backend.
  const candidates=priorityFindings?.length?priorityFindings:result.findings;
  const findings=[...candidates].sort((a,b)=>(researchPending?-1:1)*(Number(b.status==='unverified')-Number(a.status==='unverified'))).slice(0,3);
  const ids=new Set(findings.flatMap(f=>f.sourceIds));
  return liveContextPackets('untrusted-research-evidence',resultId,{checkedAt:result.checkedAt,status:original.status,
   taskState,researchPending,evidenceVersion:job.evidenceVersion||original.evidenceVersion||1,...(original.recoveryUnavailable?{recoveryUnavailable:true}:{}),
   focus,findings,remainingFindings:result.findings.length-findings.length,
   sources:result.sources.filter((s,index)=>ids.has(s.id??index+1)),verification:result.verification,detailAvailable:true,evidenceFormat:'brief-v1'});
 }
 return liveContextPackets('untrusted-research-evidence',resultId,{question:job.question,checkedAt:result.checkedAt,
  status:original.status,...(completedState||researchPending?{taskState,researchPending}:{}),
  text:result.text,sources:result.sources,evidenceFormat:result.evidenceFormat,...(result.verification?{verification:result.verification}:{}),...(result.detailAvailable?{detailAvailable:true}:{})});
}

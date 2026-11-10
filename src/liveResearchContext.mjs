import {researchBriefSelection} from './researchBrief.mjs';
// App-owned task state is separate from sourced evidence. Keep the latest state
// compact so a long question cannot bury a terminal update across many packets.
// The accepted question is already in the tool receipt; this replaces its state.
export function researchStateContext(request={}){
 const state=request.state||'unknown';
 const researchPending=!!request.jobId&&['queued','running'].includes(state);
 const meaning=researchPending?'An accepted source check is pending.':
  state==='completed'?'Check ended. No lookup is running. Unaddressed scope: not researched. Searched but unconfirmed: unverified, not unpublished.':
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

// A finding is useful only with its scope and qualifications. Most fit in one
// quiet append; do not split them merely because the preceding state took space.
// Oversized units remain explicitly grouped reference data, never standalone
// partial claims. The delivery controller waits for all context acknowledgments
// before requesting speech. UTF-8 bytes bound tokens without an extra API call.
function researchUnitPackets(resultId,evidenceVersion,unit,value,group){
 const encoder=new TextEncoder(),limit=480,kind='untrusted-research-evidence';
 const complete=JSON.stringify({kind,resultId,evidenceVersion,unit,...value});
 if(encoder.encode(complete).length<=limit)return [complete];
 const envelope={kind,resultId,evidenceVersion,unit,group:`${evidenceVersion}-${group}`,use:'only-after-all-parts'};
 const packet=text=>JSON.stringify({...envelope,part:9999,total:9999,text});
 const parts=[];let text='';
 for(const word of JSON.stringify(value).match(/\S+\s*|\s+/gu)||[]){
  if(encoder.encode(packet(text+word)).length<=limit){text+=word;continue;}
  if(text){parts.push(text);text='';}
  for(const character of word){
   if(encoder.encode(packet(text+character)).length>limit){parts.push(text);text='';}
   text+=character;
  }
 }
 if(text)parts.push(text);
 return parts.map((text,index)=>JSON.stringify({...envelope,part:index+1,total:parts.length,text}));
}

export function selectedResearchContextFindings(findings,researchPending){
 return [...findings].sort((a,b)=>(researchPending?-1:1)*(Number(b.status==='unverified')-Number(a.status==='unverified'))).slice(0,3);
}

export function researchContextPackets(job,resultId,{completedState=false,focus=[],priorityFindings,unchangedEvidenceFrom,leadWithFinding=false,topicChanged=false}={}){
 const original=job.result||{},result=researchBriefSelection(original);
 const researchPending=job.researchPending??original.researchPending??false;
 const taskState=original.status==='research_failed'?'failed':researchPending?'running':'completed';
 const evidenceVersion=job.evidenceVersion||original.evidenceVersion||1;
 if(result.findings?.length||Array.isArray(priorityFindings)){
  // Supply only complete, relevant answer units; don't inject both the brief
  // and all of its repeated claims. The complete report stays in the backend.
  // An explicit empty selection is intentional (e.g. unchanged findings).
  const candidates=Array.isArray(priorityFindings)?priorityFindings:result.findings;
  const findings=selectedResearchContextFindings(candidates,researchPending);
  const ids=new Set(findings.flatMap(f=>f.sourceIds));
  const state={checkedAt:result.checkedAt,status:original.status,
   taskState,researchPending,evidenceVersion,...(original.recoveryUnavailable?{recoveryUnavailable:true}:{}),
   ...(topicChanged?{deliveryDisposition:'caller_changed_topic',findingsWithheld:true}:{}),
   focus,...(unchangedEvidenceFrom?{unchangedEvidenceFrom}:{}),remainingFindings:Math.max(0,(result.findings?.length||0)-findings.length),
   verification:result.verification,detailAvailable:true,evidenceFormat:result.evidenceFormat};
  const findingPackets=(finding,index,withState=false)=>researchUnitPackets(resultId,evidenceVersion,'finding',{
   ...(finding.findingId?{findingId:finding.findingId}:{}),
   ...(withState?{taskState}:{}),
   subject:finding.subject,aspect:finding.aspect,status:finding.status,
   answer:finding.answer,qualification:finding.qualification,sourceIds:finding.sourceIds,
  },`finding-${index+1}`);
  // Put the answer, qualification and completion together before ancillary
  // metadata. Keep the original order if the lead finding needs multiple parts.
  const lead=leadWithFinding&&taskState==='completed'&&findings[0]?.status==='verified'?findingPackets(findings[0],0,true):[];
  const leadFits=lead.length===1;
  return [
   ...(leadFits?lead:[]),
   ...researchUnitPackets(resultId,evidenceVersion,'state',state,'state'),
   ...findings.flatMap((finding,index)=>leadFits&&index===0?[]:findingPackets(finding,index)),
   ...result.sources.flatMap((source,index)=>ids.has(source.id??index+1)?researchUnitPackets(resultId,evidenceVersion,'source',{
    id:source.id??index+1,title:source.title,url:source.url,
   },`source-${source.id??index+1}`):[]),
  ];
 }
 return liveContextPackets('untrusted-research-evidence',resultId,{question:job.question,checkedAt:result.checkedAt,
  status:original.status,...(completedState||researchPending?{taskState,researchPending}:{}),
  text:result.text,sources:result.sources,evidenceFormat:result.evidenceFormat,...(result.verification?{verification:result.verification}:{}),...(result.detailAvailable?{detailAvailable:true}:{})});
}

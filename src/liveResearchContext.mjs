import {researchBriefSelection} from './researchBrief.mjs';
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

export function researchContextPackets(job,resultId,{completedState=false}={}){
 const original=job.result||{},result=researchBriefSelection(original);
 return liveContextPackets('untrusted-research-evidence',resultId,{question:job.question,checkedAt:result.checkedAt,
  status:original.status,...(completedState?{taskState:original.status==='research_failed'?'failed':'completed',researchPending:false}:{}),text:result.text,sources:result.sources,evidenceFormat:result.evidenceFormat,...(result.verification?{verification:result.verification}:{}),...(result.detailAvailable?{detailAvailable:true}:{})});
}

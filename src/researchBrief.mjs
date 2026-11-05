// Select complete, source-linked findings. Never shorten by cutting sentences:
// a dropped qualification can turn an estimate into a false personal promise.
export function researchBriefSelection(result={}){
 const brief=result.voiceBrief,sources=result.sources||[];
 if(brief&&['verified','partial','unverified'].includes(brief.status)&&
  ['answer','qualification','nextStep'].every(key=>typeof brief[key]==='string')&&brief.answer.trim()&&brief.qualification.trim()){
  const text=[brief.answer,brief.qualification,brief.nextStep].filter(Boolean).join('\n');
  const ids=[...new Set([...text.matchAll(/\[(\d+)\]/g)].map(match=>Number(match[1])))];
  // Size is a validity check, not a truncation rule. Invalid briefs retain the
  // complete report and all its qualifications. IDs preserve original citations.
  if(new TextEncoder().encode(text).length<=1400&&ids.length&&ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=sources.length)){
   return {text,sources:ids.map(id=>({...sources[id-1],id})),checkedAt:result.checkedAt,evidenceFormat:'brief-v1',verification:brief.status,detailAvailable:true};
  }
 }
 return {text:result.text??result.answer??'',sources,checkedAt:result.checkedAt,
  evidenceFormat:result.evidenceFormat==='brief-v1'?'brief-v1':'full-report',
  ...(result.verification?{verification:result.verification}:{}),...(result.detailAvailable?{detailAvailable:true}:{})};
}

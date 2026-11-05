// Select complete, source-linked findings. Never shorten by cutting sentences:
// a dropped qualification can turn an estimate into a false personal promise.
import {validatedResearchFindings} from './researchFindings.mjs';
export function researchBriefSelection(result={}){
 const brief=result.voiceBrief,sources=result.sources||[],findings=validatedResearchFindings(result);
 if(brief&&['verified','partial','unverified'].includes(brief.status)&&
  ['answer','qualification','nextStep'].every(key=>typeof brief[key]==='string')&&brief.answer.trim()&&brief.qualification.trim()){
  const text=[brief.answer,brief.qualification,brief.nextStep].filter(Boolean).join('\n');
  const ids=[...new Set([...text.matchAll(/\[(\d+)\]/g)].map(match=>Number(match[1])))];
  // Size is a validity check, not a truncation rule. Invalid briefs retain the
  // complete report and all its qualifications. IDs preserve original citations.
  const onlyUnknown=brief.status==='unverified'&&findings.length>0&&findings.every(f=>f.status==='unverified');
  const unverifiedLead=brief.status!=='verified'&&findings.some(f=>f.status==='unverified'&&f.answer.trim()===brief.answer.trim()&&f.qualification.trim()===brief.qualification.trim());
  if(new TextEncoder().encode(text).length<=1400&&(ids.length||onlyUnknown||unverifiedLead)&&ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=sources.length)){
   const selectedIds=[...new Set([...ids,...findings.flatMap(f=>f.sourceIds)])];
   return {text,sources:selectedIds.map(id=>({...sources[id-1],id})),checkedAt:result.checkedAt,evidenceFormat:'brief-v1',verification:brief.status,detailAvailable:true,...(findings.length?{findings}:{})};
  }
 }
 return {text:result.text??result.answer??'',sources,checkedAt:result.checkedAt,
  evidenceFormat:result.evidenceFormat==='brief-v1'?'brief-v1':'full-report',
  ...(result.verification?{verification:result.verification}:{}),...(result.detailAvailable?{detailAvailable:true}:{}),...(findings.length?{findings}:{})};
}

import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchAspects,findingSubjectMentioned,researchSubjectIdentity} from '../src/researchFindings.mjs';
import {requestedResearchAspects} from '../src/researchQuestion.mjs';

export function researchBriefRequest(body){
 const string={type:'string'};
 let input;try{input=JSON.parse(body.input);}catch{input={};}
 const requested=requestedResearchAspects(input.question);
 return {...body,text:{format:{type:'json_schema',name:'voice_research_v1',strict:true,schema:{type:'object',additionalProperties:false,
  properties:{brief:{type:'object',additionalProperties:false,properties:{status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string,nextStep:string,
   findings:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{subject:string,aspect:{type:'string',enum:researchAspects},status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string},required:['subject','aspect','status','answer','qualification']}}},required:['status','answer','qualification','nextStep','findings']},report:string},required:['brief','report']}}},
  instructions:body.instructions+`\n# Conversation result format
Return a concise brief and the detailed report in the required JSON. Use actual hosted-search citations inside the JSON string values; never invent citation numbers or sources.
The brief is independent of the report: answer the exact question in one or two short sentences (about 35 words), then one complete qualification (about 35 words), and an optional short useful next step. Keep all three together under 100 words and 1,400 UTF-8 bytes. Include the institution, program/population, applicable year/term, currency/period, and scenario assumptions when they affect the answer. Preserve unknowns, exceptions and source conflicts in the qualification; never improve apparent certainty to meet a length target. If necessary, state the narrow verified finding and what remains unknown instead of compressing many figures. Do not turn a published budget into an amount the student owes or an individual aid award. Ordinary conceptual explanations need no financial details. Write naturally in the requested language; no greeting, progress filler, permission-to-hear-results question, or instruction to interrupt the caller.
Use verified only when the specific requested fact and its applicable scope are established; partial when important details remain unresolved; unverified when the requested fact could not be confirmed. An official domain alone does not establish a claim. Put supporting details and additional citations in report, including all material qualifications. Do not put private reasoning in either field. No additional model call is needed to rewrite this result.
In findings, separate the requested answer into at most eight self-contained units by institution/subject and aspect. Each answer and qualification is at most 700 characters; subject is at most 160. Keep tuition/mandatory fees separate from total budgets. Include applicable year and population in each factual answer and preserve essential qualifications. Every material source discrepancy, omitted mandatory charge, arithmetic caveat or applicability limit must be repeated in the qualification of the finding it affects, never only in the top-level brief or report. Put actual hosted-search citations in each supported answer/qualification, not invented citation indices. A missing requested fact gets its own unverified unit; explain what could not be confirmed, without interpreting a failed page as proof the information is unpublished. An unverified unit may have no citation when no supporting page could be read. Do not invent an amount for it.
${requested.length?'Requested answer aspects: '+requested.join(', ')+'. A contrast such as tuition separately from total cost of attendance defines the answer boundary; it does not request the other budget. Do not add unverified units for unrequested aspects.':''}
Lead with the useful verified answer to the latest question, keeping its year and scenario, then a short material qualification. A published general estimate can be useful even when a narrower population or future year is unconfirmed; label it accurately, never imply unsupported applicability. For partial comparisons where the newly requested part has no verified answer, explain that specific gap first; do not repeat another campus's figures to conceal it. Distinguish a scope not researched by this check from a fact searched but unverified; neither proves information is unpublished. Reused findings are context, not a new discovery. A completed check is finished, not still working. The application alone decides whether recovery is running.`};
}

export function parseResearchBrief(result){
 if(!result)return null;
 let value;try{value=JSON.parse(result.text);}catch{
  // Old queued jobs/provider fixtures remain readable. A broken structured
  // payload is not spoken as JSON or retried at additional cost.
  return /^\s*\{/.test(result.text)?null:result;
 }
 if(!value||typeof value.report!=='string'||!value.report.trim())return null;
 const next={...result,text:value.report,parts:[{text:value.report}],voiceBrief:value.brief};
 if(researchBriefSelection(next).evidenceFormat!=='brief-v1')delete next.voiceBrief;
 if(next.voiceBrief){
  const findings=researchBriefSelection(next).findings||[],qualification=next.voiceBrief.qualification;
  const ids=[...qualification.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
  const named=[...new Set(findings.filter(f=>findingSubjectMentioned(f.subject,qualification)).map(f=>researchSubjectIdentity(f.subject)))];
  const subjects=[...new Set(findings.map(f=>researchSubjectIdentity(f.subject)))];
  const citedSubjects=[...new Set(findings.filter(f=>f.status!=='unverified'&&ids.some(id=>f.sourceIds.includes(id))).map(f=>researchSubjectIdentity(f.subject)))];
  // The selected finding travels without the top-level brief. Retain a
  // source-linked qualification when its subject is unambiguous. Never trim
  // it to fit: an oversized unit falls back to the complete qualified report.
  const updated=findings.map(f=>{
   if(f.status==='unverified'||f.qualification.includes(qualification))return f;
   // Citations immediately following a sentence belong to that sentence,
   // including when the next sentence names another institution.
   const normalized=qualification.replace(/([.!?])\s*((?:\[\d+\]\s*)+)(?=\p{L}|$)/gu,(_,punctuation,refs)=>' '+refs.trim()+punctuation+' ');
   const clauses=normalized.split(/(?<=[.!?])\s+(?=[\p{L}])/u).flatMap(clause=>{
    const aspects=requestedResearchAspects(clause);
    if(aspects.length&&!aspects.includes(f.aspect))return [];
    const mentioned=[...new Set(findings.filter(other=>findingSubjectMentioned(other.subject,clause)).map(other=>researchSubjectIdentity(other.subject)))];
    // A source-linked paragraph can name its subject only in its final
    // sentence. Carry its material caveat when both the name and citations
    // identify one subject; an unnamed failed-page sentence is still ambiguous
    // when another campus has an unresolved finding.
    const accessFailure=/\b(?:failed|inaccessible|unavailable|could not|cannot|unable|unverified|no se pudo|no pude|no fue posible|inaccesible|no disponible|sin verificar)\b/iu.test(clause);
    const paragraphScope=named.length===1&&citedSubjects.length===1&&named[0]===citedSubjects[0]&&!accessFailure?named:[];
    const scope=mentioned.length?mentioned:subjects.length===1?subjects:paragraphScope;
    if(scope.length!==1||scope[0]!==researchSubjectIdentity(f.subject))return [];
    const cited=[...clause.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
    // A paragraph-level final citation can qualify earlier clauses only when
    // that paragraph has a single subject. Otherwise require a local citation.
    const supported=(cited.length?cited:named.length<=1?ids:[]).filter(id=>f.sourceIds.includes(id));
    if(!supported.length)return [];
    const plain=value=>value.replace(/\[\d+\]/gu,'').trim();
    if(plain(f.qualification).includes(plain(clause))||plain(f.answer).includes(plain(clause)))return [];
    return [clause.trim()+(cited.length?'':' '+supported.map(id=>`[${id}]`).join(' '))];
   });
   if(!clauses.length)return f;
   return {...f,qualification:[f.qualification,...clauses].filter(Boolean).join(' ')};
  });
  if(updated.some(f=>f.qualification.length>700)){
   next.text=value.report+'\n'+qualification;next.parts=[{text:next.text}];delete next.voiceBrief;
  }else if(updated.length)next.voiceBrief={...next.voiceBrief,findings:updated};
 }
 return next;
}

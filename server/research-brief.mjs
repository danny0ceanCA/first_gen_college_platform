import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchAspects} from '../src/researchFindings.mjs';

export function researchBriefRequest(body){
 const string={type:'string'};
 return {...body,text:{format:{type:'json_schema',name:'voice_research_v1',strict:true,schema:{type:'object',additionalProperties:false,
  properties:{brief:{type:'object',additionalProperties:false,properties:{status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string,nextStep:string,
   findings:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{subject:string,aspect:{type:'string',enum:researchAspects},status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string},required:['subject','aspect','status','answer','qualification']}}},required:['status','answer','qualification','nextStep','findings']},report:string},required:['brief','report']}}},
  instructions:body.instructions+`\n# Conversation result format
Return a concise brief and the detailed report in the required JSON. Use actual hosted-search citations inside the JSON string values; never invent citation numbers or sources.
The brief is independent of the report: answer the exact question in one or two short sentences (about 35 words), then one complete qualification (about 35 words), and an optional short useful next step. Keep all three together under 100 words and 1,400 UTF-8 bytes. Include the institution, program/population, applicable year/term, currency/period, and scenario assumptions when they affect the answer. Preserve unknowns, exceptions and source conflicts in the qualification; never improve apparent certainty to meet a length target. If necessary, state the narrow verified finding and what remains unknown instead of compressing many figures. Do not turn a published budget into an amount the student owes or an individual aid award. Ordinary conceptual explanations need no financial details. Write naturally in the requested language; no greeting, progress filler, permission-to-hear-results question, or instruction to interrupt the caller.
Use verified only when the specific requested fact and its applicable scope are established; partial when important details remain unresolved; unverified when the requested fact could not be confirmed. An official domain alone does not establish a claim. Put supporting details and additional citations in report, including all material qualifications. Do not put private reasoning in either field. No additional model call is needed to rewrite this result.
In findings, separate the requested answer into at most eight self-contained units by institution/subject and aspect. Each answer and qualification is at most 700 characters; subject is at most 160. Keep tuition/mandatory fees separate from total budgets. Include applicable year and population in each factual answer and preserve essential qualifications. Put actual hosted-search citations in each supported answer/qualification, not invented citation indices. A missing requested fact gets its own unverified unit; explain what could not be confirmed, without interpreting a failed page as proof the information is unpublished. An unverified unit may have no citation when no supporting page could be read. Do not invent an amount for it.
For partial comparisons, lead the brief with the newly requested missing or uncertain portion, then only useful verified context. Reused findings are context, not a new discovery. Avoid repeating a previously supplied campus's figures to conceal the missing comparison. A completed check with unverified findings is finished, not still working. The application alone decides whether recovery is running.`};
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
 return next;
}

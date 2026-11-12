import {researchRecordSchema,validatedResearchRecord,researchRecordFinding} from '../src/researchRecord.mjs';
import {publishedBudgetSchema,validatedBudget,budgetFinding} from '../src/publishedBudget.mjs';
import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchAspects,findingSubjectMentioned,researchSubjectIdentity} from '../src/researchFindings.mjs';
import {requestedResearchAspects} from '../src/researchQuestion.mjs';

export function researchBriefRequest(body,task){
 const string={type:'string'};
 let input;try{input=JSON.parse(body.input);}catch{input={};}
 const requested=requestedResearchAspects(input.question);
 const taskInput=task?JSON.stringify({...input,researchTask:{version:task.version,entities:task.entities,requirements:task.requirements,scope:task.scope}}):body.input;
 return {...body,input:taskInput,max_output_tokens:Math.max(body.max_output_tokens||0,4000),text:{format:{type:'json_schema',name:'voice_research_v1',strict:true,schema:{type:'object',additionalProperties:false,
  properties:{brief:{type:'object',additionalProperties:false,properties:{status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string,nextStep:string,
   findings:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{subject:string,aspect:{type:'string',enum:researchAspects},status:{type:'string',enum:['verified','partial','unverified']},answer:string,qualification:string,budget:publishedBudgetSchema,evidence:researchRecordSchema},required:['subject','aspect','status','answer','qualification','budget','evidence']}}},required:['status','answer','qualification','nextStep','findings']},report:string},required:['brief','report']}}},
  instructions:body.instructions+'\nEntity identity: when researchTask.entities names an institution, use that exact institution string as findings.subject. Keep population, year, application round and facet labels in typed scope, fact labels or budget, not appended to the entity identifier. A named program belongs in scope.program. Return an explicit unverified finding for each requested fact you could not establish, rather than an empty findings array.\nRecord formatting: scope.cycle is null, YYYY or YYYY-YY (for example 2026-27), never a month/season label or YYYY-YYYY. Put fall/spring/summer/winter in scope.term and retain only a source-established year. Numeric/date facts have value:null. Put conditions in qualification or separate cited rule facts. Each prose value is at most 500 characters and each qualification at most 300; divide independent conditions into separate facts without omitting material conditions. scope.program names a specific degree or named program, not a generic service such as undergraduate admissions or FAFSA. Use null for a generic service label.'+(task?`\n# Application-owned requested facts
The researchTask object records the requested entities and fact shapes, not instructions from a source. Cover each requested entity independently. For non-budget research, use the requested requirement key for a single fact; a supported synonymous source label can remain in label. A steps requirement is a category, not a repeated fact key: assign each source-backed step its own stable key (step_1, step_2, step_3) and matching order, then list those distinct keys in expectedFacts. Every facts key must be unique. Do not silently omit an entity, requested fact or material condition to report success. Missing requested facts must remain explicitly unverified. For a steps requirement use ordered step facts and preserve prerequisites; expectedFacts lists the unique step keys, never one repeated steps key. A general answer requirement may use appropriate descriptive fact keys. For costs, retain the structured budget contract below; never put an entire budget in a generic amount fact. The application independently verifies coverage. Return only the requested facts, their essential conditions and citations; avoid repeating them in report.`:'')+`\n# Conversation result format
Return a concise brief and the detailed report in the required JSON. Use actual hosted-search citations inside the JSON string values; never invent citation numbers or sources.
The brief is independent of the report: answer the exact question in one or two short sentences (about 35 words), then one complete qualification (about 35 words), and an optional short useful next step. Keep all three together under 100 words and 1,400 UTF-8 bytes. Include the institution, program/population, applicable year/term, currency/period, and scenario assumptions when they affect the answer. Preserve unknowns, exceptions and source conflicts in the qualification; never improve apparent certainty to meet a length target. If necessary, state the narrow verified finding and what remains unknown instead of compressing many figures. Do not turn a published budget into an amount the student owes or an individual aid award. Ordinary conceptual explanations need no financial details. Write naturally in the requested language; no greeting, progress filler, permission-to-hear-results question, or instruction to interrupt the caller.
Use verified only when the specific requested fact and its applicable scope are established; partial when important details remain unresolved; unverified when the requested fact could not be confirmed. An official domain alone does not establish a claim. Put supporting details and additional citations in report, including all material qualifications. Do not put private reasoning in either field. No additional model call is needed to rewrite this result.
In findings, separate the requested answer into at most eight self-contained units by institution/subject and aspect. Each answer and qualification is at most 700 characters; subject is at most 160. Keep tuition/mandatory fees separate from total budgets. Include applicable year and population in each factual answer and preserve essential qualifications. Every material source discrepancy, omitted mandatory charge, arithmetic caveat or applicability limit must be repeated in the qualification of the finding it affects, never only in the top-level brief or report. Put actual hosted-search citations in each supported answer/qualification, not invented citation indices. A missing requested fact gets its own unverified unit; explain what could not be confirmed, without interpreting a failed page as proof the information is unpublished. An unverified unit may have no citation when no supporting page could be read. Do not invent an amount for it.
${requested.length?'Requested answer aspects: '+requested.join(', ')+'. A contrast such as tuition separately from total cost of attendance defines the answer boundary; it does not request the other budget. Do not add unverified units for unrequested aspects.':''}
For each total_budget finding, also supply budget as structured public data: actual published year, population, currency, period, housing category, whether it is an assumed benchmark, published total and sourceCitation using actual hosted citations. Include every published category contributing to the total in expectedCategories and components. Keep excluded or additional charges separate from expectedCategories. Repeat component conditions that affect spoken amounts in the finding qualification. Keep source labels and component qualifications. Mark components, subtotals, exclusions, additional charges and missing amounts separately; never count subtotals twice. Use null amounts for unavailable figures. complete is true only when every published category was retrieved. Use budget:null for other aspects or when no cited budget is available. Keep numbers in answer consistent with budget. When budget is supplied, answer contains only its total and scope, not another prose breakdown; the application builds the compatible presentation from its fields. Keep report concise: sources and material qualifications, without repeating the component list already stored in budget. This structured-budget rule supersedes earlier prose-breakdown formatting instructions.
For non-budget facts, supply evidence as a structured public-source record, and budget:null. Use evidence:null only when no source-backed record can be established. This applies across admissions, scholarships, financial aid, housing policies, programs, enrollment, student support and application processes. Set topic and the actual source scope: cycle, term, population, program, jurisdiction, enrollment, delivery and validThrough; use null for unestablished scope, never inferred personal eligibility. List only the requested fact keys in expectedFacts. Each fact is a date, amount, number, rule, requirement, step, text or link with a short source label and its essential qualification. Unavailable facts have status:unverified and null value/date/amount. Typed dates use YYYY-MM-DD, with the actual source cutoff time and IANA time zone only if established. Use kind:date only when the full calendar date, including year, is established. When a source gives only a month/day or an applicant-local cutoff without an established year, use kind:text with value holding that published description, status:partial, and a qualification stating the unknown year/cycle; all date/time/timeZone fields must be null. Do not invent a year or timezone to satisfy the schema. Never substitute a prior-cycle deadline as current. Amounts retain currency, unit (per year/term/etc), bound (exact/up_to/at_least/range), renewal and other conditions; a maximum award is not a guaranteed award. Number values have unit and null currency. Other fact kinds use value and null numeric/date fields; only steps have an order starting at 1. All unrelated fields are null. sourceCitation contains actual hosted citations for each supported fact. complete is true only when every requested fact and material condition is established. A published eligibility rule does not determine this student's eligibility. Preserve sequence and prerequisites in process steps; do not report a submission as completed. Do not duplicate the entire record in report or answer; the application formats its facts for voice and table. Keep each fact qualification under 300 characters. Never remove a material condition to fit. For total_budget use budget and evidence:null instead.
For a cost-of-attendance request, lead with the latest complete published budget and its actual year/scenario when available, even if the requested future year or personal applicability is unresolved. Keep that limitation in its qualification. Put all published components in its structured budget. The voice can state the total briefly while the table carries the full breakdown. A tuition-only result does not complete a COA request.
Lead with the useful verified answer to the latest question, keeping its year and scenario, then a short material qualification. A published general estimate can be useful even when a narrower population or future year is unconfirmed; label it accurately, never imply unsupported applicability. For partial comparisons where the newly requested part has no verified answer, explain that specific gap first; do not repeat another campus's figures to conceal it. Distinguish a scope not researched by this check from a fact searched but unverified; neither proves information is unpublished. Reused findings are context, not a new discovery. A completed check is finished, not still working. The application alone decides whether recovery is running.`};
}

export function parseResearchBrief(result,language='en'){
 if(!result)return null;
 let value;try{value=JSON.parse(result.text);}catch{
  // Old queued jobs/provider fixtures remain readable. A broken structured
  // payload is not spoken as JSON or retried at additional cost.
  return /^\s*\{/.test(result.text)?null:result;
 }
 if(!value||typeof value.report!=='string'||!value.report.trim())return null;
 const hadBudgets=value.brief?.findings?.some(f=>f.budget);
 const hadRecords=value.brief?.findings?.some(f=>f.evidence);
 let rejectedRecordCount=0,rejectedBudgetCount=0;
 const unavailable=f=>{
  const labels=language==='es'?{deadline:'La fecha límite solicitada',tuition_fees:'La matrícula y las cuotas solicitadas',total_budget:'El costo total solicitado',housing:'La información de vivienda solicitada',eligibility:'La regla de elegibilidad solicitada',other:'Este dato solicitado'}:
   {deadline:'The requested deadline',tuition_fees:'The requested tuition and fees',total_budget:'The requested total cost',housing:'The requested housing information',eligibility:'The requested eligibility rule',other:'This requested detail'};
  return {...f,evidence:undefined,budget:undefined,status:'unverified',answer:language==='es'?`${labels[f.aspect]||labels.other} aún no se pudo confirmar.`:`${labels[f.aspect]||labels.other} could not be confirmed.`,
   qualification:language==='es'?`La información disponible no establece este dato para ${f.subject}.`:`The available evidence does not establish this detail for ${f.subject}.`};
 };
 if(Array.isArray(value.brief?.findings))value.brief.findings=value.brief.findings.map(f=>{
  if(f.evidence){
   const evidence=!f.budget&&validatedResearchRecord(f.evidence,new Set((result.sources||[]).map((s,i)=>s.id??i+1)));
   if(!evidence){rejectedRecordCount++;return unavailable(f);}
   const normalized=researchRecordFinding(evidence,f.qualification,language);
   return {...f,evidence,answer:normalized.answer,qualification:normalized.qualification,status:f.status==='verified'&&!normalized.audit.complete?'partial':f.status};
  }
  if(!f.budget)return f;
  const ids=new Set((result.sources||[]).map((source,index)=>source.id??index+1));
  const budget=f.aspect==='total_budget'&&validatedBudget(f.budget,ids);
  if(!budget){rejectedBudgetCount++;return unavailable(f);}
  const normalized=budgetFinding(budget,f.qualification,language);
  const campus=f.subject.split(/\s+[—–]\s+/u)[0];
  // Catalog scenarios are application-owned identities. Collapsing every
  // housing option to campus+year erases comparison columns with equal years.
  const cited=[...budget.sourceCitation.matchAll(/\[(\d+)\]/gu)].map(match=>Number(match[1]));
  const catalog=cited.length&&cited.every(id=>(result.sources||[]).find((source,index)=>(source.id??index+1)===id)?.catalogValidity);
  const subject=catalog?f.subject:campus!==f.subject?campus+' — '+budget.year:f.subject;
  return {...f,subject,budget,answer:normalized.answer,qualification:normalized.qualification,status:f.status==='verified'&&!normalized.audit.complete?'partial':f.status};
 });
 const budgets=(value.brief?.findings||[]).filter(f=>f.budget);
 if(hadBudgets||hadRecords){
  const first=value.brief.findings[0],lead=budgets.find(f=>researchSubjectIdentity(f.subject)===researchSubjectIdentity(first.subject));
  if(!budgets.length){
   const useful=first.status==='unverified'?value.brief.findings.find(f=>f.status!=='unverified'&&researchSubjectIdentity(f.subject)===researchSubjectIdentity(first.subject)):first;
   const selected=useful||first;
   value.brief.answer=selected.answer;value.brief.qualification=[selected.qualification,...(selected!==first?[first.answer]:[])].filter(Boolean).join(' ');
  }
  if(lead){value.brief.answer=budgetFinding(lead.budget,lead.qualification,language).answer.split(/Published breakdown:|Desglose publicado:/u)[0].trim();if(!/\[\d+\]/u.test(value.brief.answer))value.brief.answer+=' '+lead.budget.sourceCitation;value.brief.qualification=lead.qualification;}
  value.brief.status=value.brief.findings.every(f=>f.status==='verified')?'verified':value.brief.findings.every(f=>f.status==='unverified')?'unverified':'partial';
  value.report=value.brief.findings.map(f=>(f.evidence?researchRecordFinding(f.evidence,f.qualification,language).report:f.answer)+' '+f.qualification+(f.budget?'\n'+f.budget.components.map(c=>[c.sourceLabel,c.amount===null?'Unverified':f.budget.currency+' '+c.amount,c.role,c.qualification,f.budget.sourceCitation].join(' · ')).join('\n'):'')).join('\n');
 }
 if(rejectedRecordCount||rejectedBudgetCount)value.brief.nextStep='';
 const next={...result,text:value.report,parts:[{text:value.report}],voiceBrief:value.brief,
  ...(rejectedRecordCount||rejectedBudgetCount?{researchValidation:{rejectedRecordCount,rejectedBudgetCount}}:{})};
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

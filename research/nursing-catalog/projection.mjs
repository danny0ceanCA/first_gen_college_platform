import {researchBriefSelection} from '../../src/researchBrief.mjs';

const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n/100);
const boundedBrief=(answer,qualification)=>answer.length<=700&&qualification.length<=700&&Buffer.byteLength(answer+'\n'+qualification)<=1350;

// Keep complete statements together in one finding. The two fields share a
// bounded voice unit; moving a whole statement between them loses no caveat.
// A long source paragraph is never cut to make room for a monetary claim.
function caveatedFallback({college,scope,pending,selected,answer,citation,decisions,conditions,es}){
 let lead=selected?.normalized.value_representation==='Unpriced or variable'?answer:
  es?`${college}: esta referencia contiene condiciones o conflictos; no establece un precio completo confirmado. ${citation}`:
  `${college}: this reference has qualifications or conflicts; it does not establish a confirmed complete price. ${citation}`;
 let qualification=pending+' '+scope;
 const append=text=>{
  if(!text||lead.includes(text)||qualification.includes(text))return true;
  const next=qualification+' '+text;
  if(boundedBrief(lead,next)){qualification=next;return true;}
  const nextLead=lead+' '+text;
  if(boundedBrief(nextLead,qualification)){lead=nextLead;return true;}
  return false;
 };
 append(selected?.normalized.caveated_handling);
 // Required warnings and unresolved applicability take priority over figures.
 // Only quote a decision's suggested amounts if all its warnings are present.
 for(const d of decisions){
  const required=append(d.required_caveat),unresolved=append(d.still_unresolved);
  if(required&&unresolved)append(d.suggested_wording);
 }
 for(const text of [...new Set(conditions.filter(Boolean))]){
  if(append(text))continue;
  // A paragraph may contain source history as well as the actual restriction.
  // When it cannot fit whole, retain complete warning sentences. The lead still
  // withholds the primary price, and the full paragraph stays in the report.
  for(const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/u)){
   if(/\b(?:not|no|must|unconfirmed|conflict\w*|additional|exclude\w*|unknown|variable|without|depend\w*|historical|pending|confirm\w*|waiv\w*)\b/iu.test(sentence))append(sentence);
  }
 }
 append(selected?.values['Relationship to total']);
 append(selected?.values['Conditions / notes']);
 append(es?'El informe conserva el resto de las condiciones.':'The report retains any further qualifications.');
 if(!boundedBrief(lead,qualification))throw Error('nursing_scope_not_bounded');
 return {answer:lead,qualification};
}

export function itemValue(item,es=false){
 const n=item.normalized;
 switch(n.value_representation){
  case 'Published range':return `${money(n.published_lower_bound_cents)}–${money(n.published_upper_bound_cents)} USD`;
  case 'Published lower bound':return `${es?'Al menos':'At least'} ${money(n.published_lower_bound_cents)} USD`;
  case 'Published upper bound':return `${es?'Hasta':'Up to'} ${money(n.published_upper_bound_cents)} USD`;
  case 'Recorded scalar amount':return n.source_scalar_cents===null?(es?'Importe sin verificar':'Amount unverified'):`${money(n.source_scalar_cents)} USD`;
  default:return es?'Importe no publicado o variable':'Unpriced or variable';
 }
}

export function projectNursingRecord(row,items,language='en',question=''){
 const record=row.payload??row,v=record.values,n=record.normalized,es=language==='es';
 if(n.source_verified!==false||n.automatic_production_permission!==false)throw Error('nursing_source_status_changed');
 const sources=[],sourceId=url=>{
  let parsed;try{parsed=new URL(url);}catch{return null;}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)return null;
  const existing=sources.find(s=>s.url===url);if(existing)return existing.id;
  const id=sources.length+1;sources.push({id,url,title:v.College+' — '+v['Program / degree']});return id;
 };
 const mainId=sourceId(v['Official source URL']);if(!mainId)return null;
 const citation=`[${mainId}]`,q=fold(question);
 const pending=es?'Referencia del catálogo pendiente de revisión independiente.':'Catalog reference pending independent source review.';
 const scope=[v['Program / degree'],v['Institution / location note'],v['Academic year'],v['Entering cohort / applies to'],v['Budget period'],v.Residency,v.Housing,v.Enrollment,v['Cost coverage']].filter(Boolean).join('; ');
 const decisions=n.caveated_decisions||[];
 const conditions=[v['Scope and exclusions'],v['Required source-scope handling'],...decisions.flatMap(d=>[d.required_caveat,d.still_unresolved])].filter(Boolean);
 const allItems=items.map(r=>r.payload??r);
 const feeOnly=/\b(?:tuition|matricula|colegiatura|fees|cuotas)\b/u.test(q)&&!/\b(?:total|coa|cost of attendance|costo de asistencia|breakdown|desglose)\b/u.test(q);
 const named=allItems.filter(i=>{
  const tokens=fold(i.values['Original source label']).split(' ').filter(x=>x.length>2&&!['published','estimated','program','nursing','cost','costs','expense','expenses','total','and','the'].includes(x));
  return tokens.length&&tokens.some(token=>q.split(' ').includes(token));
 });
 const tuition=allItems.filter(i=>/tuition|matricula|colegiatura/u.test(fold(i.values.Category+' '+i.values['Original source label']))&&!/nonresident|non resident|supplemental/u.test(fold(i.values.Category)));
 let selected=feeOnly?tuition.length===1?tuition[0]:null:named.length===1?named[0]:null;
 const totalRange=allItems.find(i=>/program total|total program|published.*total/u.test(fold(i.values['Original source label']))&&['Published range','Published lower bound','Published upper bound'].includes(i.normalized.value_representation));
 let answer;
 if(selected){answer=`${v.College}: ${selected.values['Original source label']}: ${itemValue(selected,es)}; ${selected.values['Amount period']}. ${citation}`;conditions.push(selected.values['Conditions / notes'],selected.normalized.caveated_handling);}
 else if(feeOnly)answer=es?`${v.College}: la referencia no establece un subtotal único de matrícula para este alcance. ${citation}`:`${v.College}: this reference does not establish one tuition subtotal for this scope. ${citation}`;
 else if(n.published_cents!==null)answer=`${v.College}: ${es?'importe publicado':'source-published amount'} ${money(n.published_cents)} USD; ${scope}. ${citation}`;
 else if(totalRange){selected=totalRange;answer=`${v.College}: ${es?'rango o límite publicado':'source-published range or bound'} ${itemValue(totalRange,es)}; ${scope}. ${citation}`;}
 else answer=es?`${v.College}: hay una referencia de ${v['Program / degree']}, pero no hay un total completo establecido para ${v['Budget period']}. ${citation}`:`${v.College}: a ${v['Program / degree']} reference is available, but a complete total is not established for ${v['Budget period']}. ${citation}`;
 const fullQualification=[pending,scope,...new Set(conditions.filter(Boolean))].join(' ');
 const applicable=selected&&selected!==totalRange?
  [...decisions.filter(d=>!/^NUR-\d{4}-\d{3}$/u.test(d.reference)||d.reference===selected.id),...(selected.normalized.caveated_decisions||[])]:decisions;
 const relevantDecisions=[...new Map(applicable.map(d=>[d.reference,d])).values()];
 let qualification=selected?[pending,scope,selected.values['Relationship to total'],selected.values['Conditions / notes'],selected.normalized.caveated_handling,...relevantDecisions.flatMap(d=>[d.required_caveat,d.still_unresolved])].filter(Boolean).join(' '):fullQualification;
 // Never shorten a material qualification to fit a spoken monetary claim.
 // Long records remain fully available in the report and focused follow-ups.
 if(!boundedBrief(answer,qualification)){
  ({answer,qualification}=caveatedFallback({college:v.College,scope,pending,selected,answer,citation,
   decisions:relevantDecisions,conditions,es}));
 }
 const detail=[`${record.id}: ${v.College}`,scope,fullQualification,...allItems.map(i=>{
  const id=sourceId(i.normalized.source_url)||mainId;
  return `${i.id}: ${i.values['Original source label']}: ${itemValue(i,es)}; ${i.values['Amount period']}; ${i.values['Relationship to total']}. ${i.values['Conditions / notes']||''} ${i.normalized.caveated_handling||''} [${id}]`;
 }),...decisions.map(d=>`${d.suggested_wording||''} ${d.required_caveat} ${d.still_unresolved||''}`)].join('\n');
 const finding={subject:v.College,aspect:feeOnly?'tuition_fees':'total_budget',status:'partial',answer,qualification,budget:null,evidence:null};
 const result={text:detail,parts:[{text:detail}],sources,checkedAt:v['Source checked'],voiceBrief:{status:'partial',answer,qualification,nextStep:'',findings:[finding]},catalogPublication:'production',nursingCatalog:{recordId:record.id,pending:true,sourceVerified:false,publicationId:row.publication_id},catalogAdditionalDetails:detail};
 if(researchBriefSelection(result).evidenceFormat!=='brief-v1')throw Error('nursing_brief_not_bounded');
 return result;
}

export function nursingClarification(records,language='en'){
 const es=language==='es',r=records[0];if(!r)return null;
 const options=[...new Set(records.map(r=>[r.program,r.payload.values['Institution / location note'],r.academic_year_raw,r.payload.values['Entering cohort / applies to'],r.budget_period,r.residency,r.housing,r.enrollment].filter(Boolean).join(' / ')))];
 const answer=es?'Hay varias referencias de enfermería con alcances diferentes. Falta identificar el programa, período o modalidad antes de citar un importe.':'There are several nursing references with different scopes. The program, period or scenario needs to be identified before quoting an amount.';
 const qualification=es?'Los registros siguen pendientes de revisión de fuentes. El alcance aún no está confirmado.':'The records remain pending source review. The applicable scope is not yet confirmed.';
 const url=r.source_url;return {text:answer+'\n'+options.join('\n'),parts:[{text:answer+'\n'+options.join('\n')}],sources:[{id:1,url,title:r.campus}],checkedAt:r.payload.values['Source checked'],voiceBrief:{status:'partial',answer:answer+' [1]',qualification,nextStep:options.slice(0,3).join('; '),findings:[{subject:r.campus,aspect:'total_budget',status:'partial',answer:answer+' [1]',qualification}]},catalogPublication:'production',nursingCatalog:{pending:true,clarification:true}};
}

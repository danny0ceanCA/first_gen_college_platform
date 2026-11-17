import {researchBriefSelection} from '../../src/researchBrief.mjs';

const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n/100);
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
 let qualification=selected?[pending,scope,selected.values['Relationship to total'],selected.values['Conditions / notes'],selected.normalized.caveated_handling,...(selected.normalized.caveated_decisions||[]).flatMap(d=>[d.required_caveat,d.still_unresolved])].filter(Boolean).join(' '):fullQualification;
 // Never shorten a material qualification to fit a spoken monetary claim.
 // Long records remain fully available in the report and focused follow-ups.
 if(answer.length>700||qualification.length>700||Buffer.byteLength(answer+'\n'+qualification)>1350){
  answer=es?`${v.College}: esta referencia contiene condiciones o conflictos que requieren revisar el desglose; no establece un precio completo confirmado. ${citation}`:`${v.College}: this reference has qualifications or conflicts requiring review of the breakdown; it does not establish a confirmed complete price. ${citation}`;
  qualification=[pending,v['Program / degree'],v['Academic year'],v['Budget period'],es?'Los importes, límites, cargos no incluidos y condiciones se conservan en el informe.':'Amounts, bounds, excluded charges and qualifications are retained in the report.'].filter(Boolean).join('; ');
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
 const url=r.source_url;return {text:answer+'\n'+options.join('\n'),parts:[{text:answer+'\n'+options.join('\n')}],sources:[{id:1,url,title:r.campus}],checkedAt:r.payload.values['Source checked'],voiceBrief:{status:'partial',answer:answer+' [1]',qualification:es?'Los registros siguen pendientes de revisión de fuentes.':'The records remain pending source review.',nextStep:options.slice(0,3).join('; '),findings:[{subject:r.campus,aspect:'total_budget',status:'partial',answer:answer+' [1]',qualification:es?'El alcance aún no está confirmado.':'The applicable scope is not yet confirmed.'}]},catalogPublication:'production',nursingCatalog:{pending:true,clarification:true}};
}

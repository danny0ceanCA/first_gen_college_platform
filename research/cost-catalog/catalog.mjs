import {validatedBudget,budgetAudit,budgetFinding} from '../../src/publishedBudget.mjs';
import {parseResearchBrief} from '../../server/research-brief.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';
import {costCampusName} from './campus.mjs';
import {sourceHousing} from './scope.mjs';

const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases={'berkeley':'UC Berkeley','uc berkeley':'UC Berkeley','davis':'UC Davis','uc davis':'UC Davis','merced':'UC Merced','uc merced':'UC Merced','ucla':'UCLA','uc los angeles':'UCLA','irvine':'UC Irvine','uc irvine':'UC Irvine','riverside':'UC Riverside','uc riverside':'UC Riverside','uc santa cruz':'UC Santa Cruz','uc san francisco':'UC San Francisco','uc santa barbara':'UC Santa Barbara','uc san diego':'UC San Diego'};
const keys={'Tuition and mandatory fees':'tuition_fees','Tuition':'tuition_fees','Mandatory fees':'tuition_fees','Systemwide fees':'tuition_fees','Campus fees':'tuition_fees','Student services fee':'tuition_fees','Nonresident supplemental tuition':'tuition_fees','Housing':'housing','Food':'food','Housing and food':'housing_and_food','Housing and food combined':'housing_and_food','Combined living expenses':'housing_and_food','Books and supplies':'books','Transportation':'transportation','Personal expenses':'personal','Health insurance':'health_insurance','Document fee':'document_fee','Other expenses':'other_expenses','Loan fees':'other_expenses','Telephone':'other_expenses','Utilities':'other_expenses','One-time fees':'other_expenses'};
const fields={studentLevel:'Student level',program:'Program / degree',cohort:'Normalized cohort key',residency:'Residency',enrollment:'Enrollment',housingLabel:'Housing',dependentChildren:'Dependent children',feeResidency:'Fee residency',coverageMonths:'Coverage months'};
export function scopeMatch(record,scope){
 const raw=record.payload.raw;
 return Object.entries(fields).every(([key,label])=>scope[key]===undefined||fold(scope[key])===fold(raw[label]))&&
  (!scope.housing||record.payload.normalized.housing===scope.housing);
}

export function projectRecord(record,language='en',{allowTesting=false,now=Date.now()}={}){
 const {raw,normalized,items}=record.payload,es=language==='es',groups=new Map(),production=record.caveated_publication===true,testing=allowTesting&&(record.test_publication===true||production);
 if(!testing&&(record.bucket!=='reconciled'||record.flagged||record.published_cents===null||/source conflict/i.test(raw['Scope and exclusions']||'')))return null;
 if(record.bucket==='invalid')return null;
 const urls=[...new Set([raw['Official source URL'],...items.flatMap(i=>[i.raw['Source override URL'],i.raw['Verification URL']])].filter(Boolean))];
 for(const item of items){
  // Additional charges can be mutually exclusive alternatives. Keep each in
  // the detailed report; never sum them into an invented extra-charge amount.
  if(item.role!=='Included component')continue;
  const key=keys[item.raw.Category]||(testing?'other_expenses':null);if(!key||!testing&&item.amount===null)return null;
  const role=item.role==='Included component'?'component':'additional',identity=key+':'+role;
  const group=groups.get(identity)||{key,role,cents:0,labels:[],notes:[],missing:false};group.cents+=Number(item.amount);group.missing||=item.amount===null;group.labels.push(item.raw['Original source label']);
  if(item.raw['Conditions / notes'])group.notes.push(item.raw['Conditions / notes']);
  const url=item.raw['Verification URL']||item.raw['Source override URL'];if(url)group.notes.push(`[${urls.indexOf(url)+1}]`);
  groups.set(identity,group);
 }
 const values=[...groups.values()];
 // Preserve roles rather than merge an additional charge into an included row.
 // Unrepresentable findings stay out of this adapter, pending explicit mapping.
 if(new Set(values.map(v=>v.key)).size!==values.length)return null;
 const classifiedHousing=sourceHousing(record);
 const unknownHousing=['unknown','commuter_unspecified','off_campus_unspecified'].includes(classifiedHousing);
 const budget={year:raw['Academic year'],population:[...new Set([raw['Student level'],raw['Program / degree'],raw['Residency'],raw['Entering cohort / applies to']].filter(Boolean))].join('; '),currency:raw.Currency,period:'academic_year',housing:testing&&unknownHousing?(classifiedHousing==='off_campus_unspecified'?'off_campus':'unspecified'):classifiedHousing,assumed:false,total:record.published_cents===null?null:Number(record.published_cents)/100,sourceCitation:urls.map((_,i)=>`[${i+1}]`).join(' '),complete:!values.some(v=>v.missing),
  expectedCategories:values.filter(v=>v.role==='component').map(v=>v.key),components:values.map(v=>({key:v.key,role:v.missing?'missing':v.role,amount:v.missing?null:v.cents/100,sourceLabel:testing&&[...new Set(v.labels)].join('; ').length>120?v.key:[...new Set(v.labels)].join('; '),qualification:testing&&[...new Set(v.notes)].join(' ').length>300?(es?'Condiciones completas en los detalles de la fuente.':'Complete conditions in the source details.'):[...new Set(v.notes)].join(' ')}))};
 if(raw['Budget period']!=='Academic year'||!validatedBudget(budget,new Set(urls.map((_,i)=>i+1)))||!testing&&!budgetAudit(budget).complete)return null;
 const coverage=raw['Coverage months']?(es?`Cubre ${raw['Coverage months']} meses.`:`Covers ${raw['Coverage months']} months.`):'';
 const testConditions=[production?(es?'Datos del catálogo publicado; los campos con limitaciones conservan sus advertencias. No es una factura.':'Published catalog data; fields with limitations retain their qualifications. Not a bill.'):es?'Datos del archivo para pruebas locales; la revisión oficial no confirma todos los campos. No es una factura.':'Workbook data for local testing; official rechecking has not confirmed every field. Not a bill.',
  record.bucket==='derived'?(es?'No hay total publicado; no se presenta la suma calculada como total oficial.':'No published total; a calculated sum is not presented as an official total.'):'',
  record.bucket==='discrepancy'?(es?'El total publicado y sus componentes no coinciden.':'The published total and its components do not reconcile.'):'',
  unknownHousing?(es?'La modalidad de vivienda de la fuente no está resuelta.':'The source housing classification remains unresolved.'):'',
  /source conflict/i.test(raw['Scope and exclusions']||'')?(es?'Persiste un conflicto de alcance en la fuente.':'A source scope conflict remains.'):''];
 const qualification=(testing?[...testConditions,coverage]:[es?'Estimación publicada antes de ayuda; no es una factura personal.':'Published estimate before aid; not a personal bill.',coverage,raw['Summer treatment'],raw['Scope and exclusions']]).filter(Boolean).join(' ')+' '+budget.sourceCitation;
 const full={subject:record.campus,aspect:'total_budget',status:testing?'partial':'verified',...budgetFinding(budget,qualification,language),budget};
 const question=es?'¿Cuál es el costo total de asistencia?':'What is the total cost of attendance?';
 const finding={...full,answer:researchSpokenFinding(full,{question,language}).answer};
 const reviewedAt=new Date(record.source_reviewed_at).toISOString(),retrievedAt=new Date(now).toISOString();
 const sourceDate=value=>value==null?null:typeof value==='number'?new Date(Date.UTC(1899,11,30)+value*86400000).toISOString():new Date(value).toISOString();
 const checkedAt=testing?sourceDate(raw['Source checked']):reviewedAt;
 const validUntil=record.valid_until?new Date(record.valid_until).toISOString():null;
 if(validUntil&&Date.parse(validUntil)<=now)return null;
 const sources=urls.map(url=>{
  const item=items.find(i=>(i.raw['Verification URL']||i.raw['Source override URL'])===url);
  const sourceCheckedAt=testing&&item?sourceDate(item.raw['Verification checked']||item.raw['Item source checked']||raw['Source checked']):checkedAt;
  const catalogValidity=sourceCheckedAt&&/^[a-f0-9]{64}$/u.test(record.batch_id||'')&&/^[a-f0-9]{64}$/u.test(record.record_digest||'')&&validUntil?{
   version:1,kind:production?'published_catalog':testing?'local_testing_catalog':'reviewed_catalog',batchId:record.batch_id,recordId:record.budget_key,recordDigest:record.record_digest,
   sourceUrl:url,sourceCheckedAt,reviewedAt,retrievedAt,validUntil,reviewBasis:testing?'workbook_reported':'independent_review',
  }:null;
  return {url,title:record.campus+' published cost source',checkedAt:sourceCheckedAt,...(catalogValidity?{catalogValidity}:{})};
 });
 const additional=items.filter(i=>i.role==='Additional (outside total)').map(i=>`${i.raw['Original source label']}: USD ${i.amount/100}. ${i.raw['Conditions / notes']||''}`).join('\n');
 const parsed=parseResearchBrief({text:JSON.stringify({brief:{status:testing?'partial':'verified',answer:finding.answer,qualification,nextStep:'',findings:[finding]},report:full.answer+' '+qualification}),sources,checkedAt:retrievedAt},language);
 if(testing&&parsed){
  const review=record.review_evidence?.reviewNotes?.find(note=>note.values?.['Budget ID']===record.budget_key)?.values;
  parsed.catalogAdditionalDetails=[raw['Scope and exclusions'],raw['Summer treatment'],review?JSON.stringify(review):'',...items.map(item=>`${item.raw['Original source label']}: ${item.amount===null?'Amount unavailable':'USD '+item.amount/100}. ${item.raw['Conditions / notes']||''}`)].filter(Boolean).join('\n');
  parsed.text+=(production?'\nPublished catalog source details:\n':'\nWorkbook source details (local testing only):\n')+parsed.catalogAdditionalDetails;
 }
 // The shared parser rebuilds its canonical budget report. Retain non-additive
 // alternatives separately for detailed readback without inventing a subtotal.
 if(parsed&&additional){parsed.catalogAdditionalDetails=[parsed.catalogAdditionalDetails,record.campus+' '+budget.sourceCitation+'\n'+additional].filter(Boolean).join('\n');parsed.text+='\nAdditional charges outside the total; alternatives are not additive:\n'+additional;}
 return parsed;
}
export function combineCatalogResults(results,language){
 const sources=[],findings=[],reports=[],additional=[];
 for(const result of results){const offset=sources.length;sources.push(...result.sources);
  const remap=value=>typeof value==='string'?value.replace(/\[(\d+)\]/gu,(_,n)=>`[${Number(n)+offset}]`):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value;
  findings.push(...result.voiceBrief.findings.map(remap));reports.push(remap(result.text));
  if(result.catalogAdditionalDetails)additional.push(remap(result.catalogAdditionalDetails));
 }
 const first=findings[0];if(!first)return null;
 const parsed=parseResearchBrief({text:JSON.stringify({brief:{status:findings.every(f=>f.status==='verified')?'verified':'partial',answer:first.answer,qualification:first.qualification,nextStep:'',findings},report:reports.join('\n')}),sources,checkedAt:new Date().toISOString()},language);
 if(parsed&&additional.length){parsed.catalogAdditionalDetails=additional.join('\n');parsed.text+='\nCatalog source details and charges outside totals; alternatives are not additive:\n'+parsed.catalogAdditionalDetails;}
 return parsed;
}

// Read-only preparation seam. Nothing in the normal application imports this.
// No model call, speech command, worker queue, or wait for missing research.
export function createCostCatalog({query,enabled=false,testing=false,emit=()=>{},now=Date.now}){
 return {async plan({campuses,scope={},language='en'}={}){
  const started=now(),hits=[],needsResearch=[],clarifications=[],results=[];
  if(!enabled)return {enabled:false,result:null,hits,needsResearch:campuses||[],clarifications};
  if(!Array.isArray(campuses)||!campuses.length||campuses.length>8)throw Error('one_to_eight_campuses_required');
  const canonical=[...new Set(campuses.map(name=>costCampusName(name)||String(name)))];
  let records;try{
   // One batched query for a growing comparison, not a model/tool round trip per campus.
   const params=[canonical],where=['campus=ANY($1::text[])'];
   if(scope.academicYear){params.push(scope.academicYear);where.push(`academic_year=$${params.length}`);}
   if(scope.housing){params.push(scope.housing);where.push(`payload->'normalized'->>'housing'=$${params.length}`);}
   records=(await query('SELECT * FROM coa_catalog.'+(testing?'testing_published':'published')+' WHERE '+where.join(' AND '),params)).rows;
  }catch{emit({stage:'cost_catalog',outcome:'unavailable',durationMs:now()-started});return {enabled:true,result:null,hits,needsResearch:canonical,clarifications};}
  for(const campus of canonical){
   let candidates=records.filter(r=>r.campus===campus&&scopeMatch(r,scope));
   if(!scope.academicYear&&candidates.length){const year=candidates.map(r=>r.academic_year).sort().at(-1);candidates=candidates.filter(r=>r.academic_year===year);}
   // Two versions of the same reviewed scenario use the most recently reviewed
   // revision; different cohorts/programs/housing remain separate choices.
   const scenarios=new Map();for(const r of candidates){const old=scenarios.get(r.scenario_key);if(!old||new Date(r.source_reviewed_at)>new Date(old.source_reviewed_at))scenarios.set(r.scenario_key,r);}
   candidates=[...scenarios.values()];
   const missing=['studentLevel','program','cohort','residency','housing','enrollment'].filter(k=>scope[k]===undefined);
   if(candidates.length>1||candidates.length&&missing.length){clarifications.push({campus,reason:'scope_needed',fields:missing,choices:candidates.map(r=>({budgetId:r.budget_key,year:r.academic_year,scope:r.payload.raw}))});continue;}
   const result=candidates.length===1?projectRecord(candidates[0],language,{allowTesting:testing}):null;
   if(!result){needsResearch.push(campus);continue;}
   results.push(result);hits.push({campus,batchId:candidates[0].batch_id,budgetId:candidates[0].budget_key,year:candidates[0].academic_year,benchmark:!scope.academicYear});
  }
  const result=combineCatalogResults(results,language);
  emit({stage:'cost_catalog',outcome:result?'hit':'no_match',hits:hits.length,missing:needsResearch.length,clarifications:clarifications.length,durationMs:now()-started});
  return {enabled:true,result,hits,needsResearch,clarifications};
 }};
}

// Application-owned comparison state. No narration, binder navigation or model
// request is generated here. Late completions cannot replace a newer selection.
export function createCostComparison({catalog,scope:initialScope={},language='en'}){
 let campuses=[],scope={...initialScope},revision=0,current=null;
 return {
  snapshot:()=>({campuses:[...campuses],scope:{...scope},revision,result:current}),
  async update({add=[],remove=[],scopeChanges={}}={}){
   const canonical=name=>costCampusName(name)||String(name),removed=new Set(remove.map(canonical));
   campuses=[...new Set([...campuses,...add.map(canonical)])].filter(c=>!removed.has(c));
   if(Object.keys(scopeChanges).length)current=null;
   scope={...scope,...scopeChanges};const requested=++revision;
   if(!campuses.length){current=null;return {revision:requested,result:null,hits:[],needsResearch:[],clarifications:[]};}
   const plan=await catalog.plan({campuses:[...campuses],scope:{...scope},language});
   if(requested!==revision)return {revision:requested,superseded:true};
   current=plan.result;return {...plan,revision:requested};
  },
 };
}

// Future research-tool seam: return known data first and let only genuine gaps
// use the existing research service. The caller owns publication/floor control.
// This module is not registered in the active application.
export function createCatalogResearchAdapter({catalog,research}){
 return {async start(request){
  const initial=await catalog.plan(request);
  if(!initial.enabled)return {initial,completion:research(request)};
  const completion=Promise.allSettled(initial.needsResearch.map(campus=>research({...request,campuses:[campus]})))
   .then(results=>({result:combineCatalogResults([initial.result,...results.filter(r=>r.status==='fulfilled').map(r=>r.value)].filter(Boolean),request.language||'en'),clarifications:initial.clarifications,
    failedCampuses:initial.needsResearch.filter((_,index)=>results[index].status==='rejected'||!results[index].value)}));
  return {initial,completion};
 }};
}

import {digest} from './postgres.mjs';

const hash=/^[a-f0-9]{64}$/u;
const categories=new Set(['Food','Housing','Housing and food combined']);
const sum=budget=>budget.payload.items.filter(i=>i.role==='Included component').reduce((n,i)=>{
 if(!Number.isSafeInteger(i.amount)||i.amount<0)throw Error('unresolved_component_cannot_be_corrected');
 return n+i.amount;
},0);

// An operator-reviewed amendment to an immutable import, never execution of the
// uploaded candidate's action strings. Unlisted records retain every hold.
export function applyCsuCorrections(batch,review){
 if(batch.version!=='csu-coa-workbook-staging-v1.0'||review.version!==1||review.kind!=='independently_reviewed_csu_corrections'||
  review.baseBatchId!==batch.id||review.sourceSha256!==batch.hash||!hash.test(review.candidateSha256||'')||
  !Number.isFinite(Date.parse(review.reviewedAt))||!Array.isArray(review.records)||!review.records.length||
  new Set(review.records.map(r=>r.budgetId)).size!==review.records.length)throw Error('explicit_matching_csu_review_required');
 const sources=new Map((review.sources||[]).map(s=>[s.id,s]));
 const amendments=new Map(review.records.map(r=>[r.budgetId,r]));
 const budgets=batch.budgets.map(original=>{
  const entry=amendments.get(original.key);if(!entry)return structuredClone(original);
  if(entry.expectedDigest!==digest(original.payload)||original.total!==entry.expectedTotalCents||original.sum!==entry.expectedIncludedSumCents||
   original.payload.issues.invalid?.length||!entry.sourceIds?.length||!entry.operations?.length||!entry.note?.en||!entry.note?.es)throw Error('csu_amendment_precondition_failed:'+original.key);
  const evidence=entry.sourceIds.map(id=>{
   const source=sources.get(id);let url;try{url=new URL(source?.url);}catch{throw Error('official_csu_evidence_required');}
   if(url.protocol!=='https:'||!/(?:^|\.)[a-z0-9-]+\.edu$/iu.test(url.hostname)||source.verified!==true||
    !Number.isFinite(Date.parse(source.checkedAt))||Date.parse(source.checkedAt)>Date.parse(review.reviewedAt)||!source.finding?.trim())throw Error('official_csu_evidence_required');
   return structuredClone(source);
  });
  const b=structuredClone(original),projection={};
  for(const operation of entry.operations||[]){
   if(operation.type==='display_population'){
    if(typeof operation.value!=='string'||!operation.value.trim()||operation.value.length>160)throw Error('invalid_population_display');
    projection.population=operation.value;
   }else if(operation.type==='category'){
    const item=b.payload.items.find(i=>i.key===operation.itemKey);
    if(!item||item.raw.Category!==operation.from||!categories.has(operation.to))throw Error('invalid_category_amendment');
    (projection.categoryOverrides||={})[item.key]=operation.to;
   }else if(operation.type==='omit_zero_placeholder'){
    const item=b.payload.items.find(i=>i.key===operation.itemKey);
    if(!item||item.role!=='Included component'||item.amount!==0||!['Housing','Food'].includes(item.raw.Category))throw Error('only_explicit_zero_placeholder_can_be_omitted');
    (projection.omittedZeroItemKeys||=[]).push(item.key);
   }else if(operation.type==='credential_fee'){
    const item=b.payload.items.find(i=>i.key===operation.itemKey);
    if(b.campus!=='Cal Poly Humboldt'||b.payload.raw['Student level']!=='Postbaccalaureate'||b.payload.raw['Program / degree']!=='General'||
     !item||item.amount!==operation.fromCents||operation.fromCents!==1093000||operation.toCents!==1039000)throw Error('credential_fee_scope_mismatch');
    item.amount=operation.toCents;
    // Source amount and Source checked stay unchanged. The correction's own
    // evidence/date is separate from the originally imported PDF assertion.
    b.payload.raw['Program / degree']='Teaching credential';
    b.payload.raw.Enrollment='6.1+ units per semester, fall and spring';
   }else throw Error('unsupported_csu_amendment_operation');
  }
  b.sum=sum(b);b.difference=b.total===null?null:b.total-b.sum;
  if(b.total===null||b.difference!==0)throw Error('csu_total_still_unresolved:'+b.key);
  b.bucket='reconciled';
  b.payload.catalogProjection=projection;
  b.payload.csuCorrection={version:1,baseBatchId:batch.id,originalDigest:entry.expectedDigest,reviewedAt:review.reviewedAt,
   operations:structuredClone(entry.operations),sources:evidence,note:structuredClone(entry.note)};
  // Keep flags and original scope text. This is a caveated local selection,
  // not blanket independent approval of the original workbook.
  if(b.payload.raw['Program / degree']!==original.payload.raw['Program / degree']||b.payload.raw.Enrollment!==original.payload.raw.Enrollment)
   b.scenario=digest({originalScenario:original.scenario,effectiveScope:{program:b.payload.raw['Program / degree'],enrollment:b.payload.raw.Enrollment}});
  return b;
 });
 if(review.records.some(r=>!batch.budgets.some(b=>b.key===r.budgetId)))throw Error('unknown_csu_amendment_record');
 const id=digest({version:'csu-reviewed-corrections-v1',baseBatchId:batch.id,review});
 return {...batch,id,budgets,report:{...batch.report,reviewedCorrections:{baseBatchId:batch.id,reviewDigest:digest(review),records:review.records.length}}};
}

import {publicationDigest as digest} from './publication.mjs';
import {catalogCostKey,projectRecord} from './catalog.mjs';

const nonresidentRates={'2026-27':3927000,'2025-26':3760200,'2024-25':3420000,'2023-24':3257400,'2022-23':3102600,'2021-22 or earlier':2975400};
const ucop='https://www.ucop.edu/operating-budget/_files/fees/202627/2026-27.pdf';
const noteFor=(record,discrepancy)=>discrepancy?{
 en:'Source subtotal differs from its listed components by $1,550; this estimate uses the listed components.',
 es:'El subtotal de la fuente difiere de sus partidas en $1,550; esta estimación usa las partidas.',
}:record.campus==='UC San Francisco'?{
 en:`Covers ${record.payload.raw['Coverage months']} months.`,es:`Cubre ${record.payload.raw['Coverage months']} meses.`,
}:undefined;

// Explicit, digest-bound amendments to an immutable UC publication. Preserve
// every raw amount, flag, scope, source date, source total and item role.
export function ucEstimateSnapshot(base,review){
 if(base.version!==1||review.version!==1||review.kind!=='reviewed_uc_estimate_selection'||review.baseBatchId!==base.batch.id||
  review.sourceSha256!==base.batch.source_sha256||!Number.isFinite(Date.parse(review.reviewedAt))||!review.records?.length||
  new Set(review.records.map(r=>r.budgetId)).size!==review.records.length)throw Error('explicit_uc_estimate_review_required');
 const entries=new Map(review.records.map(r=>[r.budgetId,r]));
 const selected=base.budgets.filter(b=>b.published_cents===null&&!b.payload.catalogEstimate);
 if(selected.length!==entries.size||selected.some(b=>!entries.has(b.budget_key)))throw Error('uc_estimate_selection_incomplete');
 const batchId=digest({version:'reviewed-uc-estimates-v1',baseBatchId:base.batch.id,review});
 const budgets=base.budgets.map(original=>{
  const entry=entries.get(original.budget_key),record=structuredClone(original);record.batch_id=batchId;
  if(!entry)return record;
  if(!['UC Berkeley','UC Irvine','UC San Francisco'].includes(record.campus)||record.published_cents!==null||record.payload.catalogEstimate||
   original.record_digest!==entry.expectedDigest||digest(original.payload)!==entry.expectedPayloadDigest||record.payload.issues.invalid?.length||
   !['derived','incomplete'].includes(record.bucket))throw Error('uc_estimate_source_hold:'+record.budget_key);
  const sourceReview=base.reviewEvidence.reviewNotes?.find(n=>n.values?.['Budget ID']===record.budget_key)?.values;
  if(record.bucket==='derived'&&!/Derivation verified/u.test(sourceReview?.['Review disposition']||''))throw Error('uc_derivation_review_required');
  const included=record.payload.items.filter(i=>i.role==='Included component'),unresolved=[];let cents=0;
  for(const item of included){
   const key=catalogCostKey(item.raw.Category);if(!key||item.issues.invalid.length)throw Error('unsupported_uc_component');
   if(item.amount===null){unresolved.push({key,category:item.raw.Category,label:item.raw['Original source label'],rate:null,unit:'',qualification:item.raw['Conditions / notes']||''});continue;}
   if(!Number.isSafeInteger(item.amount)||item.amount<0)throw Error('invalid_uc_amount');cents+=item.amount;
   if(item.raw.Category==='Nonresident supplemental tuition'&&item.amount!==nonresidentRates[record.payload.raw['Normalized cohort key']]&&record.campus!=='UC San Francisco')throw Error('uc_nonresident_rate_mismatch');
   if(item.raw['Verified budget-period override']!=null&&
    (item.raw['Verification URL']!==ucop||item.raw.Category!=='Nonresident supplemental tuition'||Math.round(item.raw['Verified budget-period override']*100)!==item.amount))throw Error('uc_override_review_required');
  }
  const basis=unresolved.length?'partial':'calculated';
  if(cents!==Number(record.components_cents)||cents!==entry.expectedKnownCents||basis!==entry.basis||
   basis==='partial'&&record.bucket!=='incomplete'||basis==='calculated'&&record.bucket!=='derived')throw Error('uc_estimate_arithmetic_mismatch');
  const discrepancy=String(record.payload.raw['Scope and exclusions']).includes('1,550');
  if(discrepancy!==review.uciDiscrepancyBudgetIds.includes(record.budget_key)||discrepancy&&record.campus!=='UC Irvine')throw Error('uc_discrepancy_review_required');
  const note=noteFor(record,discrepancy);
  if(basis==='partial'&&(record.campus!=='UC San Francisco'||!Number.isInteger(record.payload.raw['Coverage months'])||record.payload.raw['Coverage months']<1))throw Error('uc_partial_scope_required');
  record.payload.catalogEstimate={version:1,basis,amount:cents/100,unresolved,baseBatchId:base.batch.id,originalDigest:entry.expectedDigest,
   reviewedAt:review.reviewedAt,reviewBasis:'reviewed_catalog_components',...(note?{note}:{})};
  record.record_digest=digest(record.payload);
  return record;
 });
 const result={...structuredClone(base),batch:{...structuredClone(base.batch),id:batchId,imported_at:review.reviewedAt,
  report:{...structuredClone(base.batch.report),ucEstimates:{reviewDigest:digest(review),calculated:review.records.filter(r=>r.basis==='calculated').length,partial:review.records.filter(r=>r.basis==='partial').length}}},
  budgets,items:base.items.map(item=>({...structuredClone(item),batch_id:batchId})),
  // Keep the prior source-review boundary and expiry. Reviewing arithmetic
  // today must not imply every underlying university page was rechecked today.
  sourceReviewedAt:base.sourceReviewedAt,validUntil:base.validUntil,
  reviewEvidence:{...structuredClone(base.reviewEvidence),estimateReview:review},
  publication:{basis:'user_authorized_with_caveats',records:budgets.map(b=>({key:b.budget_key,digest:b.record_digest}))}};
 for(const record of budgets)for(const language of ['en','es']){
  if(!projectRecord({...record,caveated_publication:true,source_reviewed_at:result.sourceReviewedAt,valid_until:result.validUntil},language,{allowTesting:true,now:Date.parse(review.reviewedAt)}))throw Error('uc_projection_rejected:'+record.budget_key);
 }
 return result;
}

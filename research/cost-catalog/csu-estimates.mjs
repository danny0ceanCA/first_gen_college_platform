import {digest} from './postgres.mjs';
import {catalogCostKey} from './catalog.mjs';

// A reviewed, explicit selection. No balancing items, inferred unit loads,
// published-total replacements, formula evaluation or source-conflict bypass.
export function applyCsuEstimates(batch,review){
 if(review.version!==1||review.kind!=='local_csu_estimate_selection'||review.baseBatchId!==batch.report.reviewedCorrections?.baseBatchId||
  review.sourceSha256!==batch.hash||!Number.isFinite(Date.parse(review.reviewedAt))||!review.records?.length||
  new Set(review.records.map(r=>r.budgetId)).size!==review.records.length)throw Error('explicit_csu_estimate_selection_required');
 const entries=new Map(review.records.map(r=>[r.budgetId,r]));
 const budgets=batch.budgets.map(original=>{
  const entry=entries.get(original.key);if(!entry)return structuredClone(original);
  if(review.disputedBudgetIds?.includes(original.key))throw Error('disputed_csu_total_stays_held');
  if(digest(original.payload)!==entry.expectedDigest||original.total!==null||!['derived','incomplete'].includes(original.bucket)||
   original.payload.issues.invalid?.length||/source conflict/iu.test(original.payload.raw['Scope and exclusions']||''))throw Error('csu_estimate_source_hold:'+original.key);
  const override=(original.payload.issues.review||[]).some(flag=>flag==='explicit_source_override_requires_review');
  if(override&&!(entry.reviewedOverride?.url==='https://bursar.sdsu.edu/tuition'&&entry.reviewedOverride.annualAmountCents===310800&&
   ['CSU-0774','CSU-0775'].includes(original.key)&&original.payload.items.some(i=>i.amount===310800&&i.raw['Verification URL']===entry.reviewedOverride.url)))throw Error('csu_estimate_override_hold');
  if((original.payload.issues.review||[]).some(flag=>!['workbook_source_review_required','housing_scope_requires_review',...(override?['explicit_source_override_requires_review']:[])].includes(flag)))throw Error('csu_estimate_review_hold');
  const b=structuredClone(original),included=b.payload.items.filter(i=>i.role==='Included component');let cents=0;const unresolved=[];
  for(const item of included){
   const key=catalogCostKey(item.raw.Category);if(!key)throw Error('unsupported_estimate_category');
   if(item.amount!==null){if(!Number.isSafeInteger(item.amount)||item.amount<0)throw Error('invalid_estimate_amount');cents+=item.amount;continue;}
   const rate=item.raw['Unit rate'];
   unresolved.push({key,category:item.raw.Category,label:item.raw['Original source label'],rate:Number.isFinite(rate)&&rate>=0?rate:null,
    unit:String(item.raw['Rate unit']||''),qualification:String(item.raw['Conditions / notes']||'')});
  }
  const basis=unresolved.length?'partial':'calculated';
  if(cents!==b.sum||entry.expectedKnownCents!==cents||entry.basis!==basis||basis==='calculated'&&b.bucket!=='derived'||basis==='partial'&&b.bucket!=='incomplete')throw Error('csu_estimate_arithmetic_mismatch');
  if(entry.omittedZeroItemKeys?.length){
   const url={'San Francisco State University':'https://www.sfsu.edu/departments/financial-aid/cost-attendance','San José State University':'https://www.sjsu.edu/faso/process/cost-of-attendance.php'}[b.campus];
   if(!url||entry.combinedLivingSource!==url||!included.some(i=>i.raw.Category==='Housing and food combined'&&i.amount>0)||
    entry.omittedZeroItemKeys.some(key=>!included.some(i=>i.key===key&&i.amount===0&&['Housing','Food'].includes(i.raw.Category))))throw Error('combined_living_source_review_required');
  }
  b.payload.catalogEstimate={version:1,basis,amount:cents/100,unresolved,baseBatchId:review.baseBatchId,
   originalDigest:entry.expectedDigest,reviewedAt:review.reviewedAt,reviewBasis:'workbook_reported',...(override?{reviewedOverride:entry.reviewedOverride}:{}),
   ...(entry.omittedZeroItemKeys?.length?{omittedZeroItemKeys:entry.omittedZeroItemKeys,combinedLivingSource:entry.combinedLivingSource}:{})};
  return b;
 });
 if(review.records.some(r=>!batch.budgets.some(b=>b.key===r.budgetId)))throw Error('unknown_csu_estimate_record');
 return {...batch,id:digest({version:'local-csu-estimates-v1',baseBatchId:batch.id,review}),budgets,
  report:{...batch.report,catalogEstimates:{reviewDigest:digest(review),calculated:review.records.filter(r=>r.basis==='calculated').length,partial:review.records.filter(r=>r.basis==='partial').length}}};
}

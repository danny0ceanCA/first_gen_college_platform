import {digest} from './postgres.mjs';
import {projectRecord} from './catalog.mjs';

// A publication is an explicit selection, never a change to immutable imported
// values, source-review dates, flags, or the strict independent-approval view.
export function csuPublicationSnapshot(batch,{reviewedAt,validUntil}={}){
 if(batch.version!=='csu-coa-workbook-staging-v1.0'||!batch.budgets.length||
  !Number.isFinite(Date.parse(reviewedAt))||!Number.isFinite(Date.parse(validUntil))||Date.parse(validUntil)<=Date.parse(reviewedAt))throw Error('csu_review_required');
 const held=[],accepted=[];
 for(const b of batch.budgets){
  const reasons=[];
  if(b.bucket!=='reconciled'||b.total===null||Math.abs(b.difference||0)>1)reasons.push('amounts_need_review');
  if(b.payload.issues.invalid?.length)reasons.push('invalid_source_or_scope');
  if((b.payload.issues.review||[]).some(flag=>!['workbook_source_review_required','housing_scope_requires_review'].includes(flag)))reasons.push('source_override_needs_review');
  if(/source conflict/iu.test(b.payload.raw['Scope and exclusions']||''))reasons.push('source_conflict');
  if(b.payload.raw['Budget period']!=='Academic year')reasons.push('period_needs_review');
  if(reasons.length){held.push({budgetId:b.key,campus:b.campus,reasons});continue;}
  accepted.push(b);
 }
 if(!accepted.length)throw Error('no_publishable_csu_records');
 const candidates=accepted.map(b=>({batch_id:batch.id,budget_key:b.key,scenario_key:b.scenario,campus:b.campus,academic_year:b.year,
  bucket:b.bucket,flagged:b.flagged,eligible_for_review:!b.flagged,published_cents:b.total,components_cents:b.sum,difference_cents:b.difference,
  payload:b.payload,record_digest:digest(b.payload)}));
 const budgets=candidates.filter(b=>{
  const row={...b,caveated_publication:true,source_reviewed_at:reviewedAt,valid_until:validUntil};
  if(projectRecord(row,'en',{allowTesting:true,now:Date.parse(reviewedAt)})&&projectRecord(row,'es',{allowTesting:true,now:Date.parse(reviewedAt)}))return true;
  held.push({budgetId:b.budget_key,campus:b.campus,reasons:['unsupported_budget_projection']});return false;
 });
 const selected=new Set(budgets.map(b=>b.budget_key));
 if(!selected.size)throw Error('no_publishable_csu_records');
 const items=accepted.filter(b=>selected.has(b.key)).flatMap(b=>b.payload.items.map(i=>({batch_id:batch.id,budget_key:b.key,item_key:i.key,
  amount_cents:i.amount,raw_amount:i.rawAmount,period_factor:i.factor,role:i.role,payload:i})));
 return {version:1,batch:{id:batch.id,source_sha256:batch.hash,importer_version:batch.version,imported_at:reviewedAt,report:batch.report},
  budgets,items,sourceReviewedAt:reviewedAt,validUntil,
  reviewEvidence:{sourceSha256:batch.hash,reviewBasis:'workbook_reported',independentlyVerified:false,
   note:'User authorized production catalog. Reconciled source-backed workbook records retain original dates, scope, enrollment and caveats; unresolved amounts and source overrides are withheld.',held},
  publication:{basis:'user_authorized_with_caveats',records:budgets.map(b=>({key:b.budget_key,digest:b.record_digest}))}};
}

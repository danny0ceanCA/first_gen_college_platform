import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStaging} from '../research/cost-catalog/postgres.mjs';
import {applyCsuCorrections} from '../research/cost-catalog/csu-corrections.mjs';
import {applyCsuEstimates} from '../research/cost-catalog/csu-estimates.mjs';
import {csuPublicationSnapshot} from '../research/cost-catalog/csu-publication.mjs';

// File preparation only. No environment credentials or database connections.
export async function prepareCsuEstimates(directory){
 const correction=JSON.parse(await readFile(new URL('../research/cost-catalog/reviews/csu-20261115.json',import.meta.url),'utf8'));
 const review=JSON.parse(await readFile(new URL('../research/cost-catalog/reviews/csu-estimates-20261115.json',import.meta.url),'utf8'));
 const original=readStaging(correction.baseBatchId,'csu-coa-staging.sqlite');
 const corrected=applyCsuCorrections(original,correction),batch=applyCsuEstimates(corrected,review);
 const settings={reviewedAt:review.reviewedAt,validUntil:'2026-12-12T00:00:00.000Z'};
 const before=csuPublicationSnapshot(corrected,settings),snapshot=csuPublicationSnapshot(batch,{...settings,allowEstimates:true});
 const byId=new Map(snapshot.budgets.map(b=>[b.budget_key,b]));
 for(const old of before.budgets)if(byId.get(old.budget_key)?.record_digest!==old.record_digest)throw Error('existing_csu_payload_would_change');
 for(const key of review.disputedBudgetIds)if(byId.has(key))throw Error('disputed_csu_total_would_be_released');
 const selected=review.records.filter(r=>byId.has(r.budgetId));
 snapshot.reviewEvidence={...snapshot.reviewEvidence,reviewBasis:'workbook_reported_with_explicit_estimate_basis',independentlyVerified:false,
  note:review.note,estimateReview:review,correctionReviewDigest:batch.report.reviewedCorrections.reviewDigest,
  calculatedRecords:selected.filter(r=>r.basis==='calculated').map(r=>r.budgetId),partialRecords:selected.filter(r=>r.basis==='partial').map(r=>r.budgetId)};
 const receipt={baseBatchId:original.id,estimateBatchId:batch.id,sourceSha256:batch.hash,reviewedAt:review.reviewedAt,
  before:before.budgets.length,after:snapshot.budgets.length,calculated:snapshot.reviewEvidence.calculatedRecords.length,partial:snapshot.reviewEvidence.partialRecords.length,
  held:snapshot.reviewEvidence.held,projectionHolds:review.records.filter(r=>!byId.has(r.budgetId)).map(r=>r.budgetId),productionChanged:false};
 await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'csu-snapshot.json'),JSON.stringify(snapshot));
 await writeFile(join(directory,'selection.json'),JSON.stringify(receipt,null,2)+'\n');
 return {snapshot,receipt};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('local-output-directory required');
 const {receipt:r}=await prepareCsuEstimates(resolve(process.argv[2]));
 console.log(JSON.stringify({before:r.before,after:r.after,calculated:r.calculated,partial:r.partial,held:r.held.length,projectionHolds:r.projectionHolds,productionChanged:false}));
}

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStaging} from '../research/cost-catalog/postgres.mjs';
import {applyCsuCorrections} from '../research/cost-catalog/csu-corrections.mjs';
import {csuPublicationSnapshot} from '../research/cost-catalog/csu-publication.mjs';

// This command only reads the original SQLite import and writes a new local
// selection. It has no database URL, publication, server or deployment action.
export async function prepareCsuCorrections(directory){
 const review=JSON.parse(await readFile(new URL('../research/cost-catalog/reviews/csu-20261115.json',import.meta.url),'utf8'));
 const original=readStaging(review.baseBatchId,'csu-coa-staging.sqlite');
 const batch=applyCsuCorrections(original,review);
 const snapshot=csuPublicationSnapshot(batch,{reviewedAt:review.reviewedAt,validUntil:'2026-12-12T00:00:00.000Z'});
 snapshot.reviewEvidence={...snapshot.reviewEvidence,reviewBasis:'mixed_workbook_and_record_scoped_independent_review',
  independentlyVerified:false,reviewDigest:batch.report.reviewedCorrections.reviewDigest,independentlyReviewedRecords:review.records.map(r=>r.budgetId),
  supportedOverridesStillHeld:review.verifiedOverridesStillHeld,
  note:'Local correction selection only. Exactly 24 records have scoped official-source reviews. Original workbook dates, flags and historical source values are retained; all unlisted unresolved records remain held.'};
 const originalSelection=csuPublicationSnapshot(original,{reviewedAt:review.reviewedAt,validUntil:snapshot.validUntil});
 const before=new Set(originalSelection.budgets.map(b=>b.budget_key)),after=new Set(snapshot.budgets.map(b=>b.budget_key));
 if([...before].some(key=>!after.has(key)))throw Error('existing_csu_selection_would_be_removed');
 const newlyAvailable=snapshot.budgets.filter(b=>!before.has(b.budget_key)).map(b=>b.budget_key);
 if(newlyAvailable.length!==review.records.length||newlyAvailable.some(key=>!review.records.some(r=>r.budgetId===key)))throw Error('unexpected_csu_selection_change');
 const receipt={baseBatchId:original.id,correctedBatchId:batch.id,sourceSha256:batch.hash,reviewedAt:review.reviewedAt,
  beforeRecords:before.size,afterRecords:after.size,newlyAvailable,held:snapshot.reviewEvidence.held,
  supportedOverridesStillHeld:review.verifiedOverridesStillHeld,productionChanged:false};
 await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'csu-snapshot.json'),JSON.stringify(snapshot));
 await writeFile(join(directory,'selection.json'),JSON.stringify(receipt,null,2)+'\n');
 return {snapshot,receipt};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Use prepare-csu-corrections.mjs <local-output-directory>');
 const {receipt:r}=await prepareCsuCorrections(resolve(process.argv[2]));
 console.log(JSON.stringify({before:r.beforeRecords,after:r.afterRecords,newlyAvailable:r.newlyAvailable.length,held:r.held.length,productionChanged:false}));
}

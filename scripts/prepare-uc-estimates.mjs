import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ucEstimateSnapshot} from '../research/cost-catalog/uc-estimates.mjs';

// File-only preparation. Publication is a separate authorized operation.
export async function prepareUcEstimates(base,directory){
 const review=JSON.parse(await readFile(new URL('../research/cost-catalog/reviews/uc-estimates-20261115.json',import.meta.url),'utf8'));
 const snapshot=ucEstimateSnapshot(base,review);
 const receipt={baseBatchId:base.batch.id,batchId:snapshot.batch.id,records:snapshot.budgets.length,calculated:45,partial:14,
  amended:review.records.map(r=>r.budgetId),sourceReviewedAt:snapshot.sourceReviewedAt,validUntil:snapshot.validUntil,productionChanged:false};
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'uc-snapshot.json'),JSON.stringify(snapshot));
 await writeFile(join(directory,'selection.json'),JSON.stringify(receipt,null,2));return {snapshot,receipt};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2]||!process.argv[3])throw Error('base_snapshot_and_output_directory_required');
 const base=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
 const {receipt}=await prepareUcEstimates(base,resolve(process.argv[3]));console.log(JSON.stringify(receipt));
}

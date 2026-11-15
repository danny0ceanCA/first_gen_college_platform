import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readStaging} from '../research/cost-catalog/postgres.mjs';
import {csuPublicationSnapshot} from '../research/cost-catalog/csu-publication.mjs';
import {fileURLToPath} from 'node:url';

export async function prepareCsuCatalog(directory){
 const batch=readStaging('cf0fe03601395617ac6a73981dd338058ba9244b51a2825ce7b14fa508d3d84a','csu-coa-staging.sqlite');
 const reviewedAt=new Date().toISOString(),validUntil='2026-12-12T00:00:00.000Z';
 const snapshot=csuPublicationSnapshot(batch,{reviewedAt,validUntil});
 await mkdir(directory,{recursive:true});
 const path=join(directory,'csu-snapshot.json');await writeFile(path,JSON.stringify(snapshot));
 const receipt={sourceSha256:batch.hash,batchId:batch.id,reviewedAt,validUntil,
  publishedRecords:snapshot.budgets.length,items:snapshot.items.length,held:snapshot.reviewEvidence.held,
  campuses:[...new Set(snapshot.budgets.map(b=>b.campus))],sourceReview:'Workbook-reported dates retained; publication is not independent verification of every figure.'};
 await writeFile(join(directory,'selection.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({path,records:receipt.publishedRecords,held:receipt.held.length,campuses:receipt.campuses.length}));
 return snapshot;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv[2]!=='prepare'||!process.argv[3])throw Error('Use prepare <output-directory>; this never accesses production');
 await prepareCsuCatalog(resolve(process.argv[3]));
}

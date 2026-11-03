import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {evaluateRecommendationPolicy} from '../server/recommendation-policy-review.mjs';
const result=evaluateRecommendationPolicy(),path=resolve(process.argv[2]||'/tmp/origen-recommendation-policy-review.json');
await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,matched:result.matched,comparisons:result.comparisons.length,syntheticOnly:true,output:path}));
if(!result.passed)process.exitCode=1;

import {writeFile} from 'node:fs/promises';
import {reviewOutcomeDefinitions} from '../ops/outcome-definition-review.mjs';
const [file]=process.argv.slice(2);if(process.argv.length!==3||!file.endsWith('.json'))throw Error('Usage: node scripts/review-outcome-definitions.mjs <new-output.json>');
const result=reviewOutcomeDefinitions();await writeFile(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;

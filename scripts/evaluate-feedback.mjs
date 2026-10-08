import {mkdir,writeFile} from 'node:fs/promises';
import {evaluateFeedback} from '../server/feedback-evaluation.mjs';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--live'))throw Error('Usage: npm run eval:feedback -- [--live]');
const report=await evaluateFeedback({live:args.includes('--live'),env:process.env});
await mkdir('output',{recursive:true});
await writeFile('output/feedback-evaluation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({checked:report.checked,notRun:report.notRun,failed:report.failed,precision:report.precision,recall:report.recall,report:'output/feedback-evaluation.json'}));
if(report.failed)process.exitCode=1;

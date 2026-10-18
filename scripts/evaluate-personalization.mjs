import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {personalizationBaseline} from '../server/personalization-evaluation.mjs';

const args=process.argv.slice(2);
if(args.length&&(args[0]!=='--output'||args.length!==2))throw new Error('Use --output path/to/report.json');
const output=args[1]||'output/personalization-evaluation.json';
const report=await personalizationBaseline();
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sampleSize:report.sampleSize,answerableCases:report.answerableCases,casesWithRequiredEvidence:report.casesWithRequiredEvidence,boundaryFailures:report.boundaryFailures,output}));
if(report.boundaryFailures.length)process.exitCode=1;

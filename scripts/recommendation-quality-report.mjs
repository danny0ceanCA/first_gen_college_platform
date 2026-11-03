import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {recommendationQualityReport} from '../server/recommendation-evaluation-quality.mjs';
import {syntheticRecommendationEvaluationRows} from '../server/fixtures/recommendation-evaluation-cases.mjs';
const output=resolve(process.argv[2]||'/tmp/origen-recommendation-quality.json');if(!output.endsWith('.json'))throw Error('A .json output path is required.');
const report=recommendationQualityReport(syntheticRecommendationEvaluationRows(),{period:'2026-10',synthetic:true});await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
const lines=['# Synthetic recommendation quality report','','All records are invented. This artifact does not use student data or measure Origen’s effectiveness.','',`Policy: ${report.policyVersion}. Cohort: ${report.period}. Participants: ${report.participants}; selection receipts: ${report.selections}.`,'','| Observed measure | Count | Selection denominator |','| --- | ---: | ---: |',...Object.entries(report.metrics).map(([name,m])=>`| ${name.replaceAll('_',' ')} | ${m.suppressed?'Suppressed':m.count} | ${m.suppressed?'—':m.denominator} |`),'',report.missingness,'',...report.limitations.map(s=>'- '+s),'','A reported outcome is attributed student evidence. These counts are not a causal success rate or grounds to promote a policy automatically.'];
await writeFile(output.replace(/\.json$/,'.md'),lines.join('\n')+'\n');console.log(JSON.stringify({synthetic:true,output,status:report.status}));

import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {coordinatorSourceFingerprint} from '../ops/coordinator-readiness.mjs';
import {compareRecommendationPolicies} from '../server/recommendation-evaluation-reference.mjs';
// Optional candidate must be an explicitly supplied local, reviewed module.
// Never imports a module named by a student, model, report or network response.
const args=process.argv.slice(2),output=resolve(args[0]||'/tmp/origen-recommendation-comparison.json');let options={},candidateDigest=null;
if(args[1]){const path=resolve(args[1]),bytes=await readFile(path),module=await import(pathToFileURL(path));candidateDigest=createHash('sha256').update(bytes).digest('hex');options={candidate:module.decideRecommendation,candidateVersion:module.policyVersion};if(typeof options.candidate!=='function'||!options.candidateVersion)throw Error('candidate_contract_required');}
const sourceFingerprint=await coordinatorSourceFingerprint();const report={...compareRecommendationPolicies(options),candidateDigest,sourceFingerprint};if(await coordinatorSourceFingerprint()!==sourceFingerprint)throw Error('comparison_source_changed');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,referenceDigest:report.referenceDigest,development:report.partition.development,heldout:report.partition.heldout,promoted:false,output}));if(!report.passed)process.exitCode=1;

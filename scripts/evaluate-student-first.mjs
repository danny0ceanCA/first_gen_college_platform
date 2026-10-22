// Offline preparation/review only. Never calls a provider, loads .env, enables
// features, or treats a self-supplied review as an independently verified receipt.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {hash,reviewResponses} from '../server/model-evaluation.mjs';
import {coordinatorSourceFingerprint} from '../ops/coordinator-readiness.mjs';
import {studentFirstCatalog as catalog,studentFirstRubric as rubric} from '../evals/student-first.cases.v1.mjs';

export const evaluationFlags=Object.freeze({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',ORIGEN_PERSONALIZATION_RETRIEVAL:'true',ORIGEN_PERSONALIZATION_LIVE_WRITES:'true',ORIGEN_PERSONALIZATION_ADAPTIVE:'true',ORIGEN_VOICE_PREPARATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_CORRECTIONS:'true',ORIGEN_GUIDED_CONVERSATION:'true',ORIGEN_CONVERSATION_CONTINUITY:'true',ORIGEN_CONVERSATION_RECOVERY:'true',ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true',ORIGEN_COORDINATOR_BINDER_VIEWING:'true',ORIGEN_COORDINATOR_FEEDBACK:'true',ORIGEN_DERIVED_BINDER_SHARING:'true',ORIGEN_COORDINATOR_FOLLOW_THROUGH:'true'});
export async function candidateEvidence(){
 const files=['render.yaml','evals/student-first.cases.v1.mjs'];
 const sourceFingerprint=hash([await coordinatorSourceFingerprint(),...await Promise.all(files.map(async file=>[file,(await readFile(new URL('../'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n')]))]);
 return {sourceFingerprint,flags:evaluationFlags,catalogHash:hash(catalog),rubricHash:hash(rubric)};
}
export function reviewStudentFirst(capture,candidate){
 const flags=value=>Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b));
 if(capture?.sourceFingerprint!==candidate.sourceFingerprint||hash(flags(capture.flags))!==hash(flags(candidate.flags)))throw Error('Candidate source/flags changed or missing; capture against the same candidate.');
 if(!/^\d{4}-\d{2}-\d{2}T/.test(capture.capturedAt||'')||!capture.environmentRef?.trim()||!capture.budgetApprovedBy?.trim())throw Error('Capture time, synthetic environment reference and adopted-budget owner required.');
 for(const response of capture.responses||[]){
  if(!/^[a-f\d]{64}$/.test(response.configurationHash||'')||!response.audioEvidenceRef?.trim()||!response.providerReceiptRef?.trim()||!response.timingMethod?.trim())throw Error('Each response needs configuration, audio, provider receipt and timing evidence references.');
 }
 const report=reviewResponses(catalog,rubric,capture);
 return {...report,sourceFingerprint:candidate.sourceFingerprint,flags:candidate.flags,releaseReady:false,limitations:report.limitations+' Evidence references and human identity are declarations; a named release reviewer must inspect the actual recordings, receipts, deployment and flags. This does not approve proposed thresholds or deployment.'};
}
export function captureTemplate(candidate){return {synthetic:true,...candidate,capturedAt:null,environmentRef:null,budgetApprovedBy:null,costBudgetUSD:null,responses:catalog.cases.map(c=>({id:c.id,prompt:c.prompt,setup:c.setup,expectedBehavior:c.expectedBehavior,text:null,configurationHash:null,providerModel:null,providerReceiptRef:null,audioEvidenceRef:null,timingMethod:null,firstAudioMs:null,costUSD:null,usage:null,pricingAsOf:null,researchCalls:null,sources:[],toolTrace:[],reviews:[]}))};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command='template',path]=process.argv.slice(2),candidate=await candidateEvidence();let result;
 if(command==='template')result=captureTemplate(candidate);
 else if(command==='review'&&path)result=reviewStudentFirst(JSON.parse(await readFile(path,'utf8')),candidate);
 else throw Error('Use template, or review <completed-synthetic-capture.json>.');
 console.log(JSON.stringify(result,null,2));if(result.technicalGatePassed===false)process.exitCode=1;
}

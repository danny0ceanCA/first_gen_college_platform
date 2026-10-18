import {readFile} from 'node:fs/promises';
import {hash,reviewResponses,evaluationDefinitions} from './model-evaluation.mjs';
import {releaseCatalog,releaseRubric} from '../evals/personalization.release.v1.mjs';

const finite=n=>Number.isFinite(n)&&n>=0;
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
const p95=xs=>xs.length?[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*.95)-1]:null;
export async function releaseDefinitions(){const {rubric}=await evaluationDefinitions();return {catalog:releaseCatalog,rubric:releaseRubric(rubric)};}
export async function releaseSourceHashes(){
 const paths=['server/profile-voice.mjs','server/student-memory.mjs','server/history-retrieval.mjs','server/live-memory.mjs','server/live-memory-tools.mjs','server/live-memory-intent.mjs','server/adaptive-guidance.mjs','server/personalization-controls.mjs','server/voice-workspace.mjs','server/plans.mjs','src/ProfileVoice.tsx','src/voiceMemoryTools.mjs','src/voiceTurns.mjs','server/migrations/044_student_memory.sql','server/migrations/045_historical_retrieval.sql','server/migrations/046_live_memory.sql','server/migrations/047_adaptive_guidance.sql','server/voice-preparation.mjs','server/binder-jobs.mjs','server/topic-notes.mjs','server/history.mjs','server/maintenance-database.mjs','src/voiceStartup.mjs','server/migrations/048_voice_preparation.sql','server/migrations/049_binder_jobs.sql'];
 return Object.fromEntries(await Promise.all(paths.map(async path=>[path,hash(await readFile(new URL('../'+path,import.meta.url),'utf8'))])));
}
export function captureTemplate(catalog,rubric,arm,sourceHashes){return {
 formatVersion:1,synthetic:true,kind:'live-personalization-speech',arm,
 catalogHash:hash(catalog),rubricHash:hash(rubric),sourceHashes,
 budget:{usd:null,authorizedBy:null,authorizedAt:null},costBudgetUSD:null,
 captureProtocol:'End of user speech to first audible playback; retrieval wall time; all provider operations in every attempt including summaries/extraction/research and cancelled/failed attempts. No mocked providers. Human listening review required.',
 attempts:[],responses:[],
};}

// Rates come from dated provider pricing, not assumptions about model names.
// Separate usage meters avoid silently billing audio as text or ignoring retries.
export function meteredCost(meters){
 if(!Array.isArray(meters)||!meters.length)return null;
 let total=0;
 for(const m of meters){
  if(!nonempty(m.providerModel)||!nonempty(m.providerRequestId)||!/^https:\/\//.test(m.pricingURL||'')||!/^\d{4}-\d{2}-\d{2}$/.test(m.pricingAsOf||''))return null;
  const keys=Object.keys(m.usage||{});if(!keys.length||!keys.every(k=>finite(m.usage[k])&&finite(m.usdPerMillion?.[k])))return null;
  total+=keys.reduce((sum,k)=>sum+m.usage[k]*m.usdPerMillion[k]/1e6,0);
 }
 return total;
}

export function reviewPersonalization(catalog,rubric,capture){
 if(capture?.kind!=='live-personalization-speech'||!['baseline','candidate'].includes(capture.arm))throw new Error('A live speech capture and baseline/candidate arm are required');
 const report=reviewResponses(catalog,rubric,capture),missing=[...report.missingEvidence],failures=[...report.failures];
 const attempts=capture.attempts||[],known=new Set(catalog.cases.map(c=>c.id)),ids=new Set(),receipts=new Set(),costs=[],delays=[];
 const budget=capture.budget;
 if(!finite(budget?.usd)||budget.usd<=0||!nonempty(budget.authorizedBy)||!Number.isFinite(Date.parse(budget.authorizedAt))||capture.costBudgetUSD!==budget.usd)missing.push('dated-budget-authorization');
 if(!capture.sourceHashes||!Object.keys(capture.sourceHashes).length||!Object.values(capture.sourceHashes).every(v=>/^[a-f0-9]{64}$/.test(v)))missing.push('source-provenance');
 for(const a of attempts){
  if(!nonempty(a.id)||ids.has(a.id)||!known.has(a.caseId))throw new Error('Unique attempts with known case IDs required');ids.add(a.id);
  if(!['completed','failed','cancelled'].includes(a.status))missing.push(`${a.id}:terminal-status`);
  if(!Number.isInteger(a.completedSessions)||a.completedSessions<0||a.status==='completed'&&a.completedSessions<1)missing.push(`${a.id}:completed-session-count`);
  if(!Number.isFinite(Date.parse(a.startedAt))||Date.parse(a.startedAt)<Date.parse(budget?.authorizedAt))missing.push(`${a.id}:budget-before-attempt`);
  if(a.providerCallsComplete!==true||a.transport!=='webrtc-live'||!nonempty(a.device))missing.push(`${a.id}:live-complete-usage`);
  const cost=meteredCost(a.meters);if(cost===null)missing.push(`${a.id}:provider-usage-and-pricing`);else costs.push(cost);
  for(const m of a.meters||[]){if(receipts.has(m.providerRequestId))failures.push(`${a.id}:duplicate-provider-receipt`);receipts.add(m.providerRequestId);}
 }
 const responseIds=new Set();
 for(const r of capture.responses){
  const a=attempts.find(a=>a.id===r.attemptId&&a.caseId===r.id&&a.status==='completed');
  if(!a||a.device!==r.device||responseIds.has(r.attemptId))missing.push(`${r.id}:completed-attempt`);responseIds.add(r.attemptId);
  if(!finite(r.retrievalMs))missing.push(`${r.id}:retrieval-timing`);else delays.push(r.retrievalMs);
  if(!Number.isInteger(r.unnecessaryRepeatedQuestions)||r.unnecessaryRepeatedQuestions<0)missing.push(`${r.id}:repeated-question-count`);
  else if(r.unnecessaryRepeatedQuestions>0)failures.push(`${r.id}:unnecessary-repeated-questions`);
  if(r.listenedToAudio!==true)missing.push(`${r.id}:human-listening`);
  if(r.id.startsWith('durable-action-')){
   const e=r.persistenceEvidence;
   if(!e||typeof e.saved!=='boolean'||!Number.isInteger(e.duplicateCount)||e.duplicateCount<0||e.secondSessionVerified!==true||e.saved&&(!nonempty(e.recordId)||!Number.isInteger(e.version)||!nonempty(e.status)))missing.push(`${r.id}:persistence-evidence`);
   else if(!e.saved||e.duplicateCount!==1||e.status!=='not-started')failures.push(`${r.id}:action-not-persisted-once`);
  }
  // Per-response cost must include all failed/retried attempts for that case.
  const caseCosts=attempts.filter(a=>a.caseId===r.id).map(a=>meteredCost(a.meters));
  if(caseCosts.some(c=>c===null)||Math.abs(caseCosts.reduce((sum,c)=>sum+(c||0),0)-r.costUSD)>0.000001)missing.push(`${r.id}:retry-cost-reconciliation`);
 }
 for(const a of attempts)if(a.status==='completed'&&!responseIds.has(a.id))missing.push(`${a.id}:unreviewed-completed-attempt`);
 const totalCostUSD=costs.length===attempts.length&&attempts.length?costs.reduce((a,b)=>a+b,0):null;
 const completed=attempts.filter(a=>a.status==='completed').length;
 const completedSessions=attempts.every(a=>Number.isInteger(a.completedSessions)&&a.completedSessions>=0)?attempts.reduce((sum,a)=>sum+a.completedSessions,0):null;
 const meanSessionCostUSD=totalCostUSD!==null&&completedSessions?totalCostUSD/completedSessions:null;
 if(totalCostUSD!==null&&finite(budget?.usd)&&totalCostUSD>budget.usd)failures.push('all-attempts-cost-budget');
 if(meanSessionCostUSD!==null&&meanSessionCostUSD>rubric.thresholds.maxMeanSessionCostUSD)failures.push('mean-session-cost');
 const retrievalP95Ms=p95(delays);if(retrievalP95Ms!==null&&retrievalP95Ms>rubric.thresholds.maxP95RetrievalMs)failures.push('p95-retrieval');
 const unrun=catalog.cases.filter(c=>!capture.responses.some(r=>r.id===c.id)).map(c=>c.id);
 return {...report,arm:capture.arm,totalCostUSD,meanSessionCostUSD,retrievalP95Ms,attemptCount:attempts.length,completedAttempts:completed,completedSessions,failedOrCancelledAttempts:attempts.length-completed,unrunCases:unrun,failures,missingEvidence:missing,
  languages:Object.fromEntries(['en','es'].map(language=>[language,{expected:catalog.cases.filter(c=>c.language===language).length,reviewed:capture.responses.filter(r=>catalog.cases.find(c=>c.id===r.id)?.language===language&&r.reviews?.some(v=>v.type==='human')).length}])),
  technicalGatePassed:!failures.length&&!missing.length&&!report.disagreements.length,releaseReady:false,
 };
}

export function comparePersonalization(catalog,rubric,baseline,candidate){
 const before=reviewPersonalization(catalog,rubric,baseline),after=reviewPersonalization(catalog,rubric,candidate);
 if(baseline.arm!=='baseline'||candidate.arm!=='candidate')throw new Error('Baseline then candidate required');
 const missing=[];
 if(hash(baseline.sourceHashes)!==hash(candidate.sourceHashes))missing.push('unmatched-source-build');
 for(const c of catalog.cases){
  const a=baseline.responses.find(r=>r.id===c.id),b=candidate.responses.find(r=>r.id===c.id);
  if(a&&b&&a.configurationHash===b.configurationHash)missing.push(`${c.id}:unchanged-configuration`);
  if(a&&b&&(a.providerModel!==b.providerModel||a.device!==b.device||a.trialInputHash!==b.trialInputHash||!nonempty(a.trialInputHash)))missing.push(`${c.id}:unmatched-model-device-input`);
 }
 const baselineReceipts=new Set((baseline.attempts||[]).flatMap(a=>(a.meters||[]).map(m=>m.providerRequestId)));
 if((candidate.attempts||[]).some(a=>(a.meters||[]).some(m=>baselineReceipts.has(m.providerRequestId))))missing.push('reused-provider-receipts-across-arms');
 const budget=baseline.budget;
 if(hash(budget)!==hash(candidate.budget))missing.push('one-shared-run-budget');
 const totalCostUSD=before.totalCostUSD!==null&&after.totalCostUSD!==null?before.totalCostUSD+after.totalCostUSD:null;
 if(totalCostUSD!==null&&totalCostUSD>budget?.usd)missing.push('combined-budget-exceeded');
 return {kind:'matched-live-personalization-comparison',baseline:before,candidate:after,totalCostUSD,missingEvidence:missing,
  technicalGatePassed:after.technicalGatePassed&&!before.missingEvidence.length&&!before.disagreements.length&&!missing.length,
  releaseReady:false,limitations:'Baseline quality failures are reported rather than hidden. Matching requires the same synthetic inputs, model, device, rubric and coverage. Human release approval and operational/device checks remain separate.'};
}

import { readFile, writeFile, open, unlink, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openStore } from './store.mjs';
import { extractionSchema } from './contracts.mjs';
import { createResponsesExtractor } from './extractor.mjs';
import { createResponsesVerifier, verificationInstructions, selectVerification } from './verifier.mjs';
import { verifyExtractionCandidate } from './verified-extraction.mjs';
import { verificationVersion, verificationHash } from './verification-contracts.mjs';
import { verificationCases, verificationVersion as fixtureVersion } from './verification-fixtures.mjs';
import { finalInterpretationCases, finalInterpretationVersion } from './interpretation-final-fixtures.mjs';
import { restraintCases, restraintVersion } from './verification-restraint-fixtures.mjs';
import { finalRestraintCases, finalRestraintVersion } from './verification-final-restraint-fixtures.mjs';
import { openCalibrationBudget, calibrationDirectory, localCalibrationPath, pricing } from './calibration-budget.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null;
const fields=extractionSchema.properties.items.items.anyOf[0].required;
function summarize(records){
  const group=rows=>({cases:rows.length,completed:rows.filter(row=>row.valid).length,
    selected:rows.filter(row=>row.selection.required).length,
    revised:rows.filter(row=>row.audit?.decision==='revised').length,
    kept:rows.filter(row=>row.audit?.decision==='kept').length,
    skipped:rows.filter(row=>row.audit?.decision==='skipped').length,
    held:rows.filter(row=>!row.valid).length,
    expectedDecisionMatches:rows.filter(row=>row.expectedDecision&&row.audit?.decision===({keep:'kept',revise:'revised'})[row.expectedDecision]).length,
    cleanControls:rows.filter(row=>row.expectedDecision==='keep').length,
    cleanControlsUnchanged:rows.filter(row=>row.expectedDecision==='keep'&&row.valid&&verificationHash(row.initial)===verificationHash(row.actual)).length,
    medianTotalMs:median(rows.map(row=>row.durationMs)),
    medianVerificationMs:median(rows.flatMap(row=>row.steps.filter(step=>step.stage==='verification'&&step.sent).map(step=>step.durationMs)))});
  return {overall:group(records),byLanguage:Object.fromEntries(['en','es','mixed'].map(language=>[language,group(records.filter(row=>row.source.language===language))])),
    releaseGate:'human_review_required',limitations:['AI verdict agreement is not semantic accuracy; inspect original evidence, repairs and clean controls.',
      'A separate call to the same model does not provide independent errors or human verification.']};
}

/** Explicit fictional-only tests. Uses the existing durable ledger, never app credentials or records. */
export async function runVerificationCalibration({apiKey,runId,budgetId,capUsd,dataset='challenge',split='all',fetcher,onProgress=()=>{}}={}){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,50}$/.test(runId||'')||!['challenge','pipeline','restraint','restraint_fresh'].includes(dataset)
      ||!['all','development','heldout'].includes(split)||!apiKey)fail('invalid_verification_calibration');
  const challenge=dataset!=='pipeline';
  const cases=(dataset==='restraint_fresh'?finalRestraintCases():dataset==='restraint'?restraintCases():dataset==='challenge'?verificationCases():finalInterpretationCases()).filter(item=>split==='all'||item.split===split);
  if(cases.some(item=>!item.source.synthetic||item.priorSources?.some(source=>!source.synthetic)))fail('synthetic_calibration_only');
  const reportPath=localCalibrationPath(resolve(calibrationDirectory,`${runId}.json`)),lockPath=`${reportPath}.lock`;
  const lock=await open(lockPath,'wx');let budget;
  try{
    try{await readFile(reportPath);fail('verification_run_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
    budget=openCalibrationBudget({path:resolve(calibrationDirectory,'budgets.sqlite'),budgetId,capUsd});
    const report={kind:'network-effects-verification-calibration',schemaVersion:1,runId,budgetId,status:'running',createdAt:new Date().toISOString(),
      configuration:{version:verificationVersion,model:pricing.model,dataset:dataset==='restraint_fresh'?finalRestraintVersion:dataset==='restraint'?restraintVersion:dataset==='challenge'?fixtureVersion:finalInterpretationVersion,
        datasetRole:dataset==='restraint_fresh'?'new-restraint-v3-holdout':dataset==='restraint'?'previously-inspected-restraint-regression':dataset==='challenge'?'previously-inspected-verifier-regression':'previously-inspected-end-to-end-regression',split,promptHash:verificationHash(verificationInstructions),
        implementationHash:verificationHash(await Promise.all(['extractor.mjs','verifier.mjs','verification-repair.mjs','verified-extraction.mjs','verification-contracts.mjs','store.mjs'].map(async file=>[file,await readFile(new URL(file,import.meta.url),'utf8')]))),
        extractionReasoning:'low',verificationReasoning:'medium'},records:[],budget:budget.summary(),summary:null};
    const persist=async()=>{report.summary=summarize(report.records);report.budget=budget.summary();await writeFile(`${reportPath}.tmp`,JSON.stringify(report,null,2),{mode:0o600});await rename(`${reportPath}.tmp`,reportPath);};
    await persist();
    const sequential=dataset==='pipeline'?openStore({path:':memory:'}):null;
    try{for(const item of cases){
      const store=sequential||openStore({path:':memory:'});let initial=null,actual=null,errorCode=null,valid=false,audit=null,reviewOutput=null;
      const steps=[],accounting=[],start=performance.now();
      try{
        for(const prior of item.priorSources||[]){
          const queued=store.ingest(prior,'verifier-fixture-history'),job=store.claim({jobId:queued.id});
          const items=item.existingItems.filter(entry=>entry.sourceId===prior.id).map(entry=>Object.fromEntries(fields.map(field=>[field,entry[field]])));
          store.complete(job,{schemaVersion:1,items},0);
        }
        const queued=store.ingest(item.source,verificationVersion),job=store.claim({jobId:queued.id,leaseMs:120000});
        const context=store.contextFor(item.source);
        const hooks=stage=>{const callId=`${runId}.${item.id}.${stage}`;let reserved=false;return{
          beforeRequest(request){budget.reserve(callId,request);reserved=true;},
          onDiagnostic(diagnostic){steps.push({stage,...diagnostic});if(reserved){const result=budget.settle(callId,diagnostic);accounting.push(result);if(result.exceededReservation)fail('verification_budget_bound_exceeded');}},
        };};
        try{
          initial=challenge?structuredClone(item.initialCandidate):await createResponsesExtractor({apiKey,model:pricing.model,fetcher,
            serviceTier:'default',maxOutputTokens:3000,timeoutMs:45000,...hooks('extraction')})(item.source,context);
          audit=await verifyExtractionCandidate({source:item.source,initial,context,steps,selection:{force:challenge},
            verify:createResponsesVerifier({apiKey,model:pricing.model,fetcher:async(...args)=>{
              const response=await (fetcher||globalThis.fetch)(...args);
              return {ok:response.ok,json:async()=>{const body=await response.json();
                // Fictional calibration only. Retain public structured answer text,
                // never reasoning items, credentials, headers or private reasoning.
                const text=(body.output||[]).filter(entry=>entry.type==='message').flatMap(entry=>entry.content||[])
                  .filter(part=>part.type==='output_text').map(part=>part.text).join('');
                if(text.length<=150000){try{reviewOutput=JSON.parse(text);}catch{reviewOutput={invalidJson:true};}}
                return body;}};
            },...hooks('verification')}),
            recordAudit:value=>{store.recordVerification(job,value);audit=value;}});
          store.complete(job,audit.final,performance.now()-start);actual=audit.final;valid=true;
        }catch(error){
          errorCode=/^[a-z_]+$/.test(error.code||'')?error.code:'verification_failed';
          try{store.failure(job,{code:errorCode},{maxAttempts:1});}catch(failure){
            // A host pause must not erase the charged attempt or crash before
            // its failed record is retained. Never extend/reuse an expired lease.
            if(!['stale_job_lease','stale_source_version'].includes(failure.code))throw failure;
            errorCode=failure.code;
          }
        }
        const selection=initial?selectVerification(item.source,initial,context):{required:false,reasons:[]};
        const history=store.getVerification(job.id);
        report.records.push({id:item.id,split:item.split,source:item.source,initial,actual,valid,errorCode,selection,
          expectedDecision:challenge?item.expected.decision:null,expected:item.expected,rubric:item.rubric,
          audit,reviewOutput,steps,accounting,durationMs:Math.round(performance.now()-start),history,
          pipeline:store.state({accountId:item.source.accountId,studentId:item.source.studentId}),humanReview:{status:'pending'}});
        await persist();await onProgress({id:item.id,processed:report.records.length,total:cases.length,valid,decision:audit?.decision,errorCode,budget:report.budget});
        if(['stale_job_lease','stale_source_version'].includes(errorCode)){report.status='interrupted';break;}
        if(['calibration_budget_exhausted','calibration_call_already_reserved','verification_budget_bound_exceeded'].includes(errorCode)){report.status='stopped';break;}
      }finally{if(!sequential)store.close();}
    }}finally{sequential?.close();}
    if(report.status==='running')report.status='completed';await persist();return{report,reportPath};
  }finally{budget?.close();await lock.close();await unlink(lockPath);}
}

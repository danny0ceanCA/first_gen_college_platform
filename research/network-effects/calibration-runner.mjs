import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { openStore } from './store.mjs';
import { createResponsesExtractor, extractorVersion, extractionInstructions, extractionReasoningEffort } from './extractor.mjs';
import { calibrationCases, calibrationVersion } from './calibration-fixtures.mjs';
import { openCalibrationBudget, localCalibrationPath, calibrationDirectory, pricing } from './calibration-budget.mjs';
import { scoreCalibrationCase, calibrationSummary } from './calibration-scoring.mjs';
import { inspectCalibrationPipeline } from './calibration-pipeline.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,70}$/.test(value);
async function persist(path, report) {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(temp, path);
}

export async function runCalibration({ apiKey, runId, budgetId, capUsd, split = 'all', repeats = 1,
  model = pricing.model, fetcher, signal, onProgress = () => {}, maxCases = 60, dataset = 'regression',
  reasoningEffort = extractionReasoningEffort, previouslyInspected = false } = {}) {
  if (!validId(runId) || !validId(budgetId) || !['all','development','heldout'].includes(split) || !['regression','fresh','fresh-2','interpretation','interpretation-final'].includes(dataset)
      || !['none','low'].includes(reasoningEffort) || typeof previouslyInspected !== 'boolean'
      || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 3
      || !Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > 60) fail('invalid_calibration_options');
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('calibration_api_key_required');
  if (model !== pricing.model) fail('unsupported_calibration_model');
  const fresh = dataset === 'fresh' ? await import('./calibration-fresh-fixtures.mjs') : null;
  const fresh2 = dataset === 'fresh-2' ? await import('./calibration-fresh2-fixtures.mjs') : null;
  const interpretation = dataset === 'interpretation' ? await import('./calibration-interpretation-fixtures.mjs') : null;
  const finalInterpretation = dataset === 'interpretation-final' ? await import('./interpretation-final-fixtures.mjs') : null;
  const examples = (finalInterpretation ? finalInterpretation.finalInterpretationCases() : interpretation ? interpretation.interpretationCases() : fresh2 ? fresh2.fresh2CalibrationCases() : fresh ? fresh.freshCalibrationCases() : calibrationCases()).filter(example=>split==='all'||example.split===split).slice(0,maxCases);
  if (examples.some(example=>!example.source.synthetic)) fail('synthetic_calibration_only');
  const reportPath = localCalibrationPath(resolve(calibrationDirectory, `${runId}.json`));
  const lockPath = `${reportPath}.lock`;
  // An unreleased lock is intentionally not guessed stale. Review any uncertain
  // provider request/budget entry before manually removing an abandoned lock.
  let lock;
  try { lock = await open(lockPath,'wx'); } catch { fail('calibration_run_locked'); }
  let budget;
  try {
    budget = openCalibrationBudget({ path: resolve(calibrationDirectory,'budgets.sqlite'),budgetId,capUsd });
    const implementationFiles=['contracts.mjs','extractor.mjs','store.mjs','projection-state.mjs','calibration-pipeline.mjs','calibration-scoring.mjs'];
    const implementationHash=digest(await Promise.all(implementationFiles.map(async file=>[file,await readFile(new URL(file,import.meta.url),'utf8')])));
    const configuration = { model, split, repeats, maxCases, dataset:finalInterpretation ? finalInterpretation.finalInterpretationVersion : interpretation ? interpretation.interpretationVersion : fresh2 ? fresh2.fresh2CalibrationVersion : fresh ? fresh.freshCalibrationVersion : calibrationVersion,
      datasetRole: !previouslyInspected && (fresh || fresh2 || interpretation || finalInterpretation) ? 'fresh-heldout' : 'previously-inspected-regression', extractorVersion,
      implementationHash,
      promptHash:digest(extractionInstructions), sourceHash:digest(examples), maxOutputTokens:3000, reasoningEffort, serviceTier:'default' };
    let previous;
    try { previous = JSON.parse(await readFile(reportPath,'utf8')); } catch (error) { if(error.code!=='ENOENT') throw error; }
    if (previous && (previous.budgetId!==budgetId || previous.configurationHash!==digest(configuration))) fail('calibration_run_configuration_changed');
    const report = previous || { schemaVersion:1, kind:'network-effects-real-extraction-calibration',runId,budgetId,
      createdAt:new Date().toISOString(),configuration,configurationHash:digest(configuration),
      status:'running', records:[], summary:null, budget:budget.summary(),
      references:[pricing.source,'https://developers.openai.com/api/docs/guides/structured-outputs','https://developers.openai.com/api/docs/guides/evaluation-best-practices'] };
    report.status='running';
    delete report.stopReason;
    let stopped = false;
    for(let repetition=1;repetition<=repeats && !stopped;repetition++) {
      const store = openStore({path:':memory:'});
      try {
        for(const example of examples) {
          if(signal?.aborted) { report.status='cancelled';stopped=true;break; }
          const sequenceKey=`${repetition}:${example.id}`;
          const old = report.records.find(record=>record.sequenceKey===sequenceKey);
          const queued=store.ingest(example.source,extractorVersion);
          const job=store.claim({jobId:queued.id});
          if(old) {
            if(old.score.valid) store.complete(job,old.actual,old.diagnostic.durationMs);
            else store.failure(job,{code:'invalid_extraction'},{maxAttempts:1});
            continue;
          }
          const context=store.contextFor(example.source);
          const callId=`${runId}.${repetition}.${example.id}`;
          let reserved=false, diagnostic=null, accounting=null, actual=null, errorCode=null;
          const extract=createResponsesExtractor({ apiKey,model,fetcher,signal,timeoutMs:60000,maxOutputTokens:3000,
            reasoningEffort,serviceTier:'default',captureCandidate:true,
            beforeRequest(request){ budget.reserve(callId,request);reserved=true; },
            onDiagnostic(value){ diagnostic=value;if(reserved)accounting=budget.settle(callId,value); },
          });
          let valid=false;
          try {
            actual=await extract(example.source,context);
            store.complete(job,actual,diagnostic.durationMs);
            valid=true;
          } catch(error) {
            errorCode=/^[a-z_]+$/.test(error.code||'')?error.code:'calibration_failed';
            actual=diagnostic?.candidate || null;
            store.failure(job,{code:'invalid_extraction'},{maxAttempts:1});
            if(['calibration_budget_exhausted','calibration_call_already_reserved','provider_cancelled'].includes(errorCode)) {
              report.status=errorCode==='provider_cancelled'?'cancelled':'stopped';report.stopReason=errorCode;stopped=true;
            }
          }
          if (!diagnostic) diagnostic={sent:false,outcome:'failed',errorCode,durationMs:0,responseId:null,model:null,usage:null};
          const {candidate:_candidate,...metering}=diagnostic;
          const record={sequenceKey,repetition,id:example.id,scenario:example.scenario,split:example.split,
            source:example.source,expected:example.expected,actual,rubric:example.rubric,
            valid,errorCode,diagnostic:metering,accounting,
            score:scoreCalibrationCase(example,actual,{valid,priorItems:context.existingItems}),
            contextItemIds:context.existingItems.map(item=>item.id),
            pipeline:inspectCalibrationPipeline(example,store.state({accountId:example.source.accountId,studentId:example.source.studentId}),{valid,priorItems:context.existingItems,actual})};
          // A no-call budget stop is not an extraction failure and remains
          // unprocessed; resume is possible with the same authorized ledger.
          if(diagnostic.sent || !['calibration_budget_exhausted','calibration_call_already_reserved','provider_cancelled'].includes(errorCode)) report.records.push(record);
          report.summary=calibrationSummary(report.records);report.budget=budget.summary();report.updatedAt=new Date().toISOString();
          if(accounting?.exceededReservation) {report.status='stopped';report.stopReason='provider_usage_exceeded_reservation';stopped=true;}
          await persist(reportPath,report);
          await onProgress({caseId:example.id,repetition,valid,errorCode,processed:report.records.length,total:examples.length*repeats,
            durationMs:diagnostic.durationMs,budget:report.budget});
          if(stopped)break;
        }
      } finally {store.close();}
    }
    if(!stopped)report.status='completed';
    report.summary=calibrationSummary(report.records);report.budget=budget.summary();report.updatedAt=new Date().toISOString();
    await persist(reportPath,report);
    return {reportPath,report};
  } finally {budget?.close();await lock.close();await unlink(lockPath);}
}

export async function main(args=process.argv.slice(2)) {
  if(args.includes('--help')||args.length===0) {
    console.log('Usage: node research/network-effects/calibration-runner.mjs --run-id v12-initial --budget-id v12-approved --cap-usd 5 [--dataset regression|fresh|fresh-2|interpretation|interpretation-final] [--split all|development|heldout] [--repeats 1..3] [--max-cases 1..60]\nRequires explicit NETWORK_EFFECTS_OPENAI_API_KEY. Uses only fictional built-in examples; never loads .env or account records. Reports and durable budget ledger stay in research/network-effects/.local/calibration/. Existing budget caps cannot be changed.');return;
  }
  const options={};
  for(let index=0;index<args.length;index+=2) {
    if(!['--run-id','--budget-id','--cap-usd','--split','--repeats','--max-cases','--dataset'].includes(args[index])||!args[index+1])fail('invalid_calibration_cli');
    options[args[index].slice(2)]=args[index+1];
  }
  const abort=new AbortController();const stop=()=>abort.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const result=await runCalibration({apiKey:process.env.NETWORK_EFFECTS_OPENAI_API_KEY,
      runId:options['run-id'],budgetId:options['budget-id'],capUsd:Number(options['cap-usd']),split:options.split||'all',
      dataset:options.dataset||'regression',
      repeats:Number(options.repeats||1),maxCases:Number(options['max-cases']||60),signal:abort.signal,
      onProgress:progress=>console.log(JSON.stringify(progress))});
    console.log(JSON.stringify({reportPath:result.reportPath,status:result.report.status,summary:result.report.summary,budget:result.report.budget},null,2));
  } finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(/^[a-z_]+$/.test(error.code||'')?error.code:'calibration_failed');process.exitCode=1;});
}

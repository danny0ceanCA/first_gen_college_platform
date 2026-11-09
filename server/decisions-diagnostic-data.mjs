// Pure projection shared by the durable writer and offline reports. No database,
// network, raw transcript, provider prose or generated-instruction dependency.
import { diagnosticClassifications, diagnosticResult, DIAGNOSTIC_QUESTION_NAMES } from '../research/decisions/diagnostic-classifications.mjs';

const idKeys = new Set(['operationId','requestId','reservationId','eventId','contributionId','questionId','workerRunId','rubricVersion','supportKind','supportNeed','reason','status','action','triggerBasis','deliveryMode','inputBoundaryEvidence','callerAudioEnded','kind','source','eventType','requestMoment','budgetConstraint','boundaryBasis','evidenceBasis','model','sourceStatus','sourceReason','deliveryDisposition']);
const numberKeys = new Set(['durationMs','totalMs','clientAwaitMs','transportAndJsonMs','requestBytes','questionCount','revision','supportRevision','assistantOutputRevision','workerSequence','workerElapsedMs','sourceToWorkerMs','classificationToSendMs','inputEvidenceToSendMs','evaluationCount','requestCount','costUsd',
  'scopeEpoch','connectionEpoch','questionRevision','inputRevision','generation','scopeGeneration','queueWaitMs','buildMs','parseMs','preparedToApiMs','totalWorkerMs','configuredRequestBytes','inputBytes','inputAgeMs','evidenceAgeMs','quietAgeMs','tokensAvailable','revalidationCount','maxEvaluations','ordinaryEvaluationCount','researchReserve','pendingMs','validationToSendMs','thoughtAgeMs','idleMs','quietMs','startMs','endMs','answerCount','attempt','automaticRetries','providerStatus','reservedUsd','classificationAgeMs','sourceRevision','currentRevision']);
const booleanKeys = new Set(['contextSent','playbackClaim','inputOpen','sourceComplete','freshAtWorker','reservationRetained','providerRequestCompleted','revalidationRequested','revalidated','parsedClassificationAvailable','classificationValidated','stale','queued','provisional','complete','eligible','retained','requestContentsLogged','usageKnown','duplicateOffer','latestUserComplete','authorized']);
const mismatchKeys = new Set(['callId','studentId','language','connectionEpoch','scopeEpoch','contributionId','revision','supportRevision','assistantOutputRevision','sourceEventIds','sourceOutputEventIds','usable','closed','observer_closed','evidence_unusable']);
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const opaque = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const scalarObject = (value, booleans, numbers) => Object.fromEntries(Object.entries(value ?? {}).filter(([key, v]) =>
  booleans.includes(key) && typeof v === 'boolean' || numbers.includes(key) && numeric(v)));

export function decisionsDiagnosticData(event) {
  const data = {};
  for (const [key, value] of Object.entries(event ?? {})) {
    if (idKeys.has(key) && typeof value === 'string' && /^[a-zA-Z0-9_.: -]{1,200}$/.test(value)) data[key] = value;
    if (numberKeys.has(key) && numeric(value)) data[key] = value;
    if (booleanKeys.has(key) && typeof value === 'boolean') data[key] = value;
  }
  // A write with uncertain completion must not disappear or become false.
  if (event?.contextSent === 'unknown') data.contextSent = 'unknown';
  if (['en','es','mixed','unknown'].includes(event?.language)) data.language = event.language;
  for (const key of ['sourceEventIds','sourceTranscriptIds','sourceOutputEventIds'])
    if (Array.isArray(event?.[key])) data[key] = [...new Set(event[key].filter(opaque))].slice(0,128);
  if (Array.isArray(event?.freshnessMismatch)) data.freshnessMismatch = [...new Set(event.freshnessMismatch.filter(key => mismatchKeys.has(key)))];
  if (Array.isArray(event?.questionNames)) data.questionNames = [...new Set(event.questionNames.filter(key => DIAGNOSTIC_QUESTION_NAMES.includes(key)))];
  const result = diagnosticResult(event?.result ?? { supportNeed: event?.supportNeed,
    preferenceChanges: event?.preferenceChanges, conversationSupport: event?.conversationSupport });
  if (Object.keys(result).length) data.classification = result;
  // Retain the historical field for existing diagnostic queries.
  if (result.facts) data.probabilities = result.facts;
  const answers = event?.classificationAnswers;
  if (Array.isArray(answers)) {
    const projected = diagnosticClassifications(answers);
    data.classificationAnswers = projected.answers;
    data.omittedClassificationAnswers = projected.omittedAnswers + (numeric(event.omittedClassificationAnswers) ? event.omittedClassificationAnswers : 0);
  }
  if (['early','completed','native','unknown'].includes(event?.classificationPath)) data.classificationPath = event.classificationPath;
  else if (event?.type?.startsWith('early_decisions_')) data.classificationPath = 'early';
  else if (['decisions_response_parsed','decision_observation','decisions_observation_finished'].includes(event?.type)) data.classificationPath = 'completed';
  for (const key of ['stamp','candidateStamp','sourceStamp','currentStamp']) if (event?.[key] && typeof event[key] === 'object') {
    const stamp = {};
    for (const [field, value] of Object.entries(event[key])) {
      if (['callId','sessionId','studentId','questionId','contributionId'].includes(field) && opaque(value)) stamp[field] = value;
      if (['connectionEpoch','scopeEpoch','scopeGeneration','generation','revision','inputRevision','questionRevision','supportRevision','assistantOutputRevision'].includes(field) && numeric(value)) stamp[field] = value;
      if (field === 'language' && ['en','es','mixed'].includes(value)) stamp[field] = value;
    }
    data[key] = stamp;
  }
  for (const key of ['budget','explanationHistorySummary']) if (event?.[key] && typeof event[key] === 'object')
    data[key] = Object.fromEntries(Object.entries(event[key]).filter(([name,value]) => /^[a-zA-Z]{1,50}$/.test(name)
      && (typeof value === 'boolean' || numeric(value))));
  if (event?.readiness) data.readiness = scalarObject(event.readiness,
    ['started','closed','selected','selectionPending','introReady','inputOpen','outputOpen','recentAudio','playbackIdle','research','delegation','diagnosticUnavailable'],
    ['playbackAgeMs','backendCount','delegationCount','pendingContextCount']);
  if (event?.usage) {
    const value = event.usage;
    data.usage = scalarObject({ inputTokens: value.inputTokens ?? value.input_tokens, outputTokens: value.outputTokens ?? value.output_tokens,
      totalTokens: value.totalTokens ?? value.total_tokens, cachedInputTokens: value.cachedInputTokens ?? value.input_tokens_details?.cached_tokens,
      cacheWriteTokens: value.cacheWriteTokens ?? value.input_tokens_details?.cache_write_tokens,
      reasoningTokens: value.reasoningTokens ?? value.output_tokens_details?.reasoning_tokens }, [],
    ['inputTokens','outputTokens','totalTokens','cachedInputTokens','cacheWriteTokens','reasoningTokens']);
  }
  return data;
}

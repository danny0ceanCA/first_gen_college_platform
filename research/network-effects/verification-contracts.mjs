import { createHash } from 'node:crypto';
import { validateExtraction, validateSource } from './contracts.mjs';
import { prepareExtractionContext } from './extractor.mjs';
import { isProseOnlyRevision, validateMinimalRevision } from './verification-repair.mjs';

export const supportedVerificationVersions = Object.freeze(['network-effects-verification-v1', 'network-effects-verification-v2', 'network-effects-verification-v3']);
export const verificationVersion = supportedVerificationVersions[2];
export const verificationReasons = ['correction', 'claimed_progress', 'unfinished_attempt', 'uncertainty_without_barrier',
  'prior_pending', 'reporter_attribution', 'competing_results', 'uncovered_source', 'barrier_coverage', 'sample'];
export const verificationIssueTypes = ['omission', 'classification', 'unsupported_claim', 'attribution', 'relationship', 'barrier', 'uncertain'];
export const verificationDecisions = ['pending', 'skipped', 'kept', 'revised', 'needs_review', 'failed'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const verificationHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const exact = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join() !== [...fields].sort().join()) fail('invalid_verification');
};

export function verificationContextHash(rawSource, context = {}) {
  const source = validateSource(rawSource);
  // Derived projections can change as this job is queued. Fingerprint the actual
  // source and scoped current predecessor evidence, not a transient job hold.
  const { requestContext } = prepareExtractionContext(source, context);
  return verificationHash({ source, existingItems: requestContext.existingItems });
}

export function validateVerificationIssues(issues, source, initial) {
  if (!Array.isArray(issues) || issues.length > 30) fail('invalid_verification');
  for (const issue of issues) {
    exact(issue, ['type', 'quote', 'detail', 'itemKey']);
    if (!verificationIssueTypes.includes(issue.type) || typeof issue.quote !== 'string' || !issue.quote.trim()
        || issue.quote.length > 2000 || !source.text.includes(issue.quote)
        || typeof issue.detail !== 'string' || !issue.detail.trim() || issue.detail.length > 600
        || issue.itemKey !== null && !initial.items.some(item => item.key === issue.itemKey)) fail('invalid_verification_issue');
  }
  return structuredClone(issues);
}

export function safeVerificationStep(data) {
  if (!['extraction', 'verification'].includes(data?.stage)) fail('invalid_verification_step');
  const text = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { stage: data.stage,
    ...(['parse', 'issues', 'repair'].includes(data.validationStage) ? { validationStage: data.validationStage,
      contractCode: text(data.contractCode, /^(?:invalid_(?:source|item|provider|extraction|verification)(?:_[a-z]+){0,3}|unsupported_item_(?:evidence|date)|unknown_item_reference|cross_scope_reference|stale_item_reference|ambiguous_correction)$/) } : {}),
    responseId: text(data.responseId, /^resp_[a-zA-Z0-9_-]{1,160}$/),
    model: text(data.model, /^[a-zA-Z0-9._:-]{1,100}$/), durationMs: count(data.durationMs), sent: data.sent === true,
    outcome: ['completed', 'failed'].includes(data.outcome) ? data.outcome : 'failed',
    errorCode: text(data.errorCode, /^(?:provider_(?:failed|timeout|cancelled|incomplete|refused)|invalid_(?:extraction|verification(?:_issue|_step|_decision)?)|verification_needs_review|calibration_budget_exhausted|network_budget_exhausted)$/),
    usage: count(data.usage?.inputTokens) !== null && count(data.usage?.outputTokens) !== null
      ? { inputTokens: data.usage.inputTokens, outputTokens: data.usage.outputTokens } : null,
    reasoningTokens: count(data.reasoningTokens) };
}

export function validateVerificationAudit(audit, rawSource, context = {}) {
  const source = validateSource(rawSource);
  exact(audit, ['schemaVersion', 'version', 'decision', 'reasons', 'initial', 'final', 'issues', 'contextHash', 'steps']);
  if (Buffer.byteLength(JSON.stringify(audit)) > 400000 || audit.schemaVersion !== 1 || !supportedVerificationVersions.includes(audit.version)
      || !verificationDecisions.includes(audit.decision) || !Array.isArray(audit.reasons)
      || new Set(audit.reasons).size !== audit.reasons.length || audit.reasons.some(reason => !verificationReasons.includes(reason))
      || audit.contextHash !== verificationContextHash(source, context)) fail('verification_context_changed');
  const initial = validateExtraction(audit.initial, source, context);
  const final = audit.final === null ? null : validateExtraction(audit.final, source, context);
  const issues = validateVerificationIssues(audit.issues, source, initial);
  if (!Array.isArray(audit.steps) || audit.steps.length > 2 || new Set(audit.steps.map(step => step.stage)).size !== audit.steps.length) fail('invalid_verification_step');
  const steps = audit.steps.map(safeVerificationStep);
  const same = final !== null && verificationHash(initial) === verificationHash(final);
  const reparented = final?.items.some(item => initial.items.some(previous => previous.key === item.key
    && previous.episodeKey !== item.episodeKey));
  if (supportedVerificationVersions.indexOf(audit.version) >= 1 && audit.decision === 'revised' && final !== null)
    validateMinimalRevision(initial, final, issues, source);
  if (audit.version === verificationVersion && audit.decision === 'revised' && final !== null
      && isProseOnlyRevision(initial, final)) fail('invalid_verification_decision');
  if (['skipped', 'kept'].includes(audit.decision) && (!same || issues.length)
      || audit.decision === 'revised' && (final === null || same || !issues.length || reparented)
      || ['pending', 'failed', 'needs_review'].includes(audit.decision) && final !== null
      || audit.decision === 'needs_review' && !issues.length
      || audit.decision === 'skipped' && (audit.reasons.length || steps.some(step => step.stage === 'verification'))
      || ['pending', 'kept', 'revised', 'needs_review'].includes(audit.decision) && !audit.reasons.length) fail('invalid_verification_decision');
  return { ...structuredClone(audit), initial, final, issues, steps };
}

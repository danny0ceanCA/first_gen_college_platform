import { validateExtraction, validateSource } from './contracts.mjs';
import { selectVerification } from './verifier.mjs';
import { verificationVersion, verificationContextHash, validateVerificationAudit, safeVerificationStep } from './verification-contracts.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Candidate stays staged until a required check succeeds. No conversation code participates. */
export async function verifyExtractionCandidate({ source: rawSource, initial: rawInitial, context = {}, verify,
  recordAudit, steps = [], selection } = {}) {
  if (typeof recordAudit !== 'function') fail('verification_audit_required');
  const source = validateSource(rawSource), initial = validateExtraction(rawInitial, source, context);
  const selected = selectVerification(source, initial, context);
  // An explicit evaluation selection may force a check, never suppress one.
  if (selection?.force && !selected.required) { selected.required = true; selected.reasons.push('sample'); }
  const base = { schemaVersion: 1, version: verificationVersion, initial, reasons: selected.reasons,
    contextHash: verificationContextHash(source, context) };
  const audit = (decision, final, issues = []) => validateVerificationAudit({ ...base, decision, final, issues,
    steps: steps.map(safeVerificationStep) }, source, context);
  if (!selected.required) {
    const result = audit('skipped', initial); await recordAudit(result); return result;
  }
  await recordAudit(audit('pending', null));
  let savedTerminal = false;
  try {
    if (typeof verify !== 'function') fail('verification_required');
    const result = await verify(source, initial, context, selected.reasons);
    if (!['kept', 'revised', 'needs_review'].includes(result?.decision)) fail('invalid_verification');
    const finished = audit(result.decision, result.final, result.issues);
    await recordAudit(finished); savedTerminal = true;
    if (finished.decision === 'needs_review') fail('verification_needs_review');
    return finished;
  } catch (error) {
    if (!savedTerminal) await recordAudit(audit('failed', null));
    throw error;
  }
}

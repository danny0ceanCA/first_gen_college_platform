import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVerificationRepair, isProseOnlyRevision } from './verification-repair.mjs';
import { validateVerificationAudit, verificationContextHash, verificationVersion } from './verification-contracts.mjs';
import { createResponsesVerifier } from './verifier.mjs';
import { verifyExtractionCandidate } from './verified-extraction.mjs';
import { openStore } from './store.mjs';

const source = { id: 'prose-guard', version: 1, accountId: 'fictional-prose-guard', studentId: 'student',
  reporter: 'student', language: 'en', kind: 'note', recordedAt: '2026-11-05T12:00:00.000Z', synthetic: true,
  text: 'I sent the form. I cannot visit because the buses stop early.' };
const candidate = () => ({ schemaVersion: 1, items: [{ key: 'sent', episodeKey: 'visit-support',
  topic: 'finding_help', kind: 'action', status: 'completed', statement: 'The form was sent.',
  quote: source.text, barrier: null, reportedBy: 'student', language: 'en', occurredAt: null,
  linksTo: null, corrects: null }] });
const issue = { type: 'unsupported_claim', quote: 'I sent the form.', detail: 'The reviewer proposed different wording.', itemKey: 'sent' };
const wire = edits => ({ decision: 'revise', obstacles: [], additions: [], issues: [issue], edits });
const audit = (initial, final, version = verificationVersion, issues = [issue]) => ({
  schemaVersion: 1, version, decision: 'revised', reasons: ['claimed_progress'], initial, final,
  issues, contextHash: verificationContextHash(source), steps: [],
});

test('statement-only, quote-only, and combined prose edits are held without altering the candidate', () => {
  for (const edits of [
    [{ itemKey: 'sent', field: 'statement', value: 'I sent the form.', issueIndex: 0 }],
    [{ itemKey: 'sent', field: 'quote', value: 'I sent the form.', issueIndex: 0 }],
    [{ itemKey: 'sent', field: 'statement', value: 'I sent the form.', issueIndex: 0 },
      { itemKey: 'sent', field: 'quote', value: 'I sent the form.', issueIndex: 0 }],
  ]) {
    const initial = candidate(), before = structuredClone(initial);
    const result = applyVerificationRepair(wire(edits), initial, source, {}, [issue]);
    assert.deepEqual(result, { decision: 'needs_review', final: null, issues: [issue] });
    assert.deepEqual(initial, before);
  }
});

test('unchanged candidates and real obstacle or classification repairs are not prose-only holds', () => {
  const initial = candidate();
  const kept = applyVerificationRepair({ decision: 'keep', obstacles: [], additions: [], issues: [], edits: [] }, initial, source, {}, []);
  assert.equal(kept.decision, 'kept');
  assert.equal(isProseOnlyRevision(initial, initial), false);
  const withBarrier = applyVerificationRepair({ decision: 'revise', obstacles: [{ itemKey: 'sent', coverage: 'missing',
    quote: 'I cannot visit because the buses stop early.' }], additions: [], issues: [], edits: [] }, initial, source, {}, []);
  assert.equal(withBarrier.decision, 'revised');
  assert.equal(withBarrier.final.items[0].barrier, 'I cannot visit because the buses stop early.');
  assert.equal(isProseOnlyRevision(initial, withBarrier.final), false);
  const attempted = candidate(); attempted.items[0].status = 'attempted';
  const classification = { ...issue, type: 'classification', detail: 'The source reports completing this action.' };
  const corrected = applyVerificationRepair({ decision: 'revise', obstacles: [], additions: [], issues: [classification], edits: [
    { itemKey: 'sent', field: 'classification', value: 'action:completed', issueIndex: 0 },
    { itemKey: 'sent', field: 'statement', value: 'I sent the form.', issueIndex: 0 },
  ] }, attempted, source, {}, [classification]);
  assert.equal(corrected.decision, 'revised');
  assert.equal(isProseOnlyRevision(attempted, corrected.final), false);
});

test('durable v3 audits reject prose-only publication while existing v1 and v2 audits stay readable', () => {
  const initial = candidate(), final = structuredClone(initial);
  final.items[0].statement = 'I sent the form.';
  assert.equal(isProseOnlyRevision(initial, final), true);
  for (const version of ['network-effects-verification-v1', 'network-effects-verification-v2']) {
    assert.deepEqual(validateVerificationAudit(audit(initial, final, version), source).final, final);
  }
  assert.throws(() => validateVerificationAudit(audit(initial, final), source), { code: 'invalid_verification_decision' });
  const held = { ...audit(initial, null), decision: 'needs_review' };
  assert.equal(validateVerificationAudit(held, source).decision, 'needs_review');
});

test('v2 keeps its original minimal-edit safeguards after v3 becomes current', () => {
  const initial = candidate(); initial.items[0].barrier = 'I cannot visit because the buses stop early.';
  const final = structuredClone(initial); final.items[0].barrier = null;
  const issues = [{ ...issue, type: 'barrier', quote: initial.items[0].barrier }];
  for (const version of ['network-effects-verification-v2', 'network-effects-verification-v3']) {
    assert.throws(() => validateVerificationAudit(audit(initial, final, version, issues), source), { code: 'invalid_verification_decision' });
  }
});

const heldProposal = () => ({ decision: 'needs_review', issues: [structuredClone(issue)],
  edits: [{ itemKey: 'sent', field: 'statement', value: 'This must never be applied.', issueIndex: 0 }],
  additions: [{ item: { unsupported: 'This must never be recorded.' }, issueIndex: 0 }],
  obstacles: [{ itemKey: 'sent', coverage: 'missing', quote: 'This is not supported evidence.' }],
});
const mockVerifier = result => createResponsesVerifier({ apiKey: 'mock-no-network', model: 'gpt-6-luna',
  fetcher: async () => ({ ok: true, json: async () => ({ status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
  }) }),
});

test('a validated needs_review verdict discards every proposal without mutating the original', async () => {
  const initial = candidate(), original = structuredClone(initial), proposals = heldProposal();
  const result = await mockVerifier(proposals)(source, initial);
  assert.deepEqual(result, { decision: 'needs_review', final: null, issues: [issue] });
  assert.deepEqual(initial, original);
  assert.equal(JSON.stringify(result).includes('never be'), false);
  assert.equal(JSON.stringify(result).includes('not supported evidence'), false);
});

test('needs_review normalization still rejects missing or unsupported findings and invalid outer contracts', async () => {
  const variants = [
    value => { value.issues = []; },
    value => { value.issues[0].quote = 'Not a source quotation.'; },
    value => { value.issues[0].itemKey = 'unknown-item'; },
    value => { value.extra = 'not allowed'; },
    value => { delete value.edits; },
    value => { value.edits = null; },
    value => { value.additions = {}; },
    value => { value.obstacles = 'not an array'; },
    value => { value.edits = Array(61).fill({}); },
    value => { value.additions = Array(11).fill({}); },
    value => { value.obstacles = Array(21).fill({}); },
  ];
  for (const mutate of variants) {
    const bad = heldProposal(); mutate(bad);
    await assert.rejects(mockVerifier(bad)(source, candidate()));
  }
});

test('a needs_review response with proposals saves only a hold audit and cannot write final evidence', async t => {
  const store = openStore({ path: ':memory:' }); t.after(() => store.close());
  const queued = store.ingest(source, verificationVersion), job = store.claim({ jobId: queued.id });
  const initial = candidate(), before = structuredClone(initial), context = store.contextFor(source);
  await assert.rejects(verifyExtractionCandidate({ source, initial, context,
    verify: mockVerifier(heldProposal()), recordAudit: audit => store.recordVerification(job, audit),
  }), { code: 'verification_needs_review' });
  const saved = store.getVerification(job.id).attempts[0].audit;
  assert.equal(saved.decision, 'needs_review'); assert.equal(saved.final, null);
  assert.deepEqual(saved.initial, before); assert.deepEqual(saved.issues, [issue]);
  assert.deepEqual(initial, before);
  assert.throws(() => store.complete(job, initial), { code: 'verification_required' });
  assert.equal(store.state().episodes.flatMap(episode => episode.items).length, 0);
  assert.equal(JSON.stringify(saved).includes('never be'), false);
});

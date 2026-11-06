import assert from 'node:assert/strict';
import { verificationContextHash, verificationVersion, supportedVerificationVersions } from './verification-contracts.mjs';
import { applyVerificationRepair } from './verification-repair.mjs';
import { verifyExtractionCandidate } from './verified-extraction.mjs';

const source = (id, overrides = {}) => ({ id, version: 1, accountId: 'verification-family', studentId: 'verification-student',
  reporter: 'student', language: 'en', kind: 'note', recordedAt: '2026-11-05T12:00:00.000Z',
  text: 'I sent the form. I am still waiting for the decision.', synthetic: true, ...overrides });
const extraction = (input, status = 'pending') => ({ schemaVersion: 1, items: [{ key: 'result', episodeKey: 'requested-decision',
  topic: 'applications', barrier: null, kind: 'outcome', status, statement: input.text, quote: input.text,
  reportedBy: input.reporter, language: input.language, occurredAt: null, linksTo: null, corrects: null }] });
const diagnostic = stage => ({ stage, responseId: 'resp_test_' + stage, model: 'test-model', durationMs: 25,
  outcome: 'completed', sent: true, usage: { inputTokens: 20, outputTokens: 15 }, reasoningTokens: 4,
  authorization: 'never-persist-this', privateReasoning: 'never-persist-this' });
async function prepare(store, input = source('source'), extractorVersion = 'verification-storage-test') {
  const queued = await store.ingest(input, extractorVersion);
  const job = await store.claim({ jobId: queued.id, leaseMs: 1000, maxAttempts: 1 });
  const initial = extraction(input);
  const context = await store.contextFor(input);
  const audit = { schemaVersion: 1, version: verificationVersion, decision: 'pending', reasons: ['sample'],
    initial, final: null, issues: [], contextHash: verificationContextHash(input, context), steps: [diagnostic('extraction')] };
  return { job, input, initial, audit };
}
const terminal = (audit, decision = 'kept', extra = {}) => ({ ...audit, decision,
  final: decision === 'kept' ? audit.initial : null, steps: [...audit.steps, diagnostic('verification')], ...extra });
const reject = (fn, code) => assert.rejects(async () => fn(), error => error.code === code);
async function save(store, input) {
  const queued = await store.ingest(input, 'verification-storage-test');
  const job = await store.claim({ jobId: queued.id });
  await store.complete(job, extraction(input));
}

/** Exactly the same persistence expectations run against SQLite and PostgreSQL. */
export function verificationStorageSuite(register, setup) {
  for (const pipelineVersion of supportedVerificationVersions) register(`verification pipeline ${pipelineVersion} requires an audit even on its first attempt`, async t => {
    const { store } = await setup(t), { job, initial, audit } = await prepare(store, source('pipeline'), pipelineVersion);
    audit.version = pipelineVersion;
    await reject(() => store.complete(job, initial), 'verification_required');
    await store.recordVerification(job, { ...audit, decision: 'skipped', reasons: [], final: initial });
    await store.complete(job, initial);
    assert.equal((await store.getVerification(job.id)).job.status, 'completed');
  });

  register('legacy verification audits replay unchanged and an attempt cannot switch audit versions', async t => {
    const legacyVersion = 'network-effects-verification-v1';
    const { store } = await setup(t), { job, initial, audit } = await prepare(store, source('legacy-pipeline'), legacyVersion);
    const pending = { ...audit, version: legacyVersion };
    await store.recordVerification(job, pending);
    await reject(() => store.recordVerification(job, terminal({ ...pending, version: verificationVersion })), 'verification_audit_conflict');
    const kept = terminal(pending);
    await store.recordVerification(job, kept);
    await store.complete(job, initial);
    const detail = await store.getVerification(job.id);
    assert.equal(detail.job.status, 'completed');
    assert.equal(detail.attempts[0].audit.version, legacyVersion);
    assert.deepEqual(detail.attempts[0].audit.initial, initial);
    assert.deepEqual(detail.attempts[0].audit.final, initial);
  });

  register('new pipeline jobs reject older audits while current workers can verify old queued jobs', async t => {
    const legacyVersion = 'network-effects-verification-v1';
    const { store } = await setup(t);
    const fresh = await prepare(store, source('new-pipeline'), verificationVersion);
    await reject(() => store.recordVerification(fresh.job, { ...fresh.audit, version: legacyVersion }), 'verification_audit_conflict');
    await reject(() => store.complete(fresh.job, fresh.initial), 'verification_required');
    const queued = await prepare(store, source('old-queued-pipeline'), legacyVersion);
    await store.recordVerification(queued.job, queued.audit);
    await store.recordVerification(queued.job, terminal(queued.audit));
    await store.complete(queued.job, queued.initial);
    assert.equal((await store.getVerification(queued.job.id)).attempts[0].audit.version, verificationVersion);
  });

  register('v2 storage preserves existing barriers and accepts only evidence-backed additions', async t => {
    const { store } = await setup(t);
    const input = source('barrier-repair', { text: 'I cannot reach the office. I work all day.' });
    const queued = await store.ingest(input, verificationVersion);
    const job = await store.claim({ jobId: queued.id });
    const initial = extraction(input);
    initial.items[0].barrier = 'I cannot reach the office.';
    const pending = { schemaVersion: 1, version: verificationVersion, decision: 'pending', reasons: ['sample'],
      initial, final: null, issues: [], contextHash: verificationContextHash(input, await store.contextFor(input)), steps: [] };
    await store.recordVerification(job, pending);
    const issues = [{ type: 'barrier', quote: 'I work all day.', detail: 'An explicit work obstacle was not structured.', itemKey: 'result' }];
    for (const barrier of [null, 'I work all day.', 'I cannot reach the office.; Daytime work']) {
      const final = structuredClone(initial); final.items[0].barrier = barrier;
      await reject(() => store.recordVerification(job, terminal(pending, 'revised', { final, issues })), 'invalid_verification_decision');
    }
    await reject(() => store.complete(job, initial), 'verification_required');
    const final = structuredClone(initial);
    final.items[0].barrier = 'I cannot reach the office.; I work all day.';
    await store.recordVerification(job, terminal(pending, 'revised', { final, issues }));
    await store.complete(job, final);
    assert.deepEqual((await store.getVerification(job.id)).attempts[0].audit.initial, initial);
    assert.deepEqual((await store.getVerification(job.id)).attempts[0].audit.final, final);
  });

  register('v2 prose-only audit history remains replayable while v3 blocks the same revision', async t => {
    const { store } = await setup(t);
    for (const version of ['network-effects-verification-v2', 'network-effects-verification-v3']) {
      const { job, input, initial, audit } = await prepare(store, source(`prose-${version}`, { text: 'I asked for the link.' }), version);
      initial.items[0].kind = 'action'; initial.items[0].status = 'completed'; initial.items[0].statement = 'I requested the link.';
      const pending = { ...audit, version };
      const final = structuredClone(initial); final.items[0].statement = input.text;
      const issues = [{ type: 'unsupported_claim', quote: input.text, detail: 'The reviewer proposed different wording.', itemKey: 'result' }];
      await store.recordVerification(job, pending);
      const revised = terminal(pending, 'revised', { final, issues });
      if (version === 'network-effects-verification-v2') {
        await store.recordVerification(job, revised);
        await store.complete(job, final);
        const detail = await store.getVerification(job.id);
        assert.equal(detail.job.status, 'completed');
        assert.equal(detail.attempts[0].audit.version, version);
        assert.deepEqual(detail.attempts[0].audit.final, final);
      } else {
        await reject(() => store.recordVerification(job, revised), 'invalid_verification_decision');
        await reject(() => store.complete(job, final), 'verification_required');
        assert.equal((await store.getVerification(job.id)).attempts[0].audit.decision, 'pending');
      }
    }
  });

  register('v3 prose-only proposals become durable review holds before any evidence can be written', async t => {
    const { store } = await setup(t);
    const { job, input, initial } = await prepare(store, source('prose-held', { text: 'I asked for the link.' }), verificationVersion);
    initial.items[0].kind = 'action'; initial.items[0].status = 'completed'; initial.items[0].statement = 'I requested the link.';
    const issues = [{ type: 'unsupported_claim', quote: input.text, detail: 'The reviewer proposed different wording.', itemKey: 'result' }];
    const context = await store.contextFor(input);
    await reject(() => verifyExtractionCandidate({ source: input, initial, context,
      recordAudit: audit => store.recordVerification(job, audit),
      verify: async () => {
        assert.equal((await store.getVerification(job.id)).attempts[0].audit.decision, 'pending');
        return applyVerificationRepair({ decision: 'revise', obstacles: [], additions: [], issues,
          edits: [{ itemKey: 'result', field: 'statement', value: input.text, issueIndex: 0 }] }, initial, input, context, issues);
      },
    }), 'verification_needs_review');
    await reject(() => store.complete(job, initial), 'verification_required');
    await store.failure(job, { code: 'verification_needs_review' }, { maxAttempts: 1 });
    const detail = await store.getVerification(job.id);
    assert.equal(detail.job.status, 'failed');
    assert.equal(detail.attempts[0].audit.decision, 'needs_review');
    assert.equal(detail.attempts[0].audit.final, null);
    assert.deepEqual(detail.attempts[0].audit.initial, initial);
    assert.deepEqual(detail.attempts[0].audit.issues, issues);
    assert.equal((await store.state()).episodes.flatMap(episode => episode.items).length, 0);
  });

  register('pending audit is durable before any items and cannot publish; a kept candidate preserves evidence', async t => {
    const { store } = await setup(t), { job, input, initial, audit } = await prepare(store);
    const recorded = await store.recordVerification(job, audit);
    assert.equal(recorded.attempt, 1);
    assert.equal(recorded.audit.decision, 'pending');
    assert.equal(JSON.stringify(recorded).includes('never-persist-this'), false);
    assert.equal((await store.state()).episodes.length, 0);
    await reject(() => store.complete(job, initial), 'verification_required');
    const kept = await store.recordVerification(job, terminal(audit));
    assert.deepEqual(await store.recordVerification(job, terminal(audit)), kept);
    await store.complete(job, initial);
    const detail = await store.getVerification(job.id);
    assert.equal(detail.job.status, 'completed');
    assert.deepEqual(detail.source, input);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].audit.steps.length, 2);
    assert.equal(JSON.stringify(detail).includes(job.token), false);
    const episode = (await store.state()).episodes[0];
    assert.equal(episode.outcomeState, 'pending');
    assert.notEqual(episode.reviewState, 'reviewed'); // AI verification is not a human decision.
    assert.equal(episode.analysisEligible, true);
  });

  register('revised candidate is the only publishable candidate; initial evidence is retained', async t => {
    const { store } = await setup(t), { job, input, initial, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    const final = extraction(input, 'unknown');
    const revised = terminal(audit, 'revised', { final, issues: [{ type: 'classification', quote: input.text,
      detail: 'Retain the uncertain decision state.', itemKey: 'result' }] });
    await store.recordVerification(job, revised);
    await reject(() => store.complete(job, initial), 'verification_candidate_mismatch');
    await reject(() => store.recordVerification(job, terminal(audit)), 'verification_audit_conflict');
    await store.complete(job, final);
    const saved = (await store.getVerification(job.id)).attempts[0].audit;
    assert.deepEqual(saved.initial, initial);
    assert.deepEqual(saved.final, final);
    assert.equal((await store.state()).episodes[0].outcomeState, 'unknown');
  });

  register('untriggered skipped audit can publish, but terminal verification requires a persisted pending audit', async t => {
    const { store } = await setup(t), { job, initial, audit } = await prepare(store);
    await reject(() => store.recordVerification(job, terminal(audit)), 'verification_required');
    await store.recordVerification(job, { ...audit, decision: 'skipped', reasons: [], final: initial });
    await store.complete(job, initial);
    assert.equal((await store.getVerification(job.id)).attempts[0].audit.decision, 'skipped');
  });

  register('failed and needs-review verification retain processing holds instead of trusting the initial extraction', async t => {
    const { store } = await setup(t);
    const older = source('older', { text: 'I received the decision.', recordedAt: '2026-11-04T12:00:00.000Z' });
    const queued = await store.ingest(older, 'verification-storage-test');
    await store.complete(await store.claim({ jobId: queued.id }), extraction(older, 'positive'));
    for (const decision of ['failed', 'needs_review']) {
      const { job, input, initial, audit } = await prepare(store, source(decision));
      await store.recordVerification(job, audit);
      await store.recordVerification(job, terminal(audit, decision, { issues: decision === 'needs_review'
        ? [{ type: 'uncertain', quote: input.text, detail: 'The requested outcome cannot be resolved.', itemKey: 'result' }] : [] }));
      await reject(() => store.complete(job, initial), 'verification_required');
      await store.failure(job, { code: 'verification_needs_review' }, { maxAttempts: 1 });
      const episode = (await store.state()).episodes[0];
      assert.equal(episode.outcomeState, 'unknown');
      assert.equal(episode.analysisEligible, false);
      assert.equal(episode.items.length, 1);
      await store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed', note: 'Review cannot bypass unfinished verification.' });
      assert.equal((await store.state()).episodes[0].analysisEligible, false);
      assert.equal((await store.getVerification(job.id)).attempts[0].audit.decision, decision);
    }
  });

  register('pending evidence and diagnostics cannot be rewritten during completion', async t => {
    const { store } = await setup(t), { job, input, audit } = await prepare(store);
    const before = await store.recordVerification(job, audit);
    assert.deepEqual(await store.recordVerification(job, audit), before);
    await reject(() => store.recordVerification(job, { ...audit, reasons: ['prior_pending'] }), 'verification_audit_conflict');
    const changedInitial = extraction(input, 'unknown');
    await reject(() => store.recordVerification(job, terminal(audit, 'kept', { initial: changedInitial, final: changedInitial })), 'verification_audit_conflict');
    await reject(() => store.recordVerification(job, terminal(audit, 'kept', { steps: [] })), 'verification_audit_conflict');
    await reject(() => store.recordVerification(job, terminal(audit, 'kept', { steps: [{ ...diagnostic('extraction'), responseId: 'resp_other' }] })), 'verification_audit_conflict');
    assert.deepEqual((await store.getVerification(job.id)).attempts[0], before);
  });

  register('a context change during verification rejects the terminal audit and preserves its pending evidence', async t => {
    const { store } = await setup(t), { job, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await save(store, source('new-same-student-evidence'));
    await reject(() => store.recordVerification(job, terminal(audit)), 'verification_context_changed');
    assert.equal((await store.getVerification(job.id)).attempts[0].audit.decision, 'pending');
    assert.equal((await store.state()).episodes[0].analysisEligible, false);
  });

  register('a context change after verification still rejects publishing an obsolete candidate', async t => {
    const { store } = await setup(t), { job, initial, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await store.recordVerification(job, terminal(audit));
    await save(store, source('late-same-student-evidence'));
    await reject(() => store.complete(job, initial), 'verification_context_changed');
    assert.equal((await store.getVerification(job.id)).job.status, 'running');
    assert.equal((await store.state()).episodes[0].items.length, 1);
  });

  register('another family or sibling cannot invalidate the verification context', async t => {
    const { store } = await setup(t), { job, initial, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await save(store, source('sibling', { studentId: 'sibling' }));
    await save(store, source('other-family', { accountId: 'other-family' }));
    await store.recordVerification(job, terminal(audit));
    await store.complete(job, initial);
    assert.equal((await store.getVerification(job.id)).job.status, 'completed');
  });

  register('manual retry retains immutable past attempts even when the queue attempt count resets', async t => {
    const { store } = await setup(t), { job, input, initial, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await store.recordVerification(job, terminal(audit, 'failed'));
    await store.failure(job, { code: 'verification_failed' }, { maxAttempts: 1 });
    assert.equal((await store.getVerification(job.id)).job.error, 'verification_failed');
    await store.retry(job.id);
    const retry = await store.claim({ jobId: job.id });
    assert.equal(retry.attempts, 1);
    assert.notEqual(retry.token, job.token);
    await reject(() => store.complete(retry, initial), 'verification_required');
    await reject(() => store.recordVerification(job, audit), 'stale_job_lease');
    const next = { ...audit, contextHash: verificationContextHash(input, await store.contextFor(input)) };
    await store.recordVerification(retry, next);
    await store.recordVerification(retry, terminal(next));
    await store.complete(retry, initial);
    const detail = await store.getVerification(job.id);
    assert.deepEqual(detail.attempts.map(attempt => [attempt.attempt, attempt.audit.decision]), [[1, 'failed'], [2, 'kept']]);
    assert.equal(JSON.stringify(detail).includes(retry.token), false);
  });

  register('a crashed verification retains pending evidence after lease expiry and a later retry', async t => {
    const { store, advance } = await setup(t), { job, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    advance(1001);
    assert.equal(await store.claim({ jobId: job.id, maxAttempts: 1 }), null);
    await reject(() => store.recordVerification(job, terminal(audit)), 'stale_job_lease');
    await store.retry(job.id);
    const next = await store.claim({ jobId: job.id });
    await store.recordVerification(next, audit);
    assert.deepEqual((await store.getVerification(job.id)).attempts.map(attempt => [attempt.attempt, attempt.audit.decision]), [[1, 'pending'], [2, 'pending']]);
  });

  register('source revisions retain the original audit source and prevent stale processing', async t => {
    const { store } = await setup(t), { job, input, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await store.ingest({ ...input, version: 2, text: 'The office has now replied.' }, 'verification-storage-test');
    await reject(() => store.recordVerification(job, terminal(audit)), 'stale_job_lease');
    const detail = await store.getVerification(job.id);
    assert.equal(detail.job.status, 'obsolete');
    assert.equal(detail.source.version, 1);
    assert.equal(detail.source.text, input.text);
    assert.equal((await store.source(input.id)).version, 2);
  });

  register('source deletion cascades the audit and legacy no-audit jobs still work', async t => {
    const { store, pool } = await setup(t), { job, input, audit } = await prepare(store);
    await store.recordVerification(job, audit);
    await store.deleteSource(input.id);
    await reject(() => store.getVerification(job.id), 'job_not_found');
    await reject(() => store.recordVerification(job, audit), 'stale_job_lease');
    if (pool) assert.equal(Number((await pool.query('SELECT count(*) AS n FROM origen_network_effects.verification_audits')).rows[0].n), 0);
    await save(store, source('legacy-flow'));
    const completed = (await store.state()).jobs.find(value => value.sourceId === 'legacy-flow');
    assert.equal(completed.status, 'completed');
    assert.deepEqual((await store.getVerification(completed.id)).attempts, []);
  });
}

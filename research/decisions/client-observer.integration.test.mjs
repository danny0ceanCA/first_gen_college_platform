import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObserverState } from './state.mjs';
import { createObserver } from './observer.mjs';
import { createDecisionsClient } from './client.mjs';
import { createBudgetLedger } from './budget.mjs';
import { SUPPORT_NEEDS } from './rubric.mjs';

const usage = { input_tokens: 1000, output_tokens: 0, total_tokens: 1000,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
function providerResponse(choice = 'starting_point') {
  return { model: 'gpt-6-luna', usage, answers: [
    { name: 'support_need', type: 'choice', choice, confidence: 0.96,
      probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === choice ? 0.96 : 0.01 })) },
    { name: 'already_addressed', type: 'predicate', probability: 0.02 },
  ] };
}
function setup(t, language = 'en', question = 'Where do I start learning about college?') {
  const directory = mkdtempSync(join(tmpdir(), 'origen-decisions-integration-'));
  const budget = createBudgetLedger({ path: join(directory, 'decisions.sqlite'), capUsd: 0.1 });
  t.after(() => { budget.close(); rmSync(directory, { recursive: true, force: true }); });
  const state = createObserverState({ fictional: true, accountId: 'fictional-account', callId: `fictional-call-${language}`, studentId: 'fictional-student', language });
  assert.equal(state.apply({ type: 'question', id: 'question-1', text: question }).accepted, true);
  assert.equal(state.apply({ type: 'transcript', id: 'user-1', role: 'user', text: question, startMs: 0, endMs: 1500, complete: true }).accepted, true);
  return { state, budget };
}

for (const [language, question] of [['en', 'Where do I start learning about college?'], ['es', '¿Por dónde empiezo a aprender sobre la universidad?']]) {
  test(`real client/rubric/observer/budget integration stays observe-only in ${language}`, async (t) => {
    const { state, budget } = setup(t, language, question);
    let fetches = 0;
    const client = createDecisionsClient({ apiKey: 'fake-key', fetchImpl: async (url, options) => {
      fetches++;
      assert.equal(url, 'https://api.openai.com/v1/decisions');
      const request = JSON.parse(options.body);
      assert.deepEqual(request.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
      assert.deepEqual(Object.keys(request).sort(), ['input', 'model', 'prompt_cache_options', 'questions']);
      assert.equal(JSON.parse(request.input).currentQuestion.text, question);
      assert.equal(JSON.parse(request.input).language, language);
      assert.ok(!request.input.includes('fictional-account'));
      return Response.json(providerResponse(), { headers: { 'x-request-id': `req_${language}` } });
    } });
    const observer = createObserver({ state, client, budget, mode: 'observe' });
    const before = state.snapshot();
    assert.deepEqual(observer.observe(), { queued: true });
    await observer.idle();
    assert.equal(observer.observe().reason, 'duplicate');
    const [record] = observer.records();
    assert.equal(record.status, 'completed');
    assert.equal(record.disposition, 'uncalibrated');
    assert.equal(record.requestId, `req_${language}`);
    assert.equal(record.intervention, false);
    assert.equal(record.contextSent, false);
    assert.equal(record.playbackClaim, false);
    assert.deepEqual(state.snapshot(), before);
    assert.equal(fetches, 1);
    assert.equal(budget.summary().spentUsd, 0.0001);
    assert.equal(budget.summary().reservedUsd, 0);
    observer.close();
  });
}

test('observer transport timeout holds durable reservation without retries or state mutations', async (t) => {
  const { state, budget } = setup(t);
  let fetches = 0;
  const client = createDecisionsClient({ apiKey: 'fake-key', timeoutMs: 15, fetchImpl: () => { fetches++; return new Promise(() => {}); } });
  const observer = createObserver({ state, client, budget, mode: 'observe' });
  const before = state.snapshot();
  observer.observe();
  await observer.idle();
  assert.equal(observer.records()[0].reason, 'timeout');
  assert.equal(budget.summary().unknownCount, 1);
  assert.equal(budget.summary().reservedUsd, 0.05);
  assert.equal(fetches, 1);
  assert.deepEqual(state.snapshot(), before);
  observer.close();
});

test('missing usage is unavailable and keeps reservation through repeated unknown marking', async (t) => {
  const { state, budget } = setup(t);
  const value = providerResponse(); delete value.usage;
  const client = createDecisionsClient({ apiKey: 'fake-key', fetchImpl: async () => Response.json(value) });
  const observer = createObserver({ state, client, budget, mode: 'observe' });
  observer.observe(); await observer.idle();
  assert.equal(observer.records()[0].reason, 'invalid_usage');
  assert.equal(budget.summary().unknownCount, 1);
  assert.equal(budget.summary().reservedUsd, 0.05);
  observer.close();
});

test('a stale response is accounted but cannot become a current observation', async (t) => {
  const { state, budget } = setup(t);
  let finish;
  const client = createDecisionsClient({ apiKey: 'fake-key', fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const observer = createObserver({ state, client, budget, mode: 'observe' });
  observer.observe();
  assert.equal(state.apply({ type: 'question', id: 'changed', text: 'Actually, what does an application mean?' }).accepted, true);
  finish(Response.json(providerResponse()));
  await observer.idle();
  assert.equal(observer.records()[0].status, 'discarded');
  assert.equal(observer.records()[0].reason, 'stale_after_request');
  assert.equal(budget.summary().spentUsd, 0.0001);
  assert.equal(budget.summary().reservedUsd, 0);
  observer.close();
});

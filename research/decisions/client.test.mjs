import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionsClient, DECISIONS_ENDPOINT } from './client.mjs';

const request = () => ({ model: 'gpt-6-luna', input: 'Fictional family question.', questions: [{ type: 'predicate', name: 'needs_research', instructions: 'Does this ask for current official information?' }] });
const errorCode = (code) => (error) => error.code === code && !error.message.includes('fake-secret');

test('fixed endpoint, explicit disabled caching, request ID and no hidden provider fields', async () => {
  let calls = 0;
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, DECISIONS_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fake-secret');
    assert.deepEqual(JSON.parse(options.body), { ...request(), prompt_cache_options: { mode: 'explicit', ttl: '30m' } });
    return new Response('{"answers":[]}', { headers: { 'x-request-id': 'req_test' } });
  } });
  const result = await evaluate(request());
  assert.deepEqual(result.response, { answers: [] });
  assert.equal(result.requestId, 'req_test');
  assert.ok(result.durationMs >= 0);
  assert.equal(calls, 1);
});

test('rejects Responses/Live keys, wrong model, malformed questions and caching before fetch', async () => {
  let calls = 0;
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => { calls++; } });
  for (const key of ['store', 'tools', 'conversation', 'previous_response_id', 'background', 'delegation', 'endpoint', 'prompt_cache_key']) {
    await assert.rejects(evaluate({ ...request(), [key]: true }), errorCode('invalid_request'));
  }
  for (const change of [{ model: 'gpt-live-1' }, { questions: [] }, { input: {} }, { questions: [{ type: 'function', instructions: 'test' }] }, { prompt_cache_options: { mode: 'implicit' } }]) {
    await assert.rejects(evaluate({ ...request(), ...change }), errorCode('invalid_request'));
  }
  await assert.rejects(evaluate({ ...request(), input: [{ role: 'user', content: [{ type: 'input_text', text: 'test', prompt_cache_breakpoint: { mode: 'explicit' } }] }] }), errorCode('invalid_request'));
  assert.equal(calls, 0);
});

test('enforces UTF-8 request cap and cyclic input without fetching', async () => {
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => assert.fail('unexpected fetch') });
  await assert.rejects(evaluate({ ...request(), input: 'ñ'.repeat(17000) }), errorCode('invalid_request'));
  const cyclic = []; cyclic.push(cyclic);
  await assert.rejects(evaluate({ ...request(), input: cyclic }), errorCode('invalid_request'));
});

test('HTTP errors expose status and request ID without provider body or retries', async () => {
  let calls = 0;
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => {
    calls++; return new Response('raw confidential student text fake-secret', { status: 429, headers: { 'x-request-id': 'req_limit' } });
  } });
  await assert.rejects(evaluate(request()), (error) => error.code === 'http_error' && error.status === 429 && error.requestId === 'req_limit' && !error.message.includes('confidential'));
  assert.equal(calls, 1);
});

test('invalid JSON, nonobject JSON, and transport failures remain distinguishable', async () => {
  for (const [body, code] of [['{', 'invalid_json'], ['[]', 'invalid_response'], ['null', 'invalid_response']]) {
    const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => new Response(body) });
    await assert.rejects(evaluate(request()), errorCode(code));
  }
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => { throw new Error('fake-secret raw transport'); } });
  await assert.rejects(evaluate(request()), errorCode('transport_error'));
});

test('one MiB response cap rejects content-length and streamed oversized bodies', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': '1048577' } }), new Response('x'.repeat(1048577))]) {
    const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: async () => response });
    await assert.rejects(evaluate(request()), errorCode('response_too_large'));
  }
});

test('timeout bounds a fetch that ignores abort; it never retries', async () => {
  let calls = 0;
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', timeoutMs: 15, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const start = Date.now();
  await assert.rejects(evaluate(request()), errorCode('timeout'));
  assert.ok(Date.now() - start < 1000);
  assert.equal(calls, 1);
});

test('timeout covers response bodies and cancels their stream', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', timeoutMs: 15, fetchImpl: async () => new Response(body) });
  await assert.rejects(evaluate(request()), errorCode('timeout'));
  assert.equal(cancelled, true);
});

test('caller cancellation is bounded even when fetch ignores signal', async () => {
  let calls = 0;
  const { evaluate } = createDecisionsClient({ apiKey: 'fake-secret', fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(evaluate(request(), { signal: cancelled.signal }), errorCode('aborted'));
  assert.equal(calls, 0);
  const active = new AbortController();
  const pending = evaluate(request(), { signal: active.signal });
  active.abort();
  await assert.rejects(pending, errorCode('aborted'));
  assert.equal(calls, 1);
});

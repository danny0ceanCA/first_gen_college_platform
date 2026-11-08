import test from 'node:test';
import assert from 'node:assert/strict';
import { broadFixtures } from './broad-fixtures.mjs';
import { broadPolicy, BROAD_PREDICATES } from './broad-rubric.mjs';
import { createObserver } from './observer.mjs';
import { createDecisionsClient } from './client.mjs';
import { SUPPORT_NEEDS } from './rubric.mjs';
import { stateForBroadFixture, scoreBroadObservation, evaluateBroadResults, main } from './broad-cli.mjs';

test('all fictional bilingual evidence traverses bounded state without leaking expected labels', () => {
  const counts = { en: 0, es: 0 };
  for (const fixture of broadFixtures) {
    counts[fixture.language]++;
    const snapshot = stateForBroadFixture(fixture).snapshot();
    assert.deepEqual(snapshot.recentTranscripts.map(t => t.text), fixture.transcripts.map(t => t.text));
    const request = broadPolicy.buildRequest(snapshot);
    const input = JSON.parse(request.input);
    assert.equal(input.expected, undefined);
    assert.equal(input.expectedUnavailable, undefined);
    assert.equal(input.fingerprint, undefined);
    assert.equal(request.input.includes(fixture.id), false);
    assert.equal(request.questions.length, 8);
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 32768);
  }
  assert.ok(counts.en >= 18);
  assert.equal(counts.en, counts.es);
});

test('broad CLI defaults to offline and rejects arbitrary files and budget changes', async () => {
  const summary = await main([]);
  assert.equal(summary.fixturesValidated, broadFixtures.length);
  assert.equal(summary.apiCalls, 0);
  await assert.rejects(main(['--real', '--input', 'account.json']), /unsupported_cli_option/);
  await assert.rejects(main(['--real', '--cap-usd', '3']), /unsupported_cli_option/);
  await assert.rejects(main(['--fixture-ids', 'unknown']), /unknown_fixture/);
});

for (const language of ['en', 'es']) test(`broad ${language} client to observer reports independent observations and retains scoped evidence`, async () => {
  const fixture = broadFixtures.find(f => f.language === language && f.pairId === 'coexisting');
  const state = stateForBroadFixture(fixture);
  const before = state.snapshot();
  let requests = 0, settled = 0;
  const client = createDecisionsClient({ apiKey: 'fictional-key', fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.input);
    assert.equal(input.researchTasks[0].findings.length, 2);
    assert.equal(input.researchTasks[0].findings[0].limitation, fixture.researchTasks[0].findings[0].limitation);
    return Response.json({ model: 'gpt-6-luna', usage: {}, answers: [
      { name: 'support_need', type: 'choice', choice: fixture.expected.supportNeed, confidence: 0.99,
        probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === fixture.expected.supportNeed ? 1 : 0 })) },
      { name: 'already_addressed', type: 'predicate', probability: 0 },
      ...BROAD_PREDICATES.map(name => ({ name, type: 'predicate', probability: fixture.expected.predicates[name] ? 0.9 : 0.1 })),
      { name: 'comparison_scope_sufficient', type: 'predicate', probability: 0.9 },
    ] }, { headers: { 'x-request-id': 'fictional-request' } });
  } });
  const observer = createObserver({ state, client, policy: broadPolicy, mode: 'observe',
    budget: { reserve: () => ({ id: 'test-reservation' }), settle: () => settled++, markUnknown() { throw Error('unexpected_unknown'); } } });
  observer.observe(); await observer.idle();
  const observation = observer.records()[0];
  assert.equal(observation.status, 'completed');
  assert.equal(observation.disposition.actionAuthorized, false);
  assert.equal(observation.disposition.predicates.comparison_mismatch.status, 'observed');
  assert.equal(observation.contextSent, false);
  assert.deepEqual(observation.researchJobIds, fixture.researchTasks.map(t => t.jobId));
  assert.deepEqual(state.snapshot(), before);
  assert.equal(observer.observe().reason, 'duplicate');
  assert.equal(requests, 1); assert.equal(settled, 1);
  const scored = scoreBroadObservation(fixture, observation);
  assert.deepEqual(scored.mismatches, []);
  assert.equal(evaluateBroadResults([scored]).overall.exactCases, 1);
  observer.close();
});

test('report separates unavailable evidence and model failures from correct negatives', () => {
  const fixture = broadFixtures[0];
  const failed = scoreBroadObservation(fixture, { status: 'unavailable', reason: 'timeout' });
  const evaluation = evaluateBroadResults([failed]);
  assert.equal(evaluation.overall.cases, 1);
  assert.equal(evaluation.overall.completed, 0);
  assert.equal(evaluation.overall.exactCases, 0);
  assert.equal(evaluation.failures.length, 1);
  assert.equal(evaluation.overall.predicates.comparison_mismatch.correctStatus, 0);
});

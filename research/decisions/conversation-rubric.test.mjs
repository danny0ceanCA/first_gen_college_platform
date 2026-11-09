import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_NEEDS } from './rubric.mjs';
import { BROAD_PREDICATES, BROAD_EVIDENCE_CHECKS } from './broad-rubric.mjs';
import { PREFERENCES, PREFERENCE_ACTIONS, preferencePolicy } from './preference-rubric.mjs';
import { conversationPolicy, CONFUSION_ACTIONS, CONTINUATION_ACTIONS } from './conversation-rubric.mjs';
import { continuationFixtures, continuationContextFixtures, continuationFixtureSnapshot } from './continuation-fixtures.mjs';
import { affirmativeAcknowledgment } from './conversation-evidence.mjs';
import { createDecisionsClient, MAX_DECISIONS_REQUEST_BYTES } from './client.mjs';

const fixture = id => continuationFixtures.find(value => value.id === `en-conversation-${id}`);
const snapshot = id => continuationFixtureSnapshot(fixture(id));
const choice = (name, values, selected) => ({ name, type: 'choice', choice: selected, confidence: 0.99,
  probabilities: values.map(value => ({ value, probability: value === selected ? 0.96 : 0.04 / (values.length - 1) })) });
function response(confusion = 'none', continuation = 'none') {
  return { model: 'gpt-6-luna', answers: [choice('support_need', SUPPORT_NEEDS, 'none'),
    { name: 'already_addressed', type: 'predicate', probability: 0.01 },
    ...[...BROAD_PREDICATES, ...BROAD_EVIDENCE_CHECKS].map(name => ({ name, type: 'predicate', probability: 0.01 })),
    ...PREFERENCES.map(name => choice(`preference_${name}`, PREFERENCE_ACTIONS, 'unchanged')),
    choice('confusion_state', CONFUSION_ACTIONS, confusion), choice('continuation_acceptance', CONTINUATION_ACTIONS, continuation),
  ] };
}

test('one independent request extends preferences without exposing expected labels or identity', () => {
  assert.equal(continuationFixtures.length, 32);
  assert.deepEqual([...new Set(continuationFixtures.map(f => f.language))], ['en', 'es']);
  for (const value of continuationFixtures) {
    const state = continuationFixtureSnapshot(value);
    state.expected = value.expected; state.accountId = 'PRIVATE_ACCOUNT'; state.secret = 'PRIVATE_SECRET';
    const request = conversationPolicy.buildRequest(state);
    assert.equal(request.questions.length, 12);
    assert.deepEqual(request.questions.slice(0, 10), preferencePolicy.buildRequest(state).questions);
    assert.deepEqual(request.questions.slice(10).map(q => q.name), ['confusion_state', 'continuation_acceptance']);
    assert.equal(JSON.stringify(request).includes('PRIVATE_'), false);
    assert.equal(Object.hasOwn(JSON.parse(request.input), 'expected'), false);
  }
  assert.equal(conversationPolicy.disposition, preferencePolicy.disposition);
});

test('latest caller is anchored, incomplete input never falls back, only immediate assistant offer is provided', () => {
  const get = state => JSON.parse(conversationPolicy.buildRequest(state).input).conversationContribution;
  const answered = get(snapshot('already-answered'));
  assert.equal(answered.caller.text, 'Yes.'); assert.equal(answered.caller.span, 2);
  assert.equal(answered.previousAssistant.span, 1); assert.equal(answered.assistantAfterCaller.length, 1);
  const incomplete = get(snapshot('unfinished'));
  assert.equal(incomplete.caller.complete, false);
  const state = snapshot('accept-example');
  state.recentTranscripts.push({ ...state.recentTranscripts.at(-1), id: 'turn-3', text: 'Actually—', complete: false });
  const changed = get(state);
  assert.equal(changed.caller.text, 'Actually—'); assert.equal(changed.caller.complete, false);
  assert.equal(changed.previousAssistant, null);
  const empty = snapshot('standalone-okay'); empty.recentTranscripts = [];
  assert.equal(get(empty), null);
});

test('independent typed labels preserve probabilities without granting authority or lasting preferences', () => {
  for (const confusion of CONFUSION_ACTIONS) for (const continuation of CONTINUATION_ACTIONS) {
    const parsed = conversationPolicy.parseResponse(response(confusion, continuation));
    assert.equal(parsed.status, 'completed');
    assert.deepEqual(parsed.result.conversationSupport, {
      confusion: { action: confusion, confidence: 0.99, selectedProbability: 0.96 },
      continuation: { action: continuation, confidence: 0.99, selectedProbability: 0.96 },
    });
    assert.ok(parsed.result.preferenceChanges.every(change => change.action === 'unchanged'));
    assert.equal(conversationPolicy.disposition(snapshot('accept-example'), parsed.result).actionAuthorized, false);
  }
});

test('malformed labels and every individual refusal fail closed', () => {
  for (const mutate of [r => r.answers.pop(), r => r.answers.push(r.answers[11]),
    r => { r.answers[10].name = 'other'; }, r => { [r.answers[10], r.answers[11]] = [r.answers[11], r.answers[10]]; },
    r => { r.answers[10].type = 'predicate'; }, r => { r.answers[10].choice = 'start_research'; },
    r => { r.answers[11].confidence = NaN; }, r => { r.answers[10].confidence = 1.1; },
    r => { r.answers[10].probabilities.pop(); }, r => { r.answers[10].probabilities[0].probability = -1; },
    r => { r.answers[11].probabilities[0].probability = '0.1'; }, r => { r.answers[11].probabilities[0].probability = 0.8; },
    r => { r.answers[11].probabilities[0].value = 'declined'; }, r => { r.answers[10].probabilities[0].value = 'freeform'; },
    r => { r.answers[9].choice = 'continue'; }, r => { r.model = ''; }]) {
    const value = response(); mutate(value);
    const parsed = conversationPolicy.parseResponse(value);
    assert.equal(parsed.status, 'invalid'); assert.equal(parsed.result, null);
  }
  for (let index = 0; index < 12; index++) {
    const value = response(); value.answers[index] = { name: value.answers[index].name, type: 'refusal' };
    assert.equal(conversationPolicy.parseResponse(value).status, 'refused');
  }
});

test('local authorization and bounded input still apply', () => {
  for (const patch of [{ fictional: false, isolatedLocal: false }, { authorized: false }, { closed: true }])
    assert.throws(() => conversationPolicy.buildRequest({ ...snapshot('confused'), ...patch }), /ineligible_snapshot/);
  const state = snapshot('confused'); state.recentTranscripts.at(-1).text = 'words '.repeat(10000);
  assert.throws(() => conversationPolicy.buildRequest(state), /request_too_large/);
});

test('a long bilingual call sends a bounded request with the latest exchange and qualified research intact', async () => {
  for (const language of ['en', 'es']) {
    const state = snapshot('accept-example');
    const oldText = language === 'en' ? 'An older topic with "quoted" words. ' : 'Un tema anterior con palabras «entre comillas» y "citas". ';
    const offer = language === 'en' ? 'Would you like a concrete example?' : '¿Quieres un ejemplo concreto?';
    const yes = language === 'en' ? 'Yes.' : 'Sí.';
    const answer = language === 'en' ? 'Here is a concrete example.' : 'Aquí tienes un ejemplo concreto.';
    const newest = [offer, yes, yes, yes, answer];
    state.language = language;
    state.recentTranscripts = [
      ...Array.from({ length: 11 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant', text: oldText.repeat(30),
      })),
      ...newest.map((text, index) => ({ role: index === 0 || index === 4 ? 'assistant' : 'user', text })),
    ].map((row, index) => ({ ...row, id: 'turn-' + index, complete: true, connectionEpoch: 0,
      startMs: index * 800, endMs: index * 800 + 300 }));
    state.currentQuestion = { text: yes };
    const finding = { fact: 'Tuition and fees, before aid.', year: '2026–27', scenario: 'Resident',
      limitation: 'Housing and health insurance are separate.', status: 'verified',
      subject: 'Fictional campus', aspect: 'tuition', sourceIds: ['official-fixture'] };
    state.researchTasks = [{ jobId: 'newest-job', revision: 1, status: 'completed',
      question: 'What does the campus bill?', evidenceAvailability: 'available', findings: [finding] }];
    const before = structuredClone(state);
    const request = conversationPolicy.buildRequest(state);
    const client = createDecisionsClient({ apiKey: 'fixture-key', fetchImpl: async (_url, options) => {
      assert.ok(Buffer.byteLength(options.body, 'utf8') <= MAX_DECISIONS_REQUEST_BYTES);
      const wire = JSON.parse(options.body);
      const evidence = JSON.parse(wire.input);
      assert.equal(wire.questions.length, 12);
      assert.equal(evidence.olderEvidenceOmitted, true);
      assert.equal(evidence.currentQuestion.text, yes);
      assert.equal(evidence.currentContribution.span, 15);
      assert.equal(evidence.preferenceContribution.span, 15);
      assert.equal(evidence.conversationContribution.previousAssistant.text, offer);
      assert.deepEqual(evidence.conversationContribution.repeatedAcknowledgments.map(row => row.span), [13, 14]);
      assert.equal(evidence.conversationContribution.assistantAfterCaller[0].text, answer);
      const [retained] = evidence.researchTasks[0].findings;
      assert.equal(retained.fact, finding.fact);
      assert.equal(retained.limitation, finding.limitation);
      assert.equal(retained.sourceCount, 1);
      return new Response(JSON.stringify(response()), { status: 200 });
    } });
    await client.evaluate(request);
    assert.deepEqual(state, before);
  }
});

test('English and Spanish repeated affirmative spans retain the same offer with a fresh latest caller anchor', () => {
  assert.equal(continuationFixtures.length, 32, 'offline edge cases do not expand the paid suite');
  assert.equal(continuationContextFixtures.length, 4);
  for (const fixture of continuationContextFixtures) {
    const state = continuationFixtureSnapshot(fixture);
    const input = JSON.parse(conversationPolicy.buildRequest(state).input);
    const value = input.conversationContribution;
    assert.equal(value.caller.span, 3);
    assert.equal(value.caller.text, fixture.turns[2].text);
    if (fixture.id.includes('repeated-ack')) {
      assert.equal(value.previousAssistant.span, 1);
      assert.deepEqual(value.repeatedAcknowledgments.map(turn => turn.span), [2]);
    } else {
      assert.equal(value.previousAssistant, null);
      assert.deepEqual(value.repeatedAcknowledgments, []);
    }
    assert.equal(Object.hasOwn(input, 'expected'), false);
  }
});

test('offer-context grouping respects chronology, completion, connection epochs and the bounded span count', () => {
  const base = continuationFixtureSnapshot(continuationContextFixtures[0]);
  const get = state => JSON.parse(conversationPolicy.buildRequest(state).input).conversationContribution;
  for (const mutate of [
    s => { s.recentTranscripts[2].endMs = 6000; },
    s => { s.recentTranscripts[1].complete = false; },
    s => { s.recentTranscripts[2].complete = false; },
    s => { s.recentTranscripts[1].startMs = undefined; },
    s => { s.recentTranscripts[2].startMs = undefined; },
    s => { s.recentTranscripts[1].connectionEpoch = 1; },
    s => { s.recentTranscripts[0].connectionEpoch = 1; },
    s => { s.recentTranscripts[0].complete = false; },
    s => { s.recentTranscripts[1].endMs = 2500; },
    s => { s.recentTranscripts[0].endMs = 1500; },
    s => { s.recentTranscripts[1].text = 'Actually, explain admissions first.'; },
    s => { s.recentTranscripts[1].text = 'No.'; },
  ]) {
    const state = structuredClone(base); mutate(state);
    assert.equal(get(state).previousAssistant, null);
    assert.deepEqual(get(state).repeatedAcknowledgments, []);
  }
  const three = structuredClone(base);
  three.recentTranscripts.push({ ...three.recentTranscripts.at(-1), id: 'turn-4', startMs: 3000, endMs: 3400 });
  assert.equal(get(three).previousAssistant.span, 1);
  assert.equal(get(three).repeatedAcknowledgments.length, 2);
  const four = structuredClone(three);
  four.recentTranscripts.push({ ...four.recentTranscripts.at(-1), id: 'turn-5', startMs: 3500, endMs: 3900 });
  assert.equal(get(four).previousAssistant, null, 'do not search through more than two earlier acknowledgments');
  const answered = structuredClone(base);
  answered.recentTranscripts.splice(2, 0, { id: 'answer', role: 'assistant', text: 'Here is the example.', complete: true, connectionEpoch: 0, startMs: 1500, endMs: 1800 });
  assert.equal(get(answered).previousAssistant.text, 'Here is the example.', 'do not cross an intervening assistant response');
  assert.deepEqual(get(answered).repeatedAcknowledgments, []);
});

test('shared affirmative grouping predicate excludes substantive requests, negative replies and quotations', () => {
  for (const text of ['Okay.', 'Sure, yes.', 'Yes, please.', 'Sí, por favor.', 'Claro.', 'De acuerdo.'])
    assert.equal(affirmativeAcknowledgment(text), true, text);
  for (const text of ['No.', 'Maybe.', 'Okay, but what is the deadline?', 'Sí, pero quiero preguntar otra cosa.', '"Yes"', 'yes '.repeat(40), null])
    assert.equal(affirmativeAcknowledgment(text), false);
});

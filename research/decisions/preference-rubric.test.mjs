import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_NEEDS } from './rubric.mjs';
import { BROAD_PREDICATES, BROAD_EVIDENCE_CHECKS, broadPolicy } from './broad-rubric.mjs';
import { PREFERENCES, PREFERENCE_ACTIONS, preferencePolicy, buildPreferenceDecisionRequest, parsePreferenceDecisionResponse } from './preference-rubric.mjs';
import { preferenceFixtures, preferenceFixtureSnapshot } from './preference-fixtures.mjs';
import { createPreferenceCandidateBridge } from './local-call/preference-candidates.mjs';

const fixture = id => preferenceFixtures.find(value => value.id === `en-preference-${id}`);
const snapshot = id => preferenceFixtureSnapshot(fixture(id));
function response(actions = {}) {
  return { model: 'gpt-6-luna', answers: [
    { name: 'support_need', type: 'choice', choice: 'none', confidence: 0.99,
      probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === 'none' ? 0.96 : 0.01 })) },
    { name: 'already_addressed', type: 'predicate', probability: 0.01 },
    ...[...BROAD_PREDICATES, ...BROAD_EVIDENCE_CHECKS].map(name => ({ name, type: 'predicate', probability: 0.01 })),
    ...PREFERENCES.map(preference => ({ name: `preference_${preference}`, type: 'choice', choice: actions[preference] ?? 'unchanged', confidence: 0.99,
      probabilities: PREFERENCE_ACTIONS.map(value => ({ value, probability: value === (actions[preference] ?? 'unchanged') ? 0.98 : 0.01 })) })),
  ] };
}
const stamp = { scopeGeneration: 1, inputRevision: 2, questionId: 'turn-1', studentId: 'fictional-preference-student', sessionId: 'fictional-call' };
const stampedSnapshot = () => ({ ...snapshot('plain'), callId: 'fictional-call', fingerprint: 'snapshot-1' });
const row = patch => ({ fingerprint: 'snapshot-1', status: 'completed', reason: null, studentId: stamp.studentId,
  callId: 'fictional-call', operationId: 'operation-1', requestId: 'request-1', sourceTranscriptIds: ['turn-1'],
  result: parsePreferenceDecisionResponse(response({ plain_language: 'enable' })).result, ...patch });

test('preferences extend the existing independent request once and isolate latest caller evidence', () => {
  for (const value of preferenceFixtures) {
    const state = preferenceFixtureSnapshot(value);
    state.expected = value.expected; state.accountId = 'PRIVATE_ACCOUNT'; state.secret = 'PRIVATE_SECRET';
    const request = buildPreferenceDecisionRequest(state);
    assert.deepEqual(request.questions.slice(0, 8), broadPolicy.buildRequest(state).questions);
    assert.equal(request.questions.length, 10);
    assert.deepEqual(request.questions.slice(8).map(q => q.name), PREFERENCES.map(key => `preference_${key}`));
    assert.equal(request.questions.slice(8).every(q => q.type === 'choice'), true);
    assert.equal(JSON.stringify(request).includes('PRIVATE_'), false);
    assert.equal(Object.hasOwn(JSON.parse(request.input), 'expected'), false);
    const lastUser = [...value.turns].reverse().find(turn => turn.role === 'user');
    assert.equal(JSON.parse(request.input).preferenceContribution.text, lastUser.text);
    assert.equal(JSON.parse(request.input).preferenceContribution.complete, lastUser.complete);
  }
  const input = JSON.parse(buildPreferenceDecisionRequest(snapshot('assistant-started')).input);
  assert.equal(input.preferenceContribution.span, 1);
  assert.equal(input.transcripts.at(-1).role, 'assistant');
  assert.equal(preferencePolicy.disposition, broadPolicy.disposition);
});

test('enable, disable and unchanged stay distinct; valid choice distributions preserve confidence', () => {
  for (const action of PREFERENCE_ACTIONS) {
    const parsed = parsePreferenceDecisionResponse(response({ plain_language: action, one_step_at_a_time: action }));
    assert.equal(parsed.status, 'completed');
    assert.deepEqual(parsed.result.preferenceChanges, PREFERENCES.map(preference => ({ preference, action, selectedProbability: 0.98, confidence: 0.99 })));
    assert.equal(preferencePolicy.disposition(snapshot('plain'), parsed.result).actionAuthorized, false);
  }
});

test('wrong shape, identity, type and probabilities fail closed; every individual refusal stays refused', () => {
  const valid = response();
  for (const mutate of [
    r => r.answers.pop(), r => r.answers.push(r.answers[9]), r => { r.answers[8].name = 'plain_language'; },
    r => { [r.answers[8], r.answers[9]] = [r.answers[9], r.answers[8]]; },
    r => { r.answers[8].choice = 'research'; }, r => { r.answers[8].type = 'predicate'; },
    r => { r.answers[8].confidence = NaN; }, r => { r.answers[8].confidence = 1.1; },
    r => { r.answers[8].probabilities[0].probability = '0.98'; }, r => { r.answers[8].probabilities[0].probability = -1; },
    r => { r.answers[8].probabilities[0].probability = 0.5; }, r => { r.answers[8].probabilities.pop(); },
    r => { r.answers[8].probabilities[0].value = 'freeform'; }, r => { r.answers[8].probabilities[0].value = 'enable'; },
    r => { r.answers[2].probability = Infinity; }, r => { r.model = ''; },
  ]) {
    const changed = structuredClone(valid); mutate(changed);
    assert.equal(parsePreferenceDecisionResponse(changed).status, 'invalid');
    assert.equal(parsePreferenceDecisionResponse(changed).result, null);
  }
  for (let index = 0; index < 10; index++) {
    const changed = structuredClone(valid); changed.answers[index] = { name: changed.answers[index].name, type: 'refusal' };
    assert.equal(parsePreferenceDecisionResponse(changed).status, 'refused');
    assert.equal(parsePreferenceDecisionResponse(changed).result, null);
  }
});

test('isolated authorization and bounded input guards still apply', () => {
  for (const patch of [{ fictional: false, isolatedLocal: false }, { closed: true }, { authorized: false }])
    assert.throws(() => buildPreferenceDecisionRequest({ ...snapshot('plain'), ...patch }), /ineligible_snapshot/);
  const state = snapshot('plain'); state.recentTranscripts[0].text = 'word '.repeat(10000);
  assert.throws(() => buildPreferenceDecisionRequest(state), /request_too_large/);
});

test('stale assistant observation may project preferences only, preserving its original status and provenance', () => {
  const bridge = createPreferenceCandidateBridge({ enabled: true });
  assert.equal(bridge.capture(stampedSnapshot(), stamp), true);
  const candidate = bridge.project(row({ status: 'discarded', reason: 'stale_after_request' }));
  assert.equal(candidate.record.status, 'completed');
  assert.equal(candidate.record.sourceStatus, 'discarded');
  assert.equal(candidate.record.sourceReason, 'stale_after_request');
  assert.deepEqual(candidate.record.sourceTranscriptIds, ['turn-1']);
  assert.deepEqual(Object.keys(candidate.record.result), ['preferenceChanges']);
  assert.deepEqual(candidate.stamp, stamp);
  assert.equal(candidate.record.result.preferenceChanges.plain_language.action, 'enable');
});

test('disabled, missing or incomplete scope, wrong latest user, failed and refused results never project', () => {
  assert.equal(createPreferenceCandidateBridge().capture(stampedSnapshot(), stamp), false);
  for (const patch of [{ questionId: 'different-user' }, { studentId: 'other-student' }, { inputRevision: -1 },
    { scopeGeneration: 1.5 }, { sessionId: '' }, { questionId: null }]) {
    assert.equal(createPreferenceCandidateBridge({ enabled: true }).capture(stampedSnapshot(), { ...stamp, ...patch }), false);
  }
  for (const patch of [{ closed: true }, { authorized: false }, { recentTranscripts: [{ id: 'turn-1', role: 'user', complete: false }] }])
    assert.equal(createPreferenceCandidateBridge({ enabled: true }).capture({ ...stampedSnapshot(), ...patch }, stamp), false);
  for (const patch of [{ status: 'refused' }, { status: 'unavailable' }, { status: 'invalid' }, { status: 'skipped' },
    { status: 'discarded', reason: 'stale_before_request' }, { status: 'discarded', reason: 'coalesced' },
    { result: null }, { studentId: 'other-student' }, { callId: 'other-call' }, { result: { preferenceChanges: [{ preference: 'research', action: 'enable' }] } }]) {
    const bridge = createPreferenceCandidateBridge({ enabled: true }); bridge.capture(stampedSnapshot(), stamp);
    assert.equal(bridge.project(row(patch)), null);
  }
});

test('assistant boundary cannot resend the same user preference, but a fresh explicit contribution can change it', () => {
  const bridge = createPreferenceCandidateBridge({ enabled: true });
  const captured = structuredClone(stamp); bridge.capture(stampedSnapshot(), captured); captured.inputRevision = 90;
  assert.equal(bridge.project(row()).stamp.inputRevision, stamp.inputRevision);
  bridge.capture({ ...stampedSnapshot(), fingerprint: 'assistant-boundary' }, stamp);
  assert.equal(bridge.project(row({ fingerprint: 'assistant-boundary' })), null);
  const updated = { ...stamp, questionId: 'turn-3', inputRevision: 3 };
  bridge.capture({ ...stampedSnapshot(), fingerprint: 'new-user', recentTranscripts: [{ id: 'turn-3', role: 'user', complete: true }] }, updated);
  const result = parsePreferenceDecisionResponse(response({ plain_language: 'disable' })).result;
  assert.equal(bridge.project(row({ fingerprint: 'new-user', result })).record.result.preferenceChanges.plain_language.action, 'disable');
  bridge.capture({ ...stampedSnapshot(), fingerprint: 'pending' }, stamp); bridge.clear();
  assert.equal(bridge.project(row({ fingerprint: 'pending' })), null);
});

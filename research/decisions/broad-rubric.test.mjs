import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_NEEDS, buildDecisionRequest } from './rubric.mjs';
import { BROAD_PREDICATES, BROAD_EVIDENCE_CHECKS, broadPolicy, buildBroadDecisionRequest, parseBroadDecisionResponse, broadDisposition } from './broad-rubric.mjs';
import { broadFixtures, broadFixtureSnapshot } from './broad-fixtures.mjs';

function response(labels = {}) {
  const choice = labels.supportNeed ?? 'none';
  return { model: 'gpt-6-luna', answers: [
    { name: 'support_need', type: 'choice', choice, confidence: 0.9,
      probabilities: SUPPORT_NEEDS.map(value => ({ value, probability: value === choice ? 0.96 : 0.01 })) },
    { name: 'already_addressed', type: 'predicate', probability: labels.alreadyAddressed ? 0.99 : 0.01 },
    ...BROAD_PREDICATES.map(name => ({ name, type: 'predicate', probability: labels.predicates?.[name] ? 0.99 : 0.01 })),
    ...BROAD_EVIDENCE_CHECKS.map(name => ({ name, type: 'predicate', probability: labels.evidenceChecks?.[name] ? 0.99 : 0.01 })),
  ] };
}
const fixture = id => broadFixtures.find(f => f.id === `en-broad-${id}`);
const snapshot = id => broadFixtureSnapshot(fixture(id));
const classification = id => parseBroadDecisionResponse(response(fixture(id).expected)).result;

test('independent observation questions preserve legacy request and keep all labels and identities out', () => {
  const s = snapshot('coexisting');
  s.expected = { never_send: 'private-label' };
  s.accountId = 'private-account'; s.studentId = 'private-student'; s.callId = 'private-call';
  s.researchTasks[0].jobId = 'private-job'; s.researchTasks[0].raw = 'private-payload';
  const request = buildBroadDecisionRequest(s);
  assert.deepEqual(Object.keys(request).sort(), ['input', 'model', 'prompt_cache_options', 'questions']);
  assert.deepEqual(request.questions[0], buildDecisionRequest(s).questions[0]);
  assert.ok(request.questions[1].instructions.endsWith(buildDecisionRequest(s).questions[1].instructions));
  assert.equal(request.questions[1].name, 'already_addressed');
  assert.deepEqual(request.questions.slice(2).map(q => q.name), [...BROAD_PREDICATES, ...BROAD_EVIDENCE_CHECKS]);
  assert.equal(request.questions.slice(2).every(q => q.type === 'predicate'), true);
  assert.equal(JSON.stringify(request).includes('private-'), false);
  assert.equal(broadPolicy.buildRequest, buildBroadDecisionRequest);
  const evidence = JSON.parse(request.input);
  assert.equal(evidence.researchTasks[0].findings[0].scenario, 'Apartment; rent only');
  assert.equal(evidence.researchTasks[0].findings[0].year, '2027');
  assert.equal(evidence.researchTasks[0].findings[0].limitation, 'Fictional test evidence only.');
  assert.equal(evidence.researchTasks[0].findings[0].sourceCount, 1);
});

test('strict answer identities, counts, types and distributions fail closed', () => {
  const valid = response();
  assert.equal(parseBroadDecisionResponse(valid).status, 'completed');
  for (const mutate of [
    r => { r.answers.pop(); }, r => { r.answers.push(r.answers[2]); },
    r => { r.answers[2].name = 'wrong_name'; }, r => { r.answers[3].name = r.answers[2].name; },
    r => { [r.answers[2], r.answers[3]] = [r.answers[3], r.answers[2]]; },
    r => { r.answers[3].probability = NaN; }, r => { r.answers[3].probability = -0.1; },
    r => { r.answers[3].probability = 1.1; }, r => { r.answers[3].probability = '0.9'; },
    r => { r.answers[3].type = 'choice'; }, r => { r.answers[0].confidence = Infinity; },
    r => { r.answers[0].probabilities[0].probability = 0.1; },
    r => { r.answers[0].probabilities[0].value = r.answers[0].probabilities[1].value; },
    r => { r.answers[0].choice = 'go_lookup'; }, r => { r.model = null; },
  ]) {
    const r = structuredClone(valid); mutate(r);
    assert.equal(parseBroadDecisionResponse(r).status, 'invalid');
    assert.equal(parseBroadDecisionResponse(r).result, null);
  }
  for (let index = 0; index < valid.answers.length; index++) {
    const r = structuredClone(valid);
    r.answers[index] = { name: r.answers[index].name, type: 'refusal' };
    assert.equal(parseBroadDecisionResponse(r).status, 'refused');
    assert.equal(parseBroadDecisionResponse(r).result, null);
  }
});

test('unavailable research stays unknown even when classifier reports a confident positive', () => {
  const result = classification('coexisting');
  for (const id of ['starting', 'pending-research', 'failed-research']) {
    const disposition = broadDisposition(snapshot(id), result);
    assert.equal(disposition.predicates.research_relevant_now.status, 'unavailable');
    assert.equal(disposition.predicates.comparison_mismatch.status, 'unavailable');
    assert.equal(disposition.actionAuthorized, false);
  }
  assert.equal(broadDisposition(snapshot('partial-research'), result).predicates.research_relevant_now.status, 'observed');
  const s = snapshot('comparison-compatible');
  for (const status of ['partial', 'unverified', 'unknown']) {
    s.researchTasks[0].findings.forEach(f => { f.status = status; });
    assert.equal(broadDisposition(s, result).predicates.research_relevant_now.status, 'unavailable');
  }
});

test('latest task revision and complete evidence eligibility prevent stale comparison candidates', () => {
  const s = snapshot('comparison-compatible'), result = classification('comparison-mismatch');
  const old = structuredClone(s.researchTasks[0]);
  s.researchTasks.push({ ...old, revision: 2, status: 'running', findings: [], evidenceAvailability: 'missing' });
  s.researchFindings.push({ ...old.findings[0], jobId: old.jobId, revision: 1 });
  assert.equal(JSON.parse(buildBroadDecisionRequest(s).input).researchTasks.length, 1);
  assert.equal(JSON.parse(buildBroadDecisionRequest(s).input).researchTasks[0].revision, 2);
  assert.equal(broadDisposition(s, result).predicates.research_relevant_now.status, 'unavailable');
  for (const availability of ['missing', 'oversized', 'invalid']) {
    const state = snapshot('comparison-compatible'); state.researchTasks[0].evidenceAvailability = availability;
    assert.equal(broadDisposition(state, result).predicates.research_relevant_now.status, 'unavailable');
  }
  const cancelled = snapshot('comparison-compatible'); cancelled.researchTasks[0].status = 'cancelled';
  assert.equal(broadDisposition(cancelled, result).predicates.research_relevant_now.status, 'unavailable');
});

test('duplicate historical/task evidence is not a second comparison fact; existing findings remain usable', () => {
  const s = snapshot('partial-research'), result = classification('coexisting');
  s.researchFindings.push({ ...s.researchTasks[0].findings[0], jobId: s.researchTasks[0].jobId, revision: 1 });
  assert.equal(broadDisposition(s, result).predicates.comparison_mismatch.status, 'unavailable');
  s.researchTasks = [];
  assert.equal(broadDisposition(s, result).predicates.research_relevant_now.status, 'observed');
  s.currentQuestion = null;
  assert.equal(broadDisposition(s, result).predicates.research_relevant_now.reason, 'question_unavailable');
});

test('equal generic facts for different subjects remain distinct comparison evidence', () => {
  const s = snapshot('comparison-compatible');
  const common = s.researchTasks[0].findings[0];
  s.researchTasks[0].findings = [
    { ...common, fact: 'The application fee is 50.', subject: 'Cedar', aspect: 'application fee' },
    { ...common, fact: 'The application fee is 50.', subject: 'Maple', aspect: 'application fee' },
  ];
  assert.equal(broadDisposition(s, classification('comparison-compatible')).predicates.comparison_mismatch.status, 'not_observed');
});

test('source-less claims and obsolete legacy findings are excluded before model classification', () => {
  const s = snapshot('comparison-compatible');
  s.researchFindings = [{ ...s.researchTasks[0].findings[0], jobId: s.researchTasks[0].jobId, revision: 0, fact: 'OBSOLETE_FACT' }];
  s.researchTasks[0].findings[0].sourceIds = [];
  s.researchTasks[0].findings[0].fact = 'SOURCELESS_CLAIM';
  const evidence = JSON.parse(buildBroadDecisionRequest(s).input);
  assert.equal(JSON.stringify(evidence).includes('OBSOLETE_FACT'), false);
  assert.equal(JSON.stringify(evidence).includes('SOURCELESS_CLAIM'), false);
  assert.equal(evidence.researchTasks[0].findings.length, 1);
  assert.equal(broadDisposition(s, classification('comparison-mismatch')).predicates.comparison_mismatch.status, 'unavailable');
  s.researchTasks[0].findings[1].sourceIds = [];
  assert.equal(broadDisposition(s, classification('comparison-mismatch')).predicates.research_relevant_now.status, 'unavailable');
});

test('multiple observations coexist without conferring permission, playback or action authority', () => {
  const result = classification('coexisting');
  const disposition = broadDisposition(snapshot('coexisting'), result);
  assert.equal(result.supportNeed, 'simpler_explanation');
  for (const name of ['changed_question', 'research_relevant_now', 'comparison_mismatch']) {
    assert.equal(disposition.predicates[name].status, 'observed');
  }
  assert.equal(disposition.mode, 'observe_only');
  assert.equal(disposition.actionAuthorized, false);
  assert.equal(disposition.support, 'uncalibrated');
  assert.equal(disposition.evidenceBasis, 'transcript_and_application_records_not_playback');
  const incomplete = broadDisposition(snapshot('incomplete'), result);
  assert.equal(Object.values(incomplete.predicates).every(p => p.status === 'provisional'), true);
  const closed = snapshot('coexisting'); closed.closed = true;
  assert.equal(Object.values(broadDisposition(closed, result).predicates).every(p => p.status === 'unavailable'), true);
});

test('comparison scope uses its separate observation with complete runtime-shaped qualifications', () => {
  const s = snapshot('embedded-comparison-scope');
  assert.equal(s.researchTasks[0].findings.every(f => f.year === null && f.scenario === null), true);
  const result = classification('embedded-comparison-scope');
  assert.equal(result.evidenceChecks.comparison_scope_sufficient.observed, true);
  assert.equal(broadDisposition(s, result).predicates.comparison_mismatch.status, 'not_observed');
  assert.equal(broadDisposition(snapshot('embedded-comparison-mismatch'), classification('embedded-comparison-mismatch')).predicates.comparison_mismatch.status, 'observed');
  const missing = snapshot('comparison-missing-scope'), low = classification('comparison-missing-scope');
  assert.equal(broadDisposition(missing, low).predicates.comparison_mismatch.reason, 'comparison_scope_unavailable');
  const missingHelper = { ...result, evidenceChecks: {} };
  assert.equal(broadDisposition(s, missingHelper).predicates.comparison_mismatch.status, 'unavailable');
  // Helper is still a model observation, not a truth or permission check.
  assert.equal(broadDisposition(s, result).actionAuthorized, false);
  assert.equal(Object.hasOwn(result.predicates, 'comparison_scope_sufficient'), false);
});

test('request guard rejects unauthorized/nonisolated/closed/oversized evidence without provider calls', () => {
  for (const patch of [{ fictional: false, isolatedLocal: false }, { authorized: false }, { closed: true }]) {
    assert.throws(() => buildBroadDecisionRequest({ ...snapshot('starting'), ...patch }), /ineligible_snapshot/);
  }
  const large = snapshot('partial-research'); large.researchTasks[0].findings[0].fact = 'x'.repeat(33000);
  assert.throws(() => buildBroadDecisionRequest(large), /request_too_large/);
});

test('bilingual fixture matrix covers topics, positive and negative predicates, and missing evidence separately', () => {
  const pairs = new Map();
  for (const f of broadFixtures) {
    const group = pairs.get(f.pairId) ?? []; group.push(f); pairs.set(f.pairId, group);
    const s = broadFixtureSnapshot(f), request = buildBroadDecisionRequest(s);
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 32768);
    assert.equal(Object.hasOwn(JSON.parse(request.input), 'expected'), false);
    const observation = broadDisposition(s, parseBroadDecisionResponse(response(f.expected)).result);
    for (const name of f.expectedUnavailable) {
      assert.equal(observation.predicates[name].status, f.expectedProvisional ? 'provisional' : 'unavailable', `${f.id}/${name}`);
    }
  }
  for (const group of pairs.values()) {
    assert.deepEqual(group.map(f => f.language).sort(), ['en', 'es']);
    assert.deepEqual(group[0].expected, group[1].expected);
  }
  for (const name of BROAD_PREDICATES) {
    assert.ok(broadFixtures.some(f => f.expected.predicates[name]), `${name} positive`);
    assert.ok(broadFixtures.some(f => !f.expected.predicates[name]), `${name} negative`);
  }
  for (const topic of ['orientation', 'applications', 'family-language', 'financial-aid', 'housing', 'graduate-study']) {
    assert.ok(broadFixtures.some(f => f.topic === topic), topic);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEarlyRequest, parseEarlyResponse, earlyResultActionable, earlyResultDecision,
  EARLY_PREDICATES, EARLY_QUESTION_COUNT } from './early-rubric.mjs';
import { earlyFixtures, earlyPartialFixtures, earlyIndependentFixtures, earlyResponseFixture, earlyResultFixture } from './early-fixtures.mjs';
import { createExplanationHistory } from './explanation-history.mjs';

const assistantSnapshot = { assistantSinceNeed: { text: 'For example, Algebra 1 comes before Algebra 2.',
  sourceEventIds: ['output-after-need'], revision: 1, playbackClaim: false } };
const anchor = { activeSupport: { kind: 'concrete_example', status: 'provisional', sourceText: 'Could you give an example of a prerequisite?' } };
const decide = (options, snapshot) => earlyResultDecision(earlyResultFixture(options, snapshot));

test('bilingual evidence requests use nine direct predicates without application identifiers or labels', () => {
  assert.equal(earlyFixtures.length, 16); assert.equal(EARLY_QUESTION_COUNT, 9);
  for (const fixture of [...earlyFixtures, ...earlyPartialFixtures, ...earlyIndependentFixtures]) {
    const request = buildEarlyRequest({ ...fixture.snapshot, callId: 'private-call', accountId: 'private-account', expected: fixture.expected });
    assert.deepEqual(request.questions.map(question => question.name), EARLY_PREDICATES);
    assert.ok(request.questions.every(question => question.type === 'predicate' && !Object.hasOwn(question, 'choices')));
    assert.ok(Buffer.byteLength(JSON.stringify(request)) < 12000);
    assert.ok(!request.input.includes('private-call')); assert.ok(!request.input.includes('expected'));
    assert.equal(JSON.parse(request.input).currentCallerWords, fixture.snapshot.text);
  }
});

test('application-owned priority selects explicit support before an anchored followup', () => {
  for (const [need, kind] of [['simplify', 'simpler_explanation'], ['example', 'concrete_example'], ['starting_point', 'starting_point']]) {
    const decision = decide({ need });
    assert.equal(decision.action, need); assert.equal(decision.supportKind, kind);
    assert.equal(decision.eligible, true); assert.equal(decision.clearSupport, false);
  }
  assert.equal(decide({ need: 'related_followup' }).reason, 'no_support_anchor');
  const followup = decide({ need: 'related_followup' }, anchor);
  assert.equal(followup.action, 'continue_simplifying'); assert.equal(followup.supportKind, 'concrete_example');
  assert.equal(followup.eligible, true);
  assert.equal(decide({ facts: { example_requested: .99, starting_point_requested: .99, related_followup: .99 } }, anchor).action, 'example');
  assert.equal(decide({ facts: { starting_point_requested: .99 } }).action, 'starting_point');
});

test('predicate truth thresholds do not invent choice confidence or require all negatives near zero', () => {
  assert.equal(decide({ needProbability: .89 }).reason, 'uncertain_need');
  assert.equal(decide({ needProbability: .9 }).eligible, true);
  const parsed = parseEarlyResponse(earlyResponseFixture());
  assert.equal(Object.hasOwn(parsed.result.need, 'confidence'), false);
  assert.equal(Object.hasOwn(parsed.result.need, 'selectedProbability'), false);
  assert.equal(decide({ facts: { correction_pending: .49, need_resolved_or_left: .49,
    need_revised: .49, need_subject_incomplete: .49 } }).eligible, true);
  assert.equal(decide({ facts: { correction_pending: .5 } }).reason, 'correction_pending');
  assert.equal(decide({ facts: { need_revised: .5 } }, anchor).reason, 'uncertain_change');
  assert.equal(decide({ facts: { need_resolved_or_left: .5 } }).reason, 'uncertain_change');
  assert.equal(decide({ need: 'none', facts: { need_revised: .49, correction_pending: null } }).reason, 'no_support_needed');
});

test('uncertainty about replacing a nonexistent anchor does not veto an explicit current need', () => {
  assert.equal(decide({ need: 'simplify', facts: { need_revised: .77 } }).eligible, true);
  assert.equal(decide({ need: 'simplify', facts: { need_revised: .77 } }, anchor).reason, 'uncertain_change');
  assert.equal(decide({ need: 'simplify', facts: { correction_pending: .77 } }).eligible, false);
  assert.equal(decide({ need: 'simplify', facts: { need_resolved_or_left: .77 } }).eligible, false);
});

test('strong caller resolution clears independently of refused support or addressed observations', () => {
  for (const change of ['resolved', 'retracted', 'topic_changed']) {
    const parsed = parseEarlyResponse(earlyResponseFixture({ change, facts: { simplify_requested: null, already_addressed: null } }), assistantSnapshot);
    assert.equal(parsed.status, 'completed'); assert.equal(parsed.decision.action, 'clear');
    assert.equal(parsed.decision.clearSupport, true); assert.equal(earlyResultActionable(parsed.result), false);
  }
  assert.equal(decide({ need: 'none' }).reason, 'no_support_needed');
  assert.equal(decide({ need: 'none' }).clearSupport, false);
  assert.equal(decide({ need: 'incomplete' }).action, 'unclear');
});

test('a complete replacement establishes its current explicit need; pending or unidentified correction withholds', () => {
  const replaced = decide({ need: 'example', change: 'revised_need' }, anchor);
  assert.equal(replaced.action, 'example'); assert.equal(replaced.eligible, true);
  assert.equal(replaced.replaceNeed, true); assert.equal(replaced.clearSupport, false);
  assert.equal(decide({ need: 'example', change: 'revised_need', facts: { need_resolved_or_left: .99 } }, anchor).eligible, true);
  assert.equal(decide({ change: 'correction_pending' }, anchor).reason, 'correction_pending');
  assert.equal(decide({ change: 'correction_pending' }, anchor).eligible, false);
  for (const need of ['related_followup', 'none']) {
    const decision = decide({ need, change: 'revised_need' }, anchor);
    assert.equal(decision.reason, 'revised_need_unidentified'); assert.equal(decision.eligible, false);
    assert.equal(decision.replaceNeed, false);
  }
});

test('observed addressed output suppresses independently of uncertain need/change and never authorizes support', () => {
  const addressed = decide({ addressed: .95, needProbability: .4, facts: { need_revised: .5 } }, assistantSnapshot);
  assert.equal(addressed.reason, 'already_addressed'); assert.equal(addressed.eligible, false);
  assert.equal(addressed.clearSupport, true); assert.equal(addressed.action, 'none');
  assert.equal(decide({ addressed: .5 }, assistantSnapshot).reason, 'possibly_addressed');
  assert.equal(decide({ addressed: .05 }, assistantSnapshot).eligible, true);
  assert.equal(decide({ addressed: 0, needProbability: .5 }, assistantSnapshot).eligible, false);
  assert.equal(decide({ addressed: 1 }).eligible, true, 'no supplied output means no evidence of addressing');
  assert.equal(decide({ addressed: 1 }, { assistantSinceNeed: { text: 'answer', sourceEventIds: [] } }).clearSupport, false);
  assert.equal(decide({ facts: { already_addressed: null } }).eligible, true);
  assert.equal(decide({ facts: { already_addressed: null } }, assistantSnapshot).reason, 'addressed_refused');
});

test('refusals are local to relevant facts and cannot turn unknown contradictions into permission', () => {
  assert.equal(decide({ facts: { simplify_requested: null } }).reason, 'need_refused');
  assert.equal(decide({ need: 'example', facts: { simplify_requested: null, starting_point_requested: null, related_followup: null } }).eligible, true);
  for (const name of ['correction_pending', 'need_subject_incomplete', 'need_resolved_or_left']) {
    const decision = decide({ facts: { [name]: null } });
    assert.equal(decision.reason, 'change_refused'); assert.equal(decision.eligible, false);
  }
  assert.equal(decide({ facts: { need_revised: null } }, anchor).reason, 'change_refused');
  assert.equal(decide({ facts: { need_revised: null } }).eligible, true);
});

test('malformed, reordered, missing and old choice answers never authorize support', () => {
  for (const mutate of [r => r.answers.reverse(), r => r.answers.pop(), r => r.answers[0].probability = 2,
    r => r.answers[0].probability = NaN, r => r.answers[2].type = 'choice', r => r.answers[1].name = r.answers[0].name]) {
    const response = earlyResponseFixture(); mutate(response); assert.equal(parseEarlyResponse(response).status, 'invalid');
  }
  assert.equal(parseEarlyResponse({ answers: [{ name: 'support_action' }, { name: 'meaning_ready' }] }).status, 'invalid');
  for (const rubricVersion of ['early-conversation-4', 'early-conversation-5', 'early-conversation-6', 'early-conversation-7'])
    assert.equal(earlyResultDecision({ ...earlyResultFixture(), rubricVersion }).reason, 'invalid_result');
  assert.equal(earlyResultDecision({ ...earlyResultFixture(), facts: {} }).reason, 'invalid_result');
});

test('earlier explanation history is supplied as raw evidence without treating it as post-need output', () => {
  for (const [language, explanation, current] of [
    ['en', 'A grant usually does not have to be repaid.', 'I still do not understand that.'],
    ['es', 'Una beca generalmente no se devuelve.', 'Todavía no entiendo eso.'],
  ]) {
    const history = createExplanationHistory();
    history.append({ id: 'prior-answer', role: 'assistant', text: explanation, complete: true,
      source: 'application_estimate', sourceEventIds: ['native-prior-answer'], startMs: 1, endMs: 10 });
    const snapshot = { ...earlyFixtures[0].snapshot, language, text: current,
      explanationHistory: history.snapshot({ currentText: current }) };
    const input = JSON.parse(buildEarlyRequest(snapshot).input);
    assert.equal(input.explanationHistory.rows[0].text, explanation);
    assert.equal(input.explanationHistory.comprehension, 'unknown');
    assert.equal(input.assistantSinceNeed, null); assert.equal(input.assistantEvidenceStatus, 'none_observed');
    assert.equal(decide({ need: 'simplify', addressed: 1 }, snapshot).eligible, true);
    assert.equal(decide({ need: 'none' }, snapshot).clearSupport, false);
  }
});

test('recent evidence retains decisive endings and explicitly omits oversized rows', () => {
  const long = 'Context '.repeat(200) + 'Actually I already did that; I need help with the application.';
  const input = JSON.parse(buildEarlyRequest({ ...earlyFixtures[0].snapshot,
    recentDialogue: [{ role: 'user', text: long, complete: true },
      { role: 'assistant', text: 'x'.repeat(9000), complete: true }] }).input);
  assert.equal(input.precedingConversation[0].text, long);
  assert.equal(input.precedingConversationOmittedRows, 1);
  assert.equal(input.precedingConversation[0].boundary, 'application_estimate');
});

test('provisional evidence and previous output remain bounded and distinct', () => {
  assert.throws(() => buildEarlyRequest({ ...earlyFixtures[0].snapshot, complete: true }), /invalid_early_evidence/);
  assert.throws(() => buildEarlyRequest({ ...earlyFixtures[0].snapshot, text: 'x'.repeat(4097) }), /invalid_early_evidence/);
  const input = JSON.parse(buildEarlyRequest({ ...earlyFixtures[0].snapshot, ...anchor, ...assistantSnapshot,
    recentDialogue: [{ role: 'assistant', text: 'Earlier output is not post-need evidence.', complete: true }] }).input);
  assert.equal(input.earlierTemporarySupport.status, 'provisional');
  assert.match(input.assistantSinceNeed.evidence, /not proof of playback/);
  assert.ok(!Object.hasOwn(input.assistantSinceNeed, 'playbackClaim'));
  assert.notEqual(input.precedingConversation[0].text, input.assistantSinceNeed.text);
});

test('decisive endings are preserved; missing or oversized output cannot claim complete addressed evidence', () => {
  const sourceText = 'Background '.repeat(150) + 'Actually, I understand it now.';
  const outputText = 'Background '.repeat(300) + 'That answer concerns a different prerequisite.';
  const snapshot = { ...earlyFixtures[0].snapshot, activeSupport: { ...anchor.activeSupport, sourceText },
    assistantSinceNeed: { ...assistantSnapshot.assistantSinceNeed, text: outputText } };
  const input = JSON.parse(buildEarlyRequest(snapshot).input);
  assert.equal(input.earlierTemporarySupport.callerWords, sourceText); assert.equal(input.assistantSinceNeed.text, outputText);
  assert.throws(() => buildEarlyRequest({ ...snapshot, activeSupport: { ...snapshot.activeSupport,
    sourceText: 'x'.repeat(4096) + ' Actually, I understand it now.' } }), /invalid_early_evidence/);
  for (const assistantSinceNeed of [{ ...snapshot.assistantSinceNeed, evidenceComplete: false },
    { ...snapshot.assistantSinceNeed, text: 'x'.repeat(8193) }, { ...snapshot.assistantSinceNeed, sourceEventIds: [] }]) {
    const evidence = { ...snapshot, assistantSinceNeed };
    const requestInput = JSON.parse(buildEarlyRequest(evidence).input);
    assert.equal(requestInput.assistantSinceNeed, null); assert.equal(requestInput.assistantEvidenceStatus, 'unknown_or_incomplete');
    assert.equal(decide({ addressed: 0 }, evidence).reason, 'addressed_evidence_unknown');
    assert.equal(decide({ addressed: 1 }, evidence).clearSupport, false);
    assert.equal(decide({ change: 'resolved' }, evidence).clearSupport, true);
  }
});

test('combined history and current evidence fit the transport cap without slicing qualifying endings', () => {
  const memory = createExplanationHistory();
  for (let index = 0; index < 6; index++) memory.append({ id: `prior${index}`, role: index % 2 ? 'assistant' : 'user',
    text: 'college '.repeat(300) + ' Earlier qualification.', complete: true, source: 'application_estimate',
    sourceEventIds: [`native${index}`], startMs: index * 10, endMs: index * 10 + 5 });
  const current = 'application '.repeat(300) + ' I need one starting point.';
  const output = 'discussion '.repeat(650) + ' But this is not an answer to the latest question.';
  const request = buildEarlyRequest({ ...earlyFixtures[0].snapshot, text: current,
    explanationHistory: memory.snapshot({ currentText: 'college' }),
    recentDialogue: [{ role: 'assistant', text: 'Earlier '.repeat(900), complete: true }],
    activeSupport: { ...anchor.activeSupport, sourceText: current },
    assistantSinceNeed: { ...assistantSnapshot.assistantSinceNeed, text: output } });
  assert.ok(Buffer.byteLength(JSON.stringify({ ...request, prompt_cache_options: { mode: 'explicit', ttl: '30m' } })) <= 32768);
  const input = JSON.parse(request.input);
  assert.equal(input.currentCallerWords, current); assert.equal(input.assistantSinceNeed.text, output);
  assert.ok(input.explanationHistory.selectionTruncated);
  assert.ok(input.explanationHistory.omittedRows > 0);
});

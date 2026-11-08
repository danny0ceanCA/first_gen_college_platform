import test from 'node:test';
import assert from 'node:assert/strict';
import { measureSupportOutcome, summarizeSupportOutcomes } from './outcome-evaluation.mjs';
import { outcomeFixtures, makeOutcomeFixture } from './outcome-fixtures.mjs';

for (const fixture of outcomeFixtures) test(fixture.id, () => {
  const result = measureSupportOutcome(fixture.input);
  assert.equal(result.valid, true);
  for (const [dimension, expected] of Object.entries(fixture.expected)) assert.equal(result[dimension].status, expected);
  assert.equal(result.comprehensionVerified, false); assert.equal(result.inference, 'association_only_not_causal');
  assert.equal(result.rejected.length, 0);
});

test('authored fixture labels are excluded unless explicitly enabled and never claimed as human review', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  const report = measureSupportOutcome({ ...input, allowFixtureLabels: false });
  assert.equal(report.receipt.status, 'acknowledged'); assert.equal(report.adaptation.status, 'unknown');
  assert.equal(report.callerClarity.status, 'unknown'); assert.equal(report.playback.status, 'unknown');
  assert.equal(report.synthetic, false);
  assert.equal(measureSupportOutcome(input).synthetic, true);
});

test('a model-generated semantic label is not an independent human-reviewed outcome', () => {
  const input = makeOutcomeFixture('es', 'played_and_reported_clear').input;
  input.evaluations = input.evaluations.map(row => ({ ...row, method: 'model', reviewed: true }));
  const result = measureSupportOutcome(input);
  assert.equal(result.adaptation.status, 'unknown'); assert.equal(result.callerClarity.status, 'unknown');
});

for (const language of ['en', 'es']) test(`${language}: a bare yes cannot become reported clarity through a success label`, () => {
  const input = makeOutcomeFixture(language, 'caller_acknowledgment').input;
  input.turns[2].text = language === 'es' ? 'Sí.' : 'Okay.';
  Object.assign(input.evaluations[1], { label: 'reported_clear', basis: 'explicit_self_report', quote: input.turns[2].text });
  const result = measureSupportOutcome(input);
  assert.equal(result.adaptation.status, 'observed'); assert.equal(result.playback.status, 'confirmed');
  assert.equal(result.callerClarity.status, 'unknown');
});

for (const field of ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch']) {
  test(`${field}: other-scope acknowledgment, semantic review and playback cannot count`, () => {
    const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
    const changed = { ...input.cue.scope, [field]: typeof input.cue.scope[field] === 'number' ? 1 : 'other' };
    input.contextAcknowledgments = input.contextAcknowledgments.map(row => ({ ...row, scope: changed }));
    input.evaluations = input.evaluations.map(row => ({ ...row, scope: changed }));
    input.playback = input.playback.map(row => ({ ...row, scope: changed }));
    const result = measureSupportOutcome(input);
    assert.equal(result.receipt.status, 'unconfirmed'); assert.equal(result.adaptation.status, 'unknown');
    assert.equal(result.playback.status, 'unknown'); assert.equal(result.callerClarity.status, 'unknown');
  });
}

test('wrong native event IDs and a cue ID belonging to another intervention do not prove adaptation', () => {
  for (const mutation of [row => { row.sourceEventIds = ['different-event']; }, row => { row.cueId = 'other-cue'; },
    row => { row.quote = 'words that were never in this transcript'; }]) {
    const input = makeOutcomeFixture('en', 'transcript_only').input;
    mutation(input.evaluations[0]);
    assert.equal(measureSupportOutcome(input).adaptation.status, 'unknown');
  }
});

test('ack correlation uses exact client event ID and timeline, not nearby timestamps or operation names', () => {
  for (const mutation of [row => { row.client_event_id = 'unrelated-append'; }, row => { row.start_ms = 500; },
    row => { row.type = 'session.instructions.appended'; }]) {
    const input = makeOutcomeFixture('en', 'ack_only').input; mutation(input.contextAcknowledgments[0]);
    assert.equal(measureSupportOutcome(input).receipt.status, 'unconfirmed');
  }
});

test('shadow output can be reviewed but never establishes receipt of an unsent cue', () => {
  const input = makeOutcomeFixture('en', 'transcript_only').input;
  input.cue.sent = false; delete input.cue.eventId;
  const result = measureSupportOutcome(input);
  assert.equal(result.receipt.status, 'not_sent'); assert.equal(result.adaptation.status, 'observed');
});

test('an interrupted or incomplete client playback is distinct from completion', () => {
  const input = makeOutcomeFixture('es', 'played_and_reported_clear').input;
  input.playback[0].status = 'interrupted'; input.playback[0].coverage = 'partial';
  const result = measureSupportOutcome(input);
  assert.equal(result.playback.status, 'partial'); assert.equal(result.callerClarity.status, 'reported_clear');
  assert.equal(result.comprehensionVerified, false);
});

test('muted, dropped or provider-generated audio is not confirmed client playback', () => {
  for (const mutation of [row => { row.muted = true; }, row => { row.dropped = true; },
    row => { row.kind = 'session.output_audio.delta'; }]) {
    const input = makeOutcomeFixture('en', 'played_and_reported_clear').input; mutation(input.playback[0]);
    assert.equal(measureSupportOutcome(input).playback.status, 'unknown');
  }
});

test('completed playback cannot predate its output, end early, or compress its observed duration', () => {
  for (const [startMs, endMs] of [[1000, 1001], [1000, 5100], [1500, 4900], [5000, 5001]]) {
    const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
    Object.assign(input.playback[0], { startMs, endMs });
    const result = measureSupportOutcome(input);
    assert.equal(result.adaptation.status, 'observed');
    assert.equal(result.playback.status, 'unknown');
    assert.ok(result.rejected.some(row => row.kind === 'playback' && row.reason === 'timing_inconsistent_with_output'));
  }
});

test('completed coverage uses unique output intervals, allowing normal buffering but not undercoverage', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  const first = input.turns[1];
  first.sourceEventIds.push('second-fragment-same-row');
  input.evaluations[0].sourceEventIds = [...first.sourceEventIds];
  const next = { ...first, id: 'second-output', sourceEventIds: ['second-output-native'], startMs: 5000, endMs: 5200 };
  input.turns.push(next);
  input.evaluations.push({ ...input.evaluations[0], id: 'second-output-review', rowId: next.id, sourceEventIds: next.sourceEventIds });
  input.playback[0].outputSourceEventIds = [...first.sourceEventIds, ...next.sourceEventIds];
  Object.assign(input.playback[0], { startMs: 1600, endMs: 5300 });
  assert.equal(measureSupportOutcome(input).playback.status, 'unknown', '3,700 ms cannot cover 3,800 ms of distinct output');
  input.playback[0].endMs = 5400;
  assert.equal(measureSupportOutcome(input).playback.status, 'confirmed', 'buffered normal-rate playback covers both rows without counting one row twice');
});

test('a support cue arriving after an answer began does not claim adaptation of that ongoing answer', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  input.cue.timelineMs = 1600; input.contextAcknowledgments = [];
  const result = measureSupportOutcome(input);
  assert.equal(result.adaptation.status, 'unknown'); assert.equal(result.playback.status, 'unknown');
  assert.equal(result.callerClarity.status, 'reported_clear');
});

test('three following user groups bound the window; fourth-turn outcomes are unavailable', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  const first = input.turns[2];
  for (let n = 2; n <= 4; n++) input.turns.push({ ...first, id: 'follow-' + n,
    sourceEventIds: ['native-follow-' + n], startMs: 7000 + n * 2000, endMs: 8000 + n * 2000 });
  input.evaluations[1] = { ...input.evaluations[1], rowId: 'follow-4', sourceEventIds: ['native-follow-4'] };
  const result = measureSupportOutcome(input);
  assert.equal(result.window.followingUserIds.length, 3); assert.ok(!result.window.rowIds.includes('follow-4'));
  assert.equal(result.callerClarity.status, 'unknown');
});

test('an output group or playback crossing the fourth-user boundary cannot count as complete in the window', () => {
  for (const target of ['turn', 'playback']) {
    const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
    const first = input.turns[2];
    for (let n = 2; n <= 4; n++) input.turns.push({ ...first, id: 'follow-' + n,
      sourceEventIds: ['native-follow-' + n], startMs: 7000 + n * 2000, endMs: 8000 + n * 2000 });
    const fourthStart = input.turns.at(-1).startMs;
    if (target === 'turn') input.turns[1].endMs = fourthStart + 1;
    else input.playback[0].endMs = fourthStart + 1;
    const result = measureSupportOutcome(input);
    assert.equal(result.playback.status, 'unknown');
    assert.equal(result.adaptation.status, target === 'turn' ? 'unknown' : 'observed');
  }
});

test('exact duplicate rows do not consume the user window; contradictory grouping fails closed', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  input.turns.push(structuredClone(input.turns[2]));
  assert.equal(measureSupportOutcome(input).window.followingUserIds.length, 1);
  input.turns.at(-1).text = 'Different data under the same row ID.';
  const result = measureSupportOutcome(input);
  assert.equal(result.valid, false); assert.equal(result.adaptation.status, 'unknown');
});

test('native fragment IDs cannot be counted twice under different application group IDs', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  input.turns.push({ ...input.turns[2], id: 'duplicate-fragment-group' });
  assert.equal(measureSupportOutcome(input).valid, false);
});

test('temporary-history wrapper requires an explicit scope and preserves raw source provenance', () => {
  const input = makeOutcomeFixture('en', 'transcript_only').input;
  const rows = input.turns.map(({ scope, ...row }) => row);
  input.turns = { scope: input.cue.scope, rows, evidenceType: 'bounded_raw_transcript' };
  assert.equal(measureSupportOutcome(input).adaptation.status, 'observed');
  delete input.turns.scope;
  assert.equal(measureSupportOutcome(input).valid, false);
});

test('a caller can report clarity and then renewed confusion; both remain visible', () => {
  const input = makeOutcomeFixture('en', 'played_and_reported_clear').input;
  const row = { ...input.turns[2], id: 'renewed', sourceEventIds: ['renewed-event'], startMs: 8000, endMs: 10000,
    text: 'I still do not understand whether I need an appointment.' };
  input.turns.push(row);
  input.evaluations.push({ ...input.evaluations[1], id: 'renewed-evaluation', rowId: row.id,
    sourceEventIds: row.sourceEventIds, quote: row.text, label: 'reported_unclear' });
  assert.equal(measureSupportOutcome(input).callerClarity.status, 'mixed');
});

test('language counts retain unknown denominators instead of publishing a naturalness percentage', () => {
  const results = outcomeFixtures.map(row => measureSupportOutcome(row.input));
  results.push(measureSupportOutcome());
  const summary = summarizeSupportOutcomes(results);
  assert.equal(summary.samples, 12); assert.equal(summary.invalidSamples, 1);
  for (const language of ['en', 'es']) {
    assert.equal(summary.byLanguage[language].samples, 6);
    assert.equal(summary.byLanguage[language].acknowledged, 6);
    assert.equal(summary.byLanguage[language].callerReportedClear, 1);
    assert.equal(summary.byLanguage[language].callerReportedUnclear, 1);
    assert.equal(summary.byLanguage[language].callerClarityUnknown, 4);
  }
  assert.equal(summary.inference, 'association_only_not_causal');
  assert.ok(!JSON.stringify(summary).includes('naturalness'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { earlyHoldoutFixtures } from './early-holdout-fixtures.mjs';
import { earlyFixtures, earlyPartialFixtures } from './early-fixtures.mjs';

// This is a data-integrity suite. It makes no inference calls and does not
// substitute a fake classifier for the independent semantic evaluation.
const frozenFixtureSourceSha256 = '80b57098dc93f45fc3921cea044bca2727de346d5a6aa9167dac01bc378129a5';
const pairKinds = [
  'background', 'pending-correction', 'corrected-subject', 'resolved',
  'quoted', 'conditional', 'example', 'starting-point', 'already-addressed',
  'acknowledgment', 'renewed-confusion', 'elaborative-actually',
];
const actions = new Set(['simplify', 'example', 'starting_point', 'continue_simplifying', 'clear', 'none', 'unclear']);
const supportKinds = new Set(['simpler_explanation', 'concrete_example', 'starting_point']);
const normalized = text => text.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
const immutable = value => {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) immutable(child);
};

test('holdout source remains frozen after its first independent publication', () => {
  const source = readFileSync(new URL('./early-holdout-fixtures.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), frozenFixtureSourceSha256);
  immutable(earlyHoldoutFixtures);
});

test('holdout has twelve equivalent bilingual pairs and four mixed-language cases', () => {
  assert.equal(earlyHoldoutFixtures.length, 28);
  assert.equal(new Set(earlyHoldoutFixtures.map(item => item.id)).size, 28);
  for (const kind of pairKinds) {
    const pair = ['en', 'es'].map(language => earlyHoldoutFixtures.find(item => item.id === 'holdout-' + language + '-' + kind));
    assert.ok(pair.every(Boolean), kind);
    assert.deepEqual(pair[0].expected, pair[1].expected, kind);
    assert.notEqual(pair[0].snapshot.text, pair[1].snapshot.text, kind);
  }
  assert.equal(earlyHoldoutFixtures.filter(item => item.id.startsWith('holdout-mixed-')).length, 4);
  assert.equal(earlyHoldoutFixtures.filter(item => item.snapshot.language === 'en').length, 14);
  assert.equal(earlyHoldoutFixtures.filter(item => item.snapshot.language === 'es').length, 14);
  assert.deepEqual(new Set(earlyHoldoutFixtures.map(item => item.expected.action)), actions);
  assert.deepEqual(new Set(earlyHoldoutFixtures.flatMap(item => item.expected.supportKind ? [item.expected.supportKind] : [])), supportKinds);
});

test('holdout snapshots stay bounded and separate from development wording', () => {
  const development = new Set([...earlyFixtures, ...earlyPartialFixtures].map(item => normalized(item.snapshot.text)));
  const evidence = new Set();
  for (const { id, snapshot, expected } of earlyHoldoutFixtures) {
    assert.equal(snapshot.provisional, true, id);
    assert.equal(snapshot.complete, false, id);
    assert.ok(snapshot.text.trim().length > 0 && Buffer.byteLength(snapshot.text) <= 4096, id);
    assert.equal(development.has(normalized(snapshot.text)), false, id);
    assert.ok(['en', 'es'].includes(snapshot.language), id);
    assert.ok(snapshot.recentDialogue.length <= 6, id);
    for (const turn of snapshot.recentDialogue) {
      assert.ok(['user', 'assistant'].includes(turn.role), id);
      assert.equal(typeof turn.complete, 'boolean', id);
      assert.ok(turn.text.trim().length > 0 && turn.text.length <= 1200, id);
    }
    assert.ok(actions.has(expected.action), id);
    assert.equal(typeof expected.eligible, 'boolean', id);
    assert.equal(typeof expected.clearSupport, 'boolean', id);
    assert.equal(expected.eligible && expected.clearSupport, false, id);
    if (expected.supportKind) assert.ok(supportKinds.has(expected.supportKind), id);
    const signature = JSON.stringify({ text: snapshot.text, history: snapshot.recentDialogue,
      support: snapshot.activeSupport?.sourceText, assistant: snapshot.assistantSinceNeed.text });
    assert.equal(evidence.has(signature), false, id);
    evidence.add(signature);
  }
});

test('retained and assistant evidence preserve distinct immutable provenance', () => {
  let retained = 0, priorAssistant = 0;
  for (const { id, snapshot } of earlyHoldoutFixtures) {
    const { stamp, sourceEventIds, sourceTextEnds, assistantSinceNeed, activeSupport } = snapshot;
    assert.equal(stamp.revision, sourceEventIds.length, id);
    assert.equal(sourceTextEnds.length, sourceEventIds.length, id);
    assert.equal(sourceTextEnds.at(-1), snapshot.text.length, id);
    assert.equal(new Set(sourceEventIds).size, sourceEventIds.length, id);
    assert.equal(assistantSinceNeed.playbackClaim, false, id);
    assert.equal(assistantSinceNeed.evidenceComplete, true, id);
    assert.equal(assistantSinceNeed.revision, snapshot.assistantOutputRevision, id);
    assert.equal(Boolean(assistantSinceNeed.text), assistantSinceNeed.sourceEventIds.length > 0, id);
    assert.ok(assistantSinceNeed.sourceEventIds.every(sourceId => !sourceEventIds.includes(sourceId)), id);
    if (assistantSinceNeed.text) priorAssistant++;
    if (!activeSupport) continue;
    assert.ok(supportKinds.has(activeSupport.kind), id);
    assert.ok(['validated', 'provisional'].includes(activeSupport.status), id);
    assert.ok(activeSupport.sourceText.trim() && activeSupport.sourceText.length <= 1200, id);
    assert.equal(activeSupport.supportRevision, snapshot.supportRevision, id);
    assert.equal(activeSupport.stamp.revision, activeSupport.sourceEventIds.length, id);
    assert.ok(activeSupport.originOutputRevision <= assistantSinceNeed.revision, id);
    for (const field of ['callId', 'studentId', 'language', 'connectionEpoch', 'scopeEpoch'])
      assert.equal(activeSupport.stamp[field], stamp[field], id);
    if (activeSupport.stamp.contributionId === stamp.contributionId) {
      retained++;
      assert.ok(stamp.revision > activeSupport.stamp.revision, id);
      assert.ok(snapshot.text.startsWith(activeSupport.sourceText), id);
      assert.deepEqual(sourceEventIds.slice(0, activeSupport.sourceEventIds.length), activeSupport.sourceEventIds, id);
      assert.equal(sourceTextEnds[activeSupport.stamp.revision - 1], activeSupport.sourceText.length, id);
    }
  }
  assert.ok(retained > 0);
  assert.ok(priorAssistant >= 6);
});

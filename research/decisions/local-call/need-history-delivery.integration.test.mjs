import test from 'node:test';
import assert from 'node:assert/strict';
import { needHistoryFixtures } from './need-history-fixtures.mjs';
import { earlyResultFixture } from './early-fixtures.mjs';
import { earlyResultDecision } from './early-rubric.mjs';
import { createEarlySupportDelivery } from './early-support-delivery.mjs';

// Predicate scores observed in the first fictional classifier run, preserved
// here as an offline replay. These are not freshly generated provider results.
// Exact action/clearSupport labels alone do not describe runtime withdrawal.
const observed = {
  en: { simplify_requested: 0, example_requested: 0, starting_point_requested: .01,
    related_followup: 0, correction_pending: 0, need_resolved_or_left: 0,
    need_revised: .98, need_subject_incomplete: .13, already_addressed: .03 },
  es: { simplify_requested: 0, example_requested: 0, starting_point_requested: 0,
    related_followup: 0, correction_pending: 0, need_resolved_or_left: 0,
    need_revised: .99, need_subject_incomplete: .01, already_addressed: .03 },
};

for (const language of ['en', 'es']) test(`${language}: observed topic-abandonment classification withdraws the old need without a cue`, () => {
  const authored = needHistoryFixtures.find(row => row.id === `history-${language}-leave-need-change-topic`);
  const current = structuredClone(authored.snapshot), prior = current.activeSupport;
  let now = 10000, blocked = 'pending_context';
  let snapshot = { ...current, usable: true, stamp: prior.stamp, text: prior.sourceText,
    sourceEventIds: prior.sourceEventIds, sourceTextEnds: [prior.sourceText.length],
    supportRevision: 0, activeSupport: null, lastObservedAtMs: now, startMs: 0, endMs: 1500,
    assistantOutputStartedForContribution: false };
  const sent = [], logs = [];
  const delivery = createEarlySupportDelivery({ enabled: true, getEvidence: () => snapshot, now: () => now,
    canDeliver: () => blocked, send: (...args) => sent.push(args), log: row => logs.push(row) });
  const record = result => ({ stamp: snapshot.stamp, record: { status: 'completed',
    callId: snapshot.stamp.callId, studentId: snapshot.stamp.studentId,
    sourceEventIds: snapshot.sourceEventIds, sourceText: snapshot.text,
    supportRevision: delivery.revision(), assistantOutputRevision: snapshot.assistantOutputRevision,
    operationId: 'replay-' + snapshot.stamp.contributionId, requestId: 'fictional-replay', result } });

  delivery.consider(record(earlyResultFixture({ need: 'starting_point' }, snapshot)));
  assert.equal(delivery.activeSupport().kind, 'starting_point');
  assert.equal(delivery.status().pending, true);
  assert.equal(sent.length, 0);
  now += 3000;
  snapshot = { ...current, usable: true, lastObservedAtMs: now, startMs: 5000, endMs: 6500,
    assistantOutputStartedForContribution: false, activeSupport: delivery.activeSupport(), supportRevision: delivery.revision() };
  const result = earlyResultFixture({ need: 'none', facts: observed[language] }, snapshot);
  const classification = earlyResultDecision(result);
  assert.equal(classification.action, 'unclear');
  assert.equal(classification.clearSupport, false);
  assert.equal(classification.reason, 'revised_need_unidentified');
  const previousRevision = delivery.revision();
  const outcome = delivery.consider(record(result));
  assert.equal(outcome.reason, 'revised_need_support_withdrawn');
  assert.equal(delivery.activeSupport(), null);
  assert.equal(delivery.status().pending, false);
  assert.equal(delivery.revision(), previousRevision + 1);
  blocked = null; delivery.tick();
  assert.equal(sent.length, 0);
  assert.ok(logs.some(row => row.type === 'support_early_state_cleared'
    && row.reason === 'revised_need_unidentified' && row.contextSent === false));
  assert.ok(logs.every(row => row.playbackClaim === false));
});

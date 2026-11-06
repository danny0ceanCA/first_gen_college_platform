import assert from 'node:assert/strict';

const source = (id, day = 1, overrides = {}) => ({ id, version: 1, accountId: 'safety-family', studentId: 'safety-student',
  reporter: 'student', language: 'en', kind: 'note', recordedAt: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`,
  text: 'I received the confirmation. Actually, it is still pending. My next question is about housing.', synthetic: true, ...overrides });
const observation = (input, status = 'positive', overrides = {}) => ({ key: 'result', episodeKey: 'appointment-help', topic: 'finding_help',
  barrier: null, kind: 'outcome', status, statement: input.text, quote: input.text, reportedBy: input.reporter,
  language: 'en', occurredAt: null, linksTo: null, corrects: null, ...overrides });
const extraction = (...items) => ({ schemaVersion: 1, items });
async function save(store, input, raw = extraction(observation(input))) {
  const queued = await store.ingest(input);
  const job = await store.claim({ jobId: queued.id });
  await store.complete(job, raw); return job;
}
const find = async (store, episodeKey = 'appointment-help') => (await store.state({ accountId: 'safety-family', studentId: 'safety-student' })).episodes.find(e => e.episodeKey === episodeKey);
function assertHeld(episode, sourceId) {
  assert.equal(episode.outcomeState, 'unknown'); assert.equal(episode.analysisEligible, false);
  assert.equal(episode.reviewState, 'needs-review');
  assert.ok(episode.processingHolds.some(hold => hold.sourceId === sourceId));
  assert.ok(episode.evidenceWarnings.some(warning => warning.includes('not been successfully processed')));
}

// Run the same contract against synchronous SQLite and real PostgreSQL storage.
export function correctionSafetyTests(register, setup) {
  register('unread and failed corrections hold old outcomes; valid retry repairs without losing target evidence', async t => {
    const { store } = await setup(t), initial = source('first-result');
    await save(store, initial);
    const correction = source('later-correction', 2), queued = await store.ingest(correction);
    assertHeld(await find(store), correction.id);
    const job = await store.claim({ jobId: queued.id });
    assertHeld(await find(store), correction.id);
    const context = await store.contextFor(correction);
    assert.ok(context.existingItems.some(item => item.id === 'first-result@1#result' && item.state === 'current'));
    await assert.rejects(async () => store.complete(job, extraction(observation(correction, 'pending', { corrects: 'invented-target' }))), { code: 'unknown_item_reference' });
    await store.failure(job, { code: 'invalid_extraction' }, { maxAttempts: 1, retryDelayMs: 0 });
    const held = await find(store); assertHeld(held, correction.id);
    await store.review({ episodeId: held.id, expectedRevision: held.revision, decision: 'reviewed', note: 'Cannot clear an unread source.' });
    assertHeld(await find(store), correction.id);
    const unrelated = source('unrelated-later-source', 3);
    await save(store, unrelated, extraction(observation(unrelated, 'positive', { episodeKey: 'housing-search' })));
    assertHeld(await find(store), correction.id);
    await store.retry(queued.id);
    const retry = await store.claim({ jobId: queued.id });
    await store.complete(retry, extraction(observation(correction, 'pending', { corrects: 'first-result@1#result', linksTo: 'first-result@1#result' })));
    const repaired = await find(store);
    assert.equal(repaired.outcomeState, 'pending'); assert.equal(repaired.processingHolds.length, 0);
    assert.equal(repaired.items.find(item => item.id === 'first-result@1#result').state, 'superseded');
    assert.equal(repaired.analysisEligible, true);
    // Removal of the successful correction still cannot reactivate corrected data.
    await store.deleteSource(correction.id);
    const removed = await find(store);
    assert.equal(removed.outcomeState, 'unknown'); assert.equal(removed.analysisEligible, false);
    assert.equal(removed.items.find(item => item.id === 'first-result@1#result').state, 'superseded');
  });

  register('failed-source holds do not cross family, sibling, family-wide or reporter boundaries', async t => {
    const { store } = await setup(t), initial = source('isolated-result', 2); await save(store, initial);
    for (const [id, overrides] of [['different-family', { accountId: 'another-family' }], ['sibling', { studentId: 'another-student' }],
      ['family-wide', { studentId: null }], ['different-reporter', { reporter: 'parent' }]]) await store.ingest(source(id, 3, overrides));
    await store.ingest(source('older-unread-source', 1));
    const unchanged = await find(store);
    assert.equal(unchanged.outcomeState, 'positive'); assert.equal(unchanged.analysisEligible, true);
    assert.deepEqual(unchanged.processingHolds, []);
  });

  register('deleting an unread source cannot silently resurrect a positive outcome', async t => {
    const { store } = await setup(t); await save(store, source('before-unread-deletion'));
    const correction = source('unread-deleted', 2); await store.ingest(correction);
    await store.deleteSource(correction.id);
    let episode = await find(store);
    assert.equal(episode.outcomeState, 'unknown'); assert.equal(episode.analysisEligible, false);
    assert.equal((await store.state()).sources.some(input => input.id === correction.id), false);
    // An unrelated later statement cannot establish what the erased source said.
    await save(store, source('later-after-deletion', 3)); episode = await find(store);
    assert.equal(episode.outcomeState, 'unknown'); assert.equal(episode.reviewState, 'needs-review');
    await store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed' });
    assert.equal((await find(store)).analysisEligible, false);
  });

  register('a current needs-review decision excludes intact evidence until review is resolved', async t => {
    const { store } = await setup(t); await save(store, source('review-hold'));
    let episode = await find(store); assert.equal(episode.analysisEligible, true);
    await store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'needs-review', note: 'Check the evidence.' });
    episode = await find(store);
    assert.equal(episode.reviewState, 'needs-review'); assert.equal(episode.analysisEligible, false);
    assert.equal(episode.outcomeState, 'positive');
    await store.review({ episodeId: episode.id, expectedRevision: episode.revision, decision: 'reviewed' });
    assert.equal((await find(store)).analysisEligible, true);
  });

  register('an unread source deleted before episodes exist still protects older backfills in its exact scope', async t => {
    const { store } = await setup(t), unread = source('deleted-before-backfill', 3);
    await store.ingest(unread); await store.deleteSource(unread.id);
    assert.equal((await store.state()).episodes.length, 0);
    const older = source('backfilled-older-positive', 1); await save(store, older);
    const held = await find(store); assertHeld(held, unread.id);
    assert.equal(held.processingHolds[0].sourceDeleted, true);
    assert.equal((await store.state()).sourceHistory.some(input => input.id === unread.id), false);
    for (const [id, overrides] of [['gap-other-family', { accountId: 'gap-another-family' }], ['gap-sibling', { studentId: 'gap-another-student' }],
      ['gap-family-wide', { studentId: null }], ['gap-other-reporter', { studentId: 'separate-reporter-concern', reporter: 'parent' }]]) {
      const input = source(id, 1, overrides); await save(store, input);
      const episode = (await store.state()).episodes.find(row => row.items.some(item => item.sourceId === id));
      assert.equal(episode.outcomeState, 'positive'); assert.equal(episode.analysisEligible, true);
    }
    // Reporter isolation also holds when the student and episode key match.
    const parentOnly = source('gap-parent-only', 1, { reporter: 'parent' });
    await save(store, parentOnly, extraction(observation(parentOnly, 'positive', { episodeKey: 'parent-help' })));
    assert.equal((await find(store, 'parent-help')).analysisEligible, true);
    const future = source('future-new-concern', 4);
    await save(store, future, extraction(observation(future, 'positive', { episodeKey: 'new-future-concern' })));
    assert.equal((await find(store, 'new-future-concern')).analysisEligible, true);
    // Successful empty extraction is processed evidence, not an unread gap.
    const processed = source('processed-empty', 3, { studentId: 'processed-student' });
    await save(store, processed, extraction()); await store.deleteSource(processed.id);
    const backfill = source('processed-backfill', 1, { studentId: processed.studentId }); await save(store, backfill);
    assert.equal((await store.state()).episodes.find(row => row.studentId === processed.studentId).analysisEligible, true);
  });

  register('same-report resolved and open questions remain partial and counted as pending', async t => {
    const { store } = await setup(t), input = source('compound-question');
    await save(store, input, extraction(observation(input, 'resolved', { kind: 'question', key: 'resolved-part' }),
      observation(input, 'open', { kind: 'question', key: 'open-part' })));
    const episode = await find(store);
    assert.equal(episode.questionState, 'partial'); assert.equal(episode.analysisEligible, true);
    assert.equal((await store.state()).metrics.pending, 1);
    if (store.overview) assert.equal((await store.overview()).metrics.pending, 1);
    const uncertain = source('compound-unknown-question', 2, { studentId: 'uncertain-question-student' });
    await save(store, uncertain, extraction(observation(uncertain, 'resolved', { kind: 'question', key: 'resolved-part' }),
      observation(uncertain, 'unknown', { kind: 'question', key: 'unknown-part' })));
    assert.equal((await store.state()).episodes.find(row => row.studentId === uncertain.studentId).questionState, 'partial');
    assert.equal((await store.state()).metrics.pending, 2);
  });

  register('source scope and event order protect uncertain attribution and retrospective evidence', async t => {
    const { store } = await setup(t);
    const retrospective = source('retrospective-result', 4, { text: 'The office confirmed it at 2026-11-01T12:00:00.000Z.' });
    await save(store, retrospective, extraction(observation(retrospective, 'positive', { occurredAt: source('date', 1).recordedAt, reportedBy: 'unknown' })));
    // This source predates the save time, but could correct the earlier event.
    const unread = source('retrospective-correction', 2); await store.ingest(unread);
    assertHeld(await find(store), unread.id);
    const context = await store.contextFor(unread);
    assert.equal(context.existingItems[0].reportedBy, 'unknown');
  });

  register('correction links retain historical support only while their target evidence remains', async t => {
    const { store } = await setup(t), initial = source('corrected-link-target'), correction = source('correction-with-link', 2);
    await save(store, initial);
    const target = `${initial.id}@1#result`;
    await save(store, correction, extraction(observation(correction, 'pending', { corrects: target, linksTo: target })));
    assert.equal((await find(store)).analysisEligible, true);
    await store.deleteSource(initial.id);
    const removed = await find(store);
    assert.equal(removed.analysisEligible, false); assert.equal(removed.reviewState, 'needs-review');
    assert.equal(removed.items.find(item => item.sourceId === correction.id).linkState, 'unresolved');
  });

  register('lease expiry and re-extraction preserve the same hold until successful completion', async t => {
    let time = Date.parse('2026-11-05T12:00:00.000Z');
    const { store } = await setup(t, { clock: () => time }), input = source('reextract-positive'); await save(store, input);
    const queued = await store.ingest(input, 'repair-extractor-v2');
    const running = await store.claim({ jobId: queued.id, leaseMs: 100 });
    const revision = (await find(store)).revision; assertHeld(await find(store), input.id);
    time += 101; assert.equal(await store.claim({ jobId: queued.id, maxAttempts: 1 }), null);
    assertHeld(await find(store), input.id); assert.equal((await find(store)).revision, revision);
    await assert.rejects(async () => store.complete(running, extraction(observation(input))), { code: 'stale_job_lease' });
    await store.retry(queued.id);
    await store.complete(await store.claim({ jobId: queued.id }), extraction(observation(input)));
    assert.equal((await find(store)).outcomeState, 'positive'); assert.equal((await find(store)).processingHolds.length, 0);
  });

  register('simultaneous compound outcomes are conservative and independent of item/key order', async t => {
    const { store } = await setup(t);
    const a = source('compound-first'), b = source('compound-reversed', 1, { studentId: 'comparison-student' });
    const items = input => [observation(input, 'pending', { key: 'a-pending' }), observation(input, 'unsuccessful', { key: 'm-unsuccessful' }), observation(input, 'positive', { key: 'z-positive' })];
    await save(store, a, extraction(...items(a))); await save(store, b, extraction(...items(b).reverse()));
    const episodes = (await store.state()).episodes;
    for (const episode of episodes) {
      assert.equal(episode.outcomeState, 'mixed'); assert.equal(episode.analysisEligible, true);
      assert.equal(episode.reviewState, 'unreviewed'); assert.ok(episode.evidenceWarnings.some(warning => warning.includes('different result states')));
    }
    // Explicitly dated progression is different from simultaneous compound results.
    const later = source('dated-follow-up', 3, { text: 'It was pending at 2026-11-01T12:00:00.000Z. The office confirmed it at 2026-11-02T12:00:00.000Z.' });
    await save(store, later, extraction(observation(later, 'pending', { key: 'was-pending', occurredAt: a.recordedAt }),
      observation(later, 'positive', { key: 'now-confirmed', occurredAt: source('date', 2).recordedAt })));
    assert.equal((await find(store)).outcomeState, 'positive');
  });

  register('a partial correction cannot leave a duplicate positive in another episode eligible', async t => {
    const { store } = await setup(t);
    const original = source('welcome-original', 1, { text: 'The school confirmed my place in the new-student welcome group. I told my brother that the registration was accepted.' });
    await save(store, original, extraction(
      observation(original, 'positive', { key: 'welcome-confirmation', episodeKey: 'welcome-group', topic: 'enrollment', quote: 'The school confirmed my place in the new-student welcome group.' }),
      observation(original, 'positive', { key: 'registration-accepted', episodeKey: 'registration', topic: 'enrollment', quote: 'I told my brother that the registration was accepted.' })));
    const correction = source('welcome-retraction', 3, { text: 'The message was a waitlist notice; my place has not been accepted and I am still waiting.' });
    await save(store, correction, extraction(observation(correction, 'pending', { episodeKey: 'welcome-group', corrects: 'welcome-original@1#welcome-confirmation' })));
    const welcome = await find(store, 'welcome-group');
    assert.equal(welcome.outcomeState, 'pending'); assert.equal(welcome.analysisEligible, true);
    let companion = await find(store, 'registration');
    assert.equal(companion.outcomeState, 'unknown'); assert.equal(companion.analysisEligible, false);
    assert.equal(companion.reviewState, 'needs-review'); assert.equal(companion.correctionCoverageHolds.length, 1);
    if (store.getEpisode) assert.ok((await store.getEpisode(companion.id)).sourceHistory.some(input => input.id === correction.id));
    assert.ok(companion.evidenceWarnings.some(warning => warning.includes('Potential duplicate outcome')));
    assert.equal(companion.items[0].state, 'current'); assert.equal(companion.items[0].status, 'positive');
    assert.ok((await store.contextFor(original)).existingItems.some(item => item.id === 'welcome-original@1#registration-accepted'));
    await store.review({ episodeId: companion.id, expectedRevision: companion.revision, decision: 'reviewed' });
    assert.equal((await find(store, 'registration')).analysisEligible, false);
    const retrospective = source('retrospective-registration', 4, { text: 'The earlier registration message was at 2026-11-02T12:00:00.000Z.' });
    await save(store, retrospective, extraction(observation(retrospective, 'positive', { episodeKey: 'registration', occurredAt: source('date', 2).recordedAt })));
    assert.equal((await find(store, 'registration')).analysisEligible, false);
    const confirmed = source('new-independent-registration', 5, { text: 'The school has now separately confirmed my registration.' });
    await save(store, confirmed, extraction(observation(confirmed, 'positive', { episodeKey: 'registration' })));
    companion = await find(store, 'registration');
    assert.equal(companion.outcomeState, 'positive'); assert.equal(companion.analysisEligible, true);
    assert.equal(companion.correctionCoverageHolds.length, 0);
    await store.deleteSource(confirmed.id);
    assert.equal((await find(store, 'registration')).analysisEligible, false);
  });

  register('legitimate companion outcomes remain preserved while held and can be explicitly confirmed', async t => {
    const { store } = await setup(t);
    const otherSource = source('independent-housing', 1);
    await save(store, otherSource, extraction(observation(otherSource, 'positive', { episodeKey: 'housing-arrangement' })));
    const original = source('multiple-legitimate-results', 1, { text: 'I got the welcome place and a library card. I submitted the form.' });
    await save(store, original, extraction(
      observation(original, 'positive', { key: 'welcome', episodeKey: 'welcome' }),
      observation(original, 'positive', { key: 'library', episodeKey: 'library-card' }),
      observation(original, 'completed', { kind: 'action', key: 'submitted', episodeKey: 'form-submission' }),
      observation(original, 'positive', { key: 'uncertain-speaker', episodeKey: 'uncertain-speaker-result', reportedBy: 'unknown' })));
    const correction = source('legitimate-welcome-retraction', 3);
    await save(store, correction, extraction(observation(correction, 'pending', { episodeKey: 'welcome', corrects: 'multiple-legitimate-results@1#welcome' })));
    const library = await find(store, 'library-card');
    assert.equal(library.analysisEligible, false); assert.equal(library.items[0].status, 'positive');
    assert.equal((await find(store, 'form-submission')).actionState, 'completed');
    assert.equal((await find(store, 'form-submission')).analysisEligible, true);
    assert.equal((await find(store, 'housing-arrangement')).analysisEligible, true);
    assert.equal((await find(store, 'uncertain-speaker-result')).analysisEligible, true);
    const confirmed = source('explicit-library-confirmation', 4, { text: 'My library card really was accepted. That part of my earlier report is correct.' });
    await save(store, confirmed, extraction(observation(confirmed, 'positive', { episodeKey: 'library-card', corrects: 'multiple-legitimate-results@1#library' })));
    const cleared = await find(store, 'library-card');
    assert.equal(cleared.outcomeState, 'positive'); assert.equal(cleared.analysisEligible, true);
    assert.equal(cleared.items.find(item => item.id === 'multiple-legitimate-results@1#library').state, 'superseded');
  });
}

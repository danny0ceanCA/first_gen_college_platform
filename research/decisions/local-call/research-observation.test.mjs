import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchObservationTap } from './research-observation.mjs';

const scope = { sessionId: 'fictional-call', studentId: 'fictional-student' };
const drain = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const result = (language = 'en', changes = {}) => ({ id: 'fictional-job', status: 'completed', ...changes,
  result: { evidenceVersion: 1, sources: [{ url: 'https://fictional.invalid/reference' }],
    voiceBrief: { qualification: language === 'en' ? 'Academic year estimate before aid. [1]' : 'Estimación del año académico antes de ayuda. [1]',
      findings: [{ subject: 'Fictional campus', aspect: 'total_budget', status: 'verified', year: '2026–27', scenario: 'off campus',
        answer: language === 'en' ? 'The published off-campus total is USD 40,000. [1]' : 'El total publicado fuera del campus es USD 40,000. [1]',
        qualification: language === 'en' ? 'Not an individual bill. [1]' : 'No es una factura personal. [1]' }] }, ...(changes.result ?? {}) } });

for (const language of ['en', 'es']) test(`${language}: copied running, partial, complete, cancelled evidence retains whole qualifications and deduplicates polling`, async () => {
  const events = [], calls = [];
  let response = { id: 'fictional-job', status: 'queued' };
  const tap = createResearchObservationTap((...args) => { calls.push(args); return Promise.resolve(response); }, e => events.push(e), scope);
  const question = language === 'en' ? 'What would living near campus cost?' : '¿Cuánto costaría vivir cerca del campus?';
  await tap.request('POST', undefined, { question, api_key: 'not-copied' }); await drain();
  assert.equal(events[0].question, question); assert.equal(events[0].evidenceAvailability, 'missing');
  response = result(language, { status: 'running' });
  await tap.request('GET', 'fictional-job'); await drain();
  const partial = events.at(-1);
  assert.equal(partial.status, 'running'); assert.equal(partial.findings[0].year, '2026–27');
  assert.equal(partial.findings[0].scenario, 'off campus');
  assert.equal(partial.findings[0].limitation, response.result.voiceBrief.findings[0].qualification + '\n' + response.result.voiceBrief.qualification);
  assert.deepEqual(partial.findings[0].sourceIds, ['1']);
  assert.equal(partial.evidenceAvailability, 'available');
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.length, 2);
  response = result(language, { result: { evidenceVersion: 2 } });
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.length, 3);
  assert.equal(events.at(-1).revision, 3); assert.equal(events.at(-1).status, 'completed');
  response = result(language, { status: 'running' });
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.length, 3);
  response = { id: 'fictional-job', status: 'cancelled' };
  await tap.request('DELETE', 'fictional-job'); await drain();
  assert.equal(events.at(-1).status, 'cancelled'); assert.deepEqual(events.at(-1).findings, []);
  response = result(language); await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.length, 4);
  assert.equal(calls.length, 7); assert.equal(JSON.stringify(events).includes('not-copied'), false);
});

test('job responses, promise identity, exceptions and rejection remain exactly unchanged', async () => {
  const pending = deferred(), events = [], args = [], failure = Error('original-failure');
  const tap = createResearchObservationTap((...values) => { args.push(values); return pending.promise; }, e => events.push(e), scope);
  const body = { question: 'Original question' };
  assert.equal(tap.request('POST', undefined, body), pending.promise);
  const original = { id: 'fictional-job', status: 'queued', secret: 'private' };
  pending.resolve(original); assert.equal(await pending.promise, original); await drain();
  assert.equal(args.length, 1); assert.equal(args[0][2], body); assert.equal(original.secret, 'private');
  assert.equal(JSON.stringify(events).includes('private'), false);
  const bad = createResearchObservationTap(() => { throw failure; }, () => assert.fail(), scope);
  assert.throws(() => bad.request('POST'), error => error === failure);
  const rejected = Promise.reject(failure), noChange = createResearchObservationTap(() => rejected, () => assert.fail(), scope);
  assert.equal(noChange.request('POST'), rejected); await assert.rejects(rejected, error => error === failure); await drain();
});

test('scope generation fences late POST/GET, transition work, mismatched account objects and unknown jobs', async () => {
  const requests = [], events = [];
  const tap = createResearchObservationTap(() => { const item = deferred(); requests.push(item); return item.promise; }, e => events.push(e), scope);
  tap.request('POST', undefined, { question: 'First student?' }); requests[0].resolve({ id: 'fictional-job', status: 'queued' }); await drain();
  tap.request('GET', 'fictional-job');
  const next = { ...scope, studentId: 'fictional-second' };
  assert.equal(tap.beginScope(), 1);
  tap.request('POST', undefined, { question: 'During transition' });
  tap.finishScope(next);
  requests[1].resolve(result()); requests[2].resolve({ id: 'wrong-job', status: 'queued' }); await drain();
  assert.equal(events.length, 1);
  tap.request('GET', 'fictional-job'); requests[3].resolve(result()); await drain(); assert.equal(events.length, 1);
  tap.request('POST', undefined, { question: 'New student?' }); requests[4].resolve({ id: 'new-job', status: 'queued' }); await drain();
  assert.equal(events.at(-1).scopeGeneration, 1);
  tap.request('GET', 'new-job'); requests[5].resolve({ ...result(), id: 'new-job', student_id: scope.studentId }); await drain();
  assert.equal(events.length, 2);
  tap.close(); tap.request('GET', 'new-job'); requests[6].resolve({ ...result(), id: 'new-job' }); await drain(); assert.equal(events.length, 2);
});

test('malformed, missing or oversized evidence never silently becomes a verified finding', async () => {
  const events = []; let response = { id: 'fictional-job', status: 'queued' };
  const tap = createResearchObservationTap(() => Promise.resolve(response), e => events.push(e), scope);
  await tap.request('POST', undefined, { question: 'A published figure?' }); await drain();
  response = result(); response.result.voiceBrief.findings[0].qualification = 'ñ'.repeat(1100);
  await tap.request('GET', 'fictional-job'); await drain();
  assert.equal(events.at(-1).evidenceAvailability, 'oversized'); assert.deepEqual(events.at(-1).findings, []);
  response = result(); response.result.voiceBrief.findings[0].answer = null;
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.at(-1).evidenceAvailability, 'invalid');
  response = { id: 'fictional-job', status: 'completed', result: { text: 'Unsupported free text says it costs 40,000.' } };
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.at(-1).evidenceAvailability, 'missing');
  response = result(); response.result.voiceBrief.findings[0].status = 'partial';
  await tap.request('GET', 'fictional-job'); await drain(); assert.equal(events.at(-1).findings[0].status, 'partial');
  assert.equal(events.at(-1).findings[0].year, '2026–27');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalResearchStateGuard } from './research-terminal-state.mjs';
import { liveContextPackets, researchStateContext, researchContextPackets } from '../../../src/liveResearchContext.mjs';

const id = 'f0000000-0000-4000-8000-000000000001';
const command = content => ({ type: 'session.thinking.append', event_id: 'original-event', delegation_id: null, content });
const task = (state, changes = {}) => liveContextPackets('research-state', id,
  { ...researchStateContext({ jobId: id, revision: 2, state }), ...changes }).map(command);
const fact = language => language === 'en' ? 'The published off-campus total is USD 40,000. [1]' : 'El total publicado fuera del campus es USD 40,000. [1]';
const caveat = language => language === 'en' ? '2026–27 estimate before aid; tuition breakdown was not verified. [1]' : 'Estimación de 2026–27 antes de ayuda; el desglose de matrícula no se verificó. [1]';
function result(language) {
  return { question: language === 'en' ? 'What would living near campus cost?' : '¿Cuánto costaría vivir cerca del campus?', researchPending: false, evidenceVersion: 2,
    result: { checkedAt: '2026-11-08T00:00:00.000Z', status: 'source_check_completed', evidenceVersion: 2,
      text: fact(language), sources: [{ id: 1, title: 'Fictional official budget', url: 'https://fictional.invalid/costs' }],
      voiceBrief: { status: 'partial', answer: fact(language), qualification: caveat(language), nextStep: '',
        findings: [{ subject: 'Fictional campus', aspect: 'total_budget', status: 'verified', answer: fact(language), qualification: caveat(language), sourceIds: [1] }] } } };
}

for (const language of ['en', 'es']) test(`${language}: actual partial report keeps every fact and source, while the existing terminal state clarifies that work ended`, () => {
  const logs = [], guard = createTerminalResearchStateGuard({ diagnostic: row => logs.push(row) });
  const original = task('completed');
  assert.equal(original.length, 1, 'default UUID task-state shape fits one packet');
  const revised = guard.transform(original[0]);
  assert.notEqual(revised, original[0]);
  assert.equal(revised.event_id, original[0].event_id);
  assert.equal(revised.delegation_id, null);
  const oldPacket = JSON.parse(original[0].content), newPacket = JSON.parse(revised.content);
  const oldState = JSON.parse(oldPacket.text), newState = JSON.parse(newPacket.text);
  assert.match(newState.meaning, /partial evidence is not pending work/u);
  assert.match(newState.meaning, /unverified, not unpublished/u);
  assert.deepEqual({ ...newState, meaning: oldState.meaning }, oldState);
  assert.deepEqual({ ...newPacket, text: oldPacket.text }, oldPacket);
  assert.ok(Buffer.byteLength(revised.content) <= 480);
  const evidence = researchContextPackets(result(language), id, { completedState: true }).map(command);
  assert.ok(evidence.some(event => JSON.parse(event.content).unit === 'finding'));
  for (const event of evidence) {
    const after = guard.transform(event), packet = JSON.parse(event.content);
    if (packet.unit !== 'state') assert.equal(after, event, 'qualifications and source packets remain byte-for-byte identical');
    else if (after !== event) assert.deepEqual({ ...JSON.parse(after.content), taskMeaning: undefined }, { ...packet, taskMeaning: undefined });
  }
  assert.equal(result(language).result.voiceBrief.status, 'partial');
  assert.equal(logs[0].action, 'clarified');
  assert.equal(logs[0].jobId, id);
  assert.equal(logs[0].revision, 2);
  assert.equal(JSON.stringify(logs).includes(fact(language)), false, 'diagnostics do not copy report/student text');
});

test('small completed evidence-state packet keeps verification partial and adds only task meaning', () => {
  const guard = createTerminalResearchStateGuard();
  const original = command(JSON.stringify({ kind: 'untrusted-research-evidence', resultId: id, unit: 'state',
    taskState: 'completed', researchPending: false, evidenceVersion: 2, verification: 'partial' }));
  const revised = guard.transform(original), body = JSON.parse(revised.content);
  assert.equal(body.verification, 'partial');
  assert.match(body.taskMeaning, /Check ended/u);
  const { taskMeaning, ...unchanged } = body;
  assert.deepEqual(unchanged, JSON.parse(original.content));
});

test('failed work preserves verified findings without implying another lookup', () => {
  const original = task('failed')[0], guard = createTerminalResearchStateGuard();
  const state = JSON.parse(JSON.parse(guard.transform(original).content).text);
  assert.match(state.meaning, /This check failed/u);
  assert.match(state.meaning, /Retain verified findings and their qualifications/u);
  assert.equal(state.researchPending, false);
});

test('running, queued, cancelled, malformed, unrelated, and spoken commands remain untouched', () => {
  const guard = createTerminalResearchStateGuard();
  for (const status of ['queued', 'running', 'cancelled', 'unknown']) for (const event of task(status)) assert.equal(guard.transform(event), event);
  for (const event of [command('{'), command('null'), command('[]'), command(JSON.stringify({ kind: 'untrusted-research-evidence', unit: 'finding', taskState: 'completed', researchPending: false })),
    { ...task('completed')[0], type: 'session.commentary.append' }, { type: 'session.instructions.append', content: 'Existing intro' }]) assert.equal(guard.transform(event), event);
});

test('inconsistent terminal state is rejected and logged without rewriting pending work', () => {
  const logs = [], guard = createTerminalResearchStateGuard({ diagnostic: row => logs.push(row) });
  for (const changes of [{ researchPending: true }, { acceptedActiveJob: true }]) {
    const original = task('completed', changes)[0];
    assert.equal(guard.transform(original), original);
  }
  assert.equal(logs[0].reason, 'inconsistent_terminal_state');
});

test('fragmented and oversized state keeps the original packet sequence and logs skipped coverage', () => {
  const logs = [], guard = createTerminalResearchStateGuard({ diagnostic: row => logs.push(row) });
  const fragmented = liveContextPackets('research-state', id, researchStateContext({ jobId: 'x'.repeat(128), revision: 2, state: 'completed' })).map(command);
  assert.ok(fragmented.length > 1);
  for (const original of fragmented) assert.equal(guard.transform(original), original);
  assert.equal(logs.at(-1).reason, 'fragmented_state');
  const nearLimit = command(JSON.stringify({ kind: 'untrusted-research-evidence', resultId: id, unit: 'state', taskState: 'completed', researchPending: false, verification: 'partial', evidenceVersion: 2, focus: ['x'.repeat(245)] }));
  assert.ok(Buffer.byteLength(nearLimit.content) <= 480);
  assert.equal(guard.transform(nearLimit), nearLimit);
  assert.equal(logs.at(-1).reason, 'packet_budget');
});

test('diagnostic deduplication never drops an existing command, and scope reset allows new tracing', () => {
  const logs = [], guard = createTerminalResearchStateGuard({ diagnostic: row => logs.push(row) });
  const original = task('completed')[0];
  assert.deepEqual(guard.transform(original), guard.transform(original));
  assert.equal(logs.length, 1);
  guard.reset(); guard.transform(original); assert.equal(logs.length, 2);
  guard.close(); assert.equal(guard.transform(original), original);
  const brokenLogger = createTerminalResearchStateGuard({ diagnostic: () => { throw Error('logging unavailable'); } });
  assert.notEqual(brokenLogger.transform(original), original);
});

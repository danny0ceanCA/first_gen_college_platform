import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

async function appendWorkerRun(logPath, { packets = [], conversationEnabled = false } = {}) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { env: {}, workerData: {
    seed: { fictional: true, accountId: 'fictional-account', callId: 'same-fictional-call', studentId: 'fictional-student', language: 'en', role: 'student' },
    paid: false, supportEnabled: false, preferencesEnabled: false, conversationEnabled, logPath,
  } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(Error('worker_timeout')); }, 5000);
    worker.on('error', error => { clearTimeout(timer); reject(error); });
    worker.on('message', message => {
      if (message.type === 'ready') {
        for (const packet of packets) worker.postMessage(packet);
        worker.postMessage({ type: 'close', atMs: performance.now() });
      }
      if (message.type === 'failed') { clearTimeout(timer); reject(Error(message.reason)); }
    });
    worker.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`worker_exit_${code}`)); });
  });
}

test('actual workers append across restarts with distinct run IDs and durable sequence clocks without an API call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'origen-decisions-logs-'));
  try {
    const path = join(directory, 'same-call.jsonl');
    await appendWorkerRun(path); const first = readFileSync(path, 'utf8');
    await appendWorkerRun(path); const combined = readFileSync(path, 'utf8');
    assert.ok(combined.startsWith(first));
    const rows = combined.trim().split('\n').map(JSON.parse);
    const runs = [...new Set(rows.map(row => row.workerRunId))];
    assert.equal(runs.length, 2); assert.ok(runs.every(value => typeof value === 'string' && value.length === 36));
    for (const run of runs) {
      const events = rows.filter(row => row.workerRunId === run);
      assert.deepEqual(events.map(row => row.workerSequence), events.map((_, index) => index + 1));
      assert.equal(events[0].type, 'decisions_worker_started'); assert.equal(events.at(-1).type, 'decisions_worker_closed');
      assert.ok(events.every(row => row.callId === 'same-fictional-call' && Number.isFinite(row.workerElapsedMs) && !Number.isNaN(Date.parse(row.at))));
    }
    assert.equal(rows.some(row => row.type === 'decisions_api_started'), false);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('origen-decisions-logs-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('worker preserves context snapshots and records bounded eligibility with the conversation policy, without an API call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'origen-decisions-logs-'));
  try {
    const path = join(directory, 'eligibility.jsonl');
    const application = event => ({ source: 'application', atMs: performance.now(), event });
    const research = (revision, status) => ({ source: 'research', atMs: performance.now(), event: {
      type: 'research_task', scopeGeneration: 0, jobId: 'fictional-job', revision, question: 'Published annual total?',
      status, evidenceVersion: null, evidenceAvailability: 'missing', findings: [] } });
    await appendWorkerRun(path, { conversationEnabled: true, packets: [
      application({ type: 'response.output_audio_transcript.done', response_id: 'intro', transcript: 'Hello, how can I help?' }),
      application({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'question', transcript: 'I do not understand the cost.' }),
      application({ type: 'response.output_audio_transcript.done', response_id: 'offer', transcript: 'Would a short example help?' }),
      application({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'accept', transcript: 'Okay.' }),
      application({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'repeat', transcript: 'Okay.' }),
      research(1, 'queued'), research(2, 'running'), research(3, 'completed'),
    ] });
    const rows = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    const captures = rows.filter(row => row.type === 'snapshot_observed');
    assert.equal(captures.length, 8); assert.equal(captures.filter(row => row.eligibility.eligible).length, 4);
    assert.equal(captures.filter(row => row.eligibility.researchChanged).length, 1);
    assert.ok(captures.every(row => row.classification === 'disabled'));
    assert.equal(rows[0].conversationEnabled, true); assert.match(rows[0].rubricVersion, /^conversation-support-/);
    assert.equal(rows.some(row => row.type === 'decisions_api_started'), false);
    assert.ok(rows.every(row => !row.contextSent && !row.playbackClaim));
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('origen-decisions-logs-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

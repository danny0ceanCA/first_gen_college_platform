import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createVoiceControl, voiceControlSession } from '../../../server/voice-control.mjs';
import { createObservedLocalSession } from './session.mjs';

const until = async check => {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('condition_timed_out');
};
class Provider extends EventEmitter {
  constructor() { super(); this.readyState = WebSocket.CONNECTING; this.sent = []; setImmediate(() => { this.readyState = WebSocket.OPEN; this.emit('open'); }); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.emit('close'); }
}

test('production rejects a custom local session factory', () => {
  assert.throws(() => createVoiceControl({ env: { NODE_ENV: 'production' }, sessionFactory: () => {} }), /local_session_factory_not_allowed/);
  assert.doesNotThrow(() => createVoiceControl({ env: { NODE_ENV: 'production' }, sessionFactory: voiceControlSession }));
});

for (const language of ['en', 'es']) test(`${language}: authenticated local control socket copies transcripts without adding a provider writer`, async () => {
  const callId = 'fictional-' + randomUUID(), providers = [], observations = [], trusted = [];
  const control = createVoiceControl({
    env: { NODE_ENV: 'development', ORIGEN_LIVE_SERVER_CONTROL: 'true', ORIGEN_BACKGROUND_RESEARCH: 'true', ALLOWED_ORIGINS: 'http://localhost.test' },
    authenticate: async () => ({ sub: 'local-owner' }), authorize: async () => 1, request: async () => ({}),
    connect: () => { const p = new Provider(); providers.push(p); return p; },
    sessionFactory: options => {
      trusted.push({ subject: options.subject, scope: options.scope });
      const engine = createObservedLocalSession(options, {
        localOnly: true, fictional: true, allowedCallIds: [callId],
        seed: { fictional: true, accountId: 'local-owner', callId, studentId: 'test-student', language },
      });
      observations.push(engine.observation); return engine;
    },
  });
  const server = createServer(); control.attach(server);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const receipt = control.register({ subject: 'local-owner', permissionRevision: 1, providerId: 'fictional-live-session', sessionId: callId,
    scope: { sessionId: callId, studentId: 'test-student', confirmed: true }, config: { language, tools: [] } });
  const browser = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/voice-control`, { origin: 'http://localhost.test' });
  browser.on('error', () => {});
  const messages = []; browser.on('message', data => messages.push(JSON.parse(data)));
  try {
    await once(browser, 'open'); browser.send(JSON.stringify({ type: 'authenticate', token: 'local-token', id: receipt.id }));
    await until(() => messages.some(m => m.type === 'ready'));
    assert.equal(trusted.length, 1); assert.equal(trusted[0].subject, 'local-owner'); assert.equal(trusted[0].scope.sessionId, callId);
    assert.equal(await observations[0].ready, true);
    const intro = language === 'es' ? 'Hola, qué gusto escucharte.' : 'Hi, it is good to hear from you.';
    providers[0].emit('message', Buffer.from(JSON.stringify({ type: 'session.output_transcript.delta', delta: intro, start_ms: 0, end_ms: 1000 })));
    await until(() => messages.some(m => m.event?.type === 'response.output_audio_transcript.delta'));
    assert.equal(messages.find(m => m.event?.type === 'response.output_audio_transcript.delta').event.delta, intro);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].sent.some(e => /append$/.test(e.type) || e.type === 'response.create'), false);
    assert.equal(observations[0].status().failed, false);
  } finally {
    browser.close(); control.close(); await new Promise(r => server.close(r));
    await Promise.all(observations.map(o => o.closed));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAdminHandler } from '../admin.mjs';
import { AUTH_TIME_CLAIM } from '../recent-auth.mjs';
import { networkAdminInput } from './admin.mjs';

const reader = { sub: 'fictional-network-reviewer', permissions: ['read:network-effects'], iat: Math.floor(Date.now()/1000), [AUTH_TIME_CLAIM]: Math.floor(Date.now()/1000) };
async function request(data, { identity = reader, enabled = true, blocked = false, auditFails = false, repository = {}, authorized = true } = {}) {
  const audit = [], calls = [];
  const database = { query: async (sql, values) => {
    if (sql.startsWith('SELECT blocked')) return { rows: blocked ? [{ blocked: true }] : [] };
    if (sql.startsWith('INSERT INTO origen_privileged_access_audit')) { if (auditFails) throw new Error('offline'); audit.push(values); return { rows: [] }; }
    throw new Error('Unexpected operational database query');
  } };
  const repo = new Proxy(repository, { get(target, key) { return async (...args) => { calls.push([key, ...args]); return target[key]?.(...args); }; } });
  const req = Readable.from([typeof data === 'string' ? data : JSON.stringify(data)]);
  Object.assign(req, { url: '/api/admin', method: 'POST', origenAuthorized: authorized, origenIdentity: identity });
  let status, body;
  const res = { writeHead: value => { status = value; }, end: value => { body = JSON.parse(value); } };
  await createAdminHandler(database, { NETWORK_EFFECTS_ENABLED: String(enabled) }, { networkRepository: repo })(req, res, () => assert.fail('unexpected next'));
  return { status, body, audit, calls };
}
test('network feature is disabled by default and never touches its repository', async () => {
  const result = await request({ action: 'network-overview' }, { enabled: false });
  assert.equal(result.status, 503); assert.equal(result.body.error, 'network_effects_disabled'); assert.equal(result.calls.length, 0);
});
test('authentication, explicit permission, revocation and audit remain mandatory', async () => {
  for (const options of [{ authorized: false }, { identity: { ...reader, permissions: ['read:activity'] } }, { blocked: true }, { auditFails: true }]) {
    const result = await request({ action: 'network-overview' }, options);
    assert.ok([401,403,503].includes(result.status)); assert.equal(result.calls.length, 0);
  }
});
test('admin pagination forwards only repository parameters and serves proper overview', async () => {
  const listing = await request({ action: 'network-episodes', page: 2, pageSize: 12, language: 'es' }, { repository: { listEpisodes: args => ({ ...args, items: [], total: 0 }) } });
  assert.equal(listing.status, 200); assert.deepEqual(listing.calls[0], ['listEpisodes', { page: 2, pageSize: 12, language: 'es' }]);
  const overview = await request({ action: 'network-overview' }, { repository: { overview: () => ({ metrics: { sources: 15 }, mode: 'shadow' }) } });
  assert.equal(overview.body.metrics.sources, 15); assert.equal(overview.body.mode, 'observation-only');
  assert.equal(overview.audit.length, 1);
});
test('AI check inspection is read-only, audited and available with evidence read permission', async () => {
  const id = '5e67c012-4660-4af0-9772-36d0bc303581';
  const detail = { job: { id, status: 'completed' }, source: { text: 'Fictional private source.' },
    attempts: [{ attempt: 1, audit: { decision: 'kept', initial: { items: [] }, final: { items: [] } } }] };
  const result = await request({ action: 'network-verification', id }, {
    identity: { ...reader, [AUTH_TIME_CLAIM]: 1 }, repository: { getVerification: value => value === id ? detail : null },
  });
  assert.equal(result.status, 200); assert.deepEqual(result.body, detail);
  assert.deepEqual(result.calls, [['getVerification', id]]); assert.equal(result.audit.length, 1);
  assert.ok(!JSON.stringify(result.audit).includes('Fictional private source.'));
});
test('AI check inspection preserves authentication, permission, feature, revocation and audit gates', async () => {
  for (const options of [{ authorized: false }, { identity: { ...reader, permissions: ['read:activity'] } },
    { identity: { ...reader, permissions: ['write:network-effects-review'] } }, { enabled: false }, { blocked: true }, { auditFails: true }]) {
    const result = await request({ action: 'network-verification', id: '5e67c012-4660-4af0-9772-36d0bc303581' }, options);
    assert.ok([401, 403, 503].includes(result.status)); assert.deepEqual(result.calls, []);
  }
});
test('AI check inspection rejects mutation fields and invalid IDs and reports a missing saved check', async () => {
  for (const input of [{ action: 'network-verification' }, { action: 'network-verification', id: '../private' },
    { action: 'network-verification', id: 'valid-id', run: true }, { action: 'network-verification', id: 'valid-id', decision: 'kept' }]) {
    const result = await request(input); assert.equal(result.status, 400); assert.deepEqual(result.calls, []);
  }
  const missing = await request({ action: 'network-verification', id: '5e67c012-4660-4af0-9772-36d0bc303581' },
    { repository: { getVerification: () => null } });
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'network_verification_not_found');
  const failed = await request({ action: 'network-verification', id: '5e67c012-4660-4af0-9772-36d0bc303581' },
    { repository: { getVerification: () => { throw new Error('postgres://private-secret'); } } });
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'network_effects_unavailable');
});
test('review needs both evidence read and review write permission plus fresh login', async () => {
  const input = { action: 'network-review', episodeId: 'a'.repeat(64), expectedRevision: 'b'.repeat(64), decision: 'reviewed', note: 'Checked source.' };
  for (const identity of [reader, { ...reader, permissions: ['write:network-effects-review'] }, { ...reader, permissions: [...reader.permissions, 'write:network-effects-review'], [AUTH_TIME_CLAIM]: 1 }]) {
    const result = await request(input, { identity }); assert.equal(result.status, 403); assert.equal(result.calls.length, 0);
  }
  const ok = await request(input, { identity: { ...reader, permissions: [...reader.permissions, 'write:network-effects-review'] }, repository: { review: () => ({}), getEpisode: () => ({ episode: { id: input.episodeId } }) } });
  assert.equal(ok.status, 200); assert.equal(ok.calls[0][0], 'review'); assert.equal(ok.calls[0][2].length, 64);
  assert.ok(!JSON.stringify(ok.audit).includes('Checked source.'));
});
test('stale evidence is a conflict and arbitrary database failure is redacted', async () => {
  const stale = await request({ action: 'network-episode', id: 'a'.repeat(64) }, { repository: { getEpisode: () => { throw Object.assign(new Error('stale_review'), { status: 409 }); } } });
  assert.equal(stale.status, 409);
  const failed = await request({ action: 'network-overview' }, { repository: { overview: () => { throw new Error('postgres://secret-password'); } } });
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'network_effects_unavailable');
});
test('unexpected actions, oversized bodies, arbitrary filters and invalid revisions fail closed', async () => {
  for (const input of [{ action: 'network-publish' }, { action: 'network-episodes', accountId: 'foreign' }, { action: 'network-episodes', pageSize: 1000 }, { action: 'network-review', episodeId: 'x', expectedRevision: 'old', decision: 'publish' }]) {
    const result = await request(input, { identity: { ...reader, permissions: [...reader.permissions, 'write:network-effects-review'] } }); assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  }
  assert.equal((await request('x'.repeat(8193))).status, 413);
  assert.throws(() => networkAdminInput({ action: 'network-jobs', sql: 'DELETE' }));
});

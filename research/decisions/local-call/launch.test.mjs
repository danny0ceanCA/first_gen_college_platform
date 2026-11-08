import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_COPY, localConfiguration, workerEnvironment, verifyLocalDatabase, launchLocalCall } from './launch.mjs';

test('local launch ignores production credentials, transports and proxy settings', () => {
  const env = localConfiguration({ OPENAI_API_KEY: 'fake-key', VITE_AUTH0_DOMAIN: 'example.auth0.com', VITE_AUTH0_AUDIENCE: 'test-api',
    DATABASE_URL: 'postgresql://production/database', RENDER_API_KEY: 'never-copy', AUTH0_MANAGEMENT_TOKEN: 'never-copy',
    ORIGEN_LIVE_SERVER_CONTROL: 'false', DEV_API_PROXY_TARGET: 'https://production.example', SMTP_PASSWORD: 'never-copy' });
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).port, '55480');
  assert.equal(env.AUTH0_DOMAIN, 'example.auth0.com');
  assert.equal(env.ORIGEN_LIVE_SERVER_CONTROL, 'true');
  for (const key of ['RENDER_API_KEY', 'AUTH0_MANAGEMENT_TOKEN', 'DEV_API_PROXY_TARGET', 'SMTP_PASSWORD']) assert.equal(env[key], undefined);
  const worker = workerEnvironment(env, { PATH: 'safe-path', DATABASE_URL: 'production', RENDER_API_KEY: 'never-copy', NODE_OPTIONS: '--require=unwanted' });
  assert.equal(worker.PATH, 'safe-path');
  assert.equal(new URL(worker.RESEARCH_WORKER_DATABASE_URL).username, LOCAL_COPY.workerRole);
  for (const key of ['DATABASE_URL', 'RENDER_API_KEY', 'NODE_OPTIONS']) assert.equal(worker[key], undefined);
});

test('database identity must match the isolated copy, role, and loopback listener', async () => {
  const row = { name: LOCAL_COPY.database, role: LOCAL_COPY.runtimeRole, host: '127.0.0.1', port: LOCAL_COPY.port };
  const pool = value => ({ query: async () => ({ rows: [value] }) });
  await verifyLocalDatabase(pool(row));
  for (const wrong of [{ host: '10.0.0.1' }, { name: 'production' }, { role: 'postgres' }, { port: 5432 }])
    await assert.rejects(verifyLocalDatabase(pool({ ...row, ...wrong })), /isolated_local_database_required/);
});

test('launch cannot load credentials or connect in production', async () => {
  await assert.rejects(launchLocalCall({ processEnv: { NODE_ENV: 'production' } }), /local_development_only/);
});

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer, loadEnv } from 'vite';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createApp } from '../../../server/index.mjs';
import { createDatabase } from '../../../server/database.mjs';
import { assertRuntimeIsolation, isolateDatabase, runAsAccount } from '../../../server/account-isolation.mjs';
import { assertBackgroundResearchReady } from '../../../server/voice-research-jobs.mjs';
import { voiceControlSession } from '../../../server/voice-control.mjs';
import { createObservedLocalSession } from './session.mjs';

export const LOCAL_COPY = Object.freeze({
  database: 'origen_decisions_local_20261107', host: '127.0.0.1', port: 55480,
  runtimeRole: 'origen_research_local_runtime', workerRole: 'origen_research_worker',
  subject: 'auth0|6ac5d01925b6ed1a2b8baa9e',
});
const root = fileURLToPath(new URL('../../../', import.meta.url));
const openaiNames = [
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MODEL_CONVERSATION', 'OPENAI_MODEL_RESEARCH',
  'OPENAI_MODEL_FINANCE_RESEARCH', 'OPENAI_MODEL_ADMISSIONS_RESEARCH',
  'OPENAI_MODEL_OPPORTUNITIES', 'OPENAI_MODEL_SUMMARY', 'OPENAI_MODEL_TOPIC_RECAP', 'OPENAI_MODEL_VOICE',
];
const localUrl = role => `postgresql://${role}@${LOCAL_COPY.host}:${LOCAL_COPY.port}/${LOCAL_COPY.database}`;

// Copy approved credential names only. Never inherit a database, remote proxy,
// Render credential, exporter, mail transport, or production feature override.
export function localConfiguration(source = {}) {
  const env = Object.fromEntries(openaiNames.filter(key => typeof source[key] === 'string' && source[key]).map(key => [key, source[key]]));
  env.AUTH0_DOMAIN = source.AUTH0_DOMAIN || source.VITE_AUTH0_DOMAIN;
  env.AUTH0_AUDIENCE = source.AUTH0_AUDIENCE || source.VITE_AUTH0_AUDIENCE;
  if (!env.OPENAI_API_KEY || !env.AUTH0_DOMAIN || !env.AUTH0_AUDIENCE) throw Error('local_openai_auth0_configuration_required');
  if (!/^[a-z0-9.-]+$/i.test(env.AUTH0_DOMAIN)) throw Error('invalid_local_auth0_domain');
  return Object.freeze({ ...env,
    DATABASE_URL: localUrl(LOCAL_COPY.runtimeRole), NODE_ENV: 'development',
    ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173',
    ORIGEN_LIVE_FOLLOWUPS: 'true', ORIGEN_VOICE_PREPARATION: 'true',
    ORIGEN_BACKGROUND_RESEARCH: 'true', ORIGEN_LIVE_SERVER_CONTROL: 'true',
    ORIGEN_RESEARCH_DELIVERY_V2: 'true', OBSERVABILITY_EXPORT: 'false',
    GUARDIAN_EMAIL_TRANSPORT: 'disabled', REGISTRATION_EMAIL_TRANSPORT: 'disabled',
    ORIGEN_PRIVATE_VOICE_CAPTURE_SUBJECT: LOCAL_COPY.subject,
  });
}

export function workerEnvironment(env, inherited = {}) {
  const names = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH'];
  return { ...Object.fromEntries(names.filter(key => typeof inherited[key] === 'string').map(key => [key, inherited[key]])),
    ...Object.fromEntries(openaiNames.filter(key => env[key]).map(key => [key, env[key]])),
    NODE_ENV: 'development', RESEARCH_WORKER_DATABASE_URL: localUrl(LOCAL_COPY.workerRole), OBSERVABILITY_EXPORT: 'false',
  };
}

export async function verifyLocalDatabase(pool) {
  const row = (await pool.query('SELECT current_database() AS name, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
  if (row?.name !== LOCAL_COPY.database || row.role !== LOCAL_COPY.runtimeRole
    || !['127.0.0.1', '::ffff:127.0.0.1'].includes(row.host) || row.port !== LOCAL_COPY.port) throw Error('isolated_local_database_required');
}

export async function launchLocalCall({ processEnv = process.env } = {}) {
  if (processEnv.NODE_ENV === 'production') throw Error('local_development_only');
  const env = localConfiguration({ ...loadEnv('development', root, ''), ...processEnv });
  const paid = processEnv.ORIGEN_LOCAL_DECISIONS_APPROVED === 'true';
  const supportEnabled = processEnv.ORIGEN_LOCAL_CONVERSATION_SUPPORT === 'true';
  const preferencesEnabled = processEnv.ORIGEN_LOCAL_LASTING_PREFERENCES === 'true';
  const conversationEnabled = processEnv.ORIGEN_LOCAL_CONTINUATION_SUPPORT === 'true';
  const earlyEnabled = processEnv.ORIGEN_LOCAL_EARLY_DECISIONS === 'true';
  const lateEnabled = processEnv.ORIGEN_LOCAL_LATE_DELIVERY_EXPERIMENT === 'true';
  const betweenThoughtsEnabled = processEnv.ORIGEN_LOCAL_BETWEEN_THOUGHTS === 'true';
  const microphoneBudgetApproved = processEnv.ORIGEN_LOCAL_MICROPHONE_BUDGET === 'true';
  if (supportEnabled && !paid) throw Error('support_requires_approved_classification');
  if (preferencesEnabled && !supportEnabled) throw Error('preferences_require_local_support');
  if (conversationEnabled && !supportEnabled) throw Error('conversation_support_requires_local_support');
  if (earlyEnabled && !conversationEnabled) throw Error('early_support_requires_conversation_support');
  if (lateEnabled && !earlyEnabled) throw Error('late_experiment_requires_early_support');
  if (betweenThoughtsEnabled && !earlyEnabled) throw Error('between_thoughts_requires_early_support');
  let app, api, ui, pool, worker, workerReady = false, stopPromise, constructionFailures = 0, allowedStudentIds = [];
  const observations = new Set(), recentObservers = [];
  const observerFactory = options => {
    try {
      if (options.subject !== LOCAL_COPY.subject) throw Error('local_test_account_only');
      const engine = createObservedLocalSession(options, {
        localOnly: true, dataKind: 'isolated-copy', fictional: false,
        seed: { fictional: false, isolatedLocal: true, dataKind: 'isolated-copy', accountId: 'isolated-account-copy', callId: options.scope.sessionId,
          studentId: options.scope.studentId ?? 'unselected', language: options.config.language === 'es' ? 'es' : 'en', role: 'family' },
        allowedCallIds: [options.scope.sessionId], allowedStudentIds, paid, supportEnabled, preferencesEnabled, conversationEnabled, earlyEnabled, lateEnabled, betweenThoughtsEnabled, microphoneBudgetApproved, apiKey: paid ? env.OPENAI_API_KEY : undefined,
        onStatus: status => console.log(JSON.stringify({ event: 'local_observer_status', sessionId: options.scope.sessionId, ...status })),
      });
      observations.add(engine.observation);
      void engine.observation.closed.then(() => {
        recentObservers.push(engine.observation.status());
        if (recentObservers.length > 16) recentObservers.shift();
        observations.delete(engine.observation);
      });
      return engine;
    } catch {
      constructionFailures++;
      console.error('local_observer_construction_failed');
      return voiceControlSession(options);
    }
  };
  const status = () => ({ local: true, branch: 'v1.3-decisions-integration', dataKind: 'isolated-copy',
    database: LOCAL_COPY.database, productionWrites: false, observeOnly: !supportEnabled, cuesEnabled: supportEnabled,
    supportEnabled, preferencesEnabled, conversationEnabled, earlyEnabled, lateEnabled, betweenThoughtsEnabled, microphoneBudgetApproved, researchObserveOnly: true,
    classificationEnabled: paid, workerReady, observerCount: observations.size, constructionFailures,
    observers: [...observations].map(observation => observation.status()), recentObservers,
  });
  async function bounded(work, ms = 2500) {
    let timer;
    try { return await Promise.race([Promise.resolve(work).then(() => true, () => false), new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), ms); })]); }
    finally { clearTimeout(timer); }
  }
  function stop() {
    stopPromise ??= (async () => {
      const observedClosed = [...observations].map(observation => observation.closed);
      // HTTP closeAllConnections excludes upgraded WebSockets. Close the actual
      // voice controller first so the provider and observation workers finish.
      app?.closeVoiceControls();
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const exited = once(worker, 'exit');
        worker.kill('SIGTERM');
        if (!await bounded(exited, 2500)) { worker.kill('SIGKILL'); await bounded(exited, 1000); }
      }
      await bounded(ui?.close());
      if (api) { api.closeAllConnections(); await bounded(new Promise(resolveClose => api.close(resolveClose))); }
      await bounded(Promise.all(observedClosed), 3000);
      await bounded(app?.privacyMonitor?.flush());
      await bounded(app?.flushLogs());
      await bounded(pool?.end());
    })();
    return stopPromise;
  }
  try {
    pool = createDatabase(env, undefined, { max: 6 });
    await verifyLocalDatabase(pool);
    await assertRuntimeIsolation(pool);
    await assertBackgroundResearchReady(pool, env);
    const database = isolateDatabase(pool);
    allowedStudentIds = await runAsAccount({ sub: LOCAL_COPY.subject }, async () =>
      (await database.query('SELECT s.id FROM origen_students s JOIN origen_accounts a ON a.id=s.account_id WHERE a.auth0_subject=$1', [LOCAL_COPY.subject])).rows.map(row => row.id));
    if (!allowedStudentIds.length) throw Error('isolated_account_copy_students_required');
    const jwks = createRemoteJWKSet(new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    const verify = async token => {
      const { payload } = await jwtVerify(token, jwks, { issuer: `https://${env.AUTH0_DOMAIN}/`, audience: env.AUTH0_AUDIENCE, algorithms: ['RS256'] });
      if (payload.sub !== LOCAL_COPY.subject) throw Error('local_test_account_only');
      return payload;
    };
    // Never let a new test launch silently spend on old queued jobs left in the
    // clone. Completed historical reports remain readable.
    const workerCheck = createDatabase({ NODE_ENV: 'development', DATABASE_URL: localUrl(LOCAL_COPY.workerRole) }, undefined, { max: 1 });
    try {
      const pending = Number((await workerCheck.query("SELECT count(*) FROM origen_voice_research_jobs WHERE status IN ('queued','running')")).rows[0]?.count);
      if (pending) throw Error('local_historical_research_jobs_require_review');
    } finally { await workerCheck.end(); }
    app = createApp(env, verify, database, undefined, { localObserverFactory: observerFactory });
    api = createServer((request, response) => {
      if (request.url === '/__local_observer' && request.method === 'GET') {
        const hostAllowed = ['127.0.0.1:3001', 'localhost:3001'].includes(request.headers.host);
        const originAllowed = !request.headers.origin || ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(request.headers.origin);
        if (!hostAllowed || !originAllowed) { response.writeHead(403); response.end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(status())); return;
      }
      void app(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
    });
    app.attachServer(api);
    await new Promise((resolveListen, reject) => { api.once('error', reject); api.listen(3001, '127.0.0.1', resolveListen); });
    process.env.NODE_ENV = 'development';
    process.env.DEV_API_PROXY_TARGET = 'http://127.0.0.1:3001';
    // A saved VITE_API_URL can bypass Vite's proxy entirely. Pin both the env
    // and compiled reference to same-origin API/WS requests for this launcher.
    process.env.VITE_API_URL = '';
    ui = await createViteServer({ root, mode: 'development', define: { 'import.meta.env.VITE_API_URL': '""' },
      server: { host: '127.0.0.1', port: 5173, strictPort: true } });
    await ui.listen();
    worker = spawn(process.execPath, ['scripts/voice-research-worker.mjs'], {
      cwd: root, env: workerEnvironment(env, processEnv), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(Error('local_research_worker_start_timeout')), 10000);
      let buffered = '';
      worker.stdout.on('data', data => {
        const value = data.toString(); buffered = (buffered + value).slice(-16384); process.stdout.write(value);
        if (buffered.includes('voice.research.worker_ready')) { workerReady = true; clearTimeout(timeout); resolveReady(); }
      });
      worker.stderr.on('data', () => console.error('local_research_worker_stderr'));
      worker.once('error', () => { clearTimeout(timeout); reject(Error('local_research_worker_spawn_failed')); });
      worker.once('exit', () => { workerReady = false; clearTimeout(timeout); reject(Error('local_research_worker_stopped')); });
    });
    console.log(JSON.stringify({ event: 'local_observer_app_ready', url: 'http://127.0.0.1:5173/#app', ...status() }));
    return { stop, status };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  launchLocalCall().then(({ stop }) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop().finally(() => process.exit(0)));
  }).catch(error => {
    const code = typeof error?.message === 'string' && /^[a-z0-9_]+$/i.test(error.message) ? error.message : 'local_launch_failed';
    console.error(code); process.exitCode = 1;
  });
}

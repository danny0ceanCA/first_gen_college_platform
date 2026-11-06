import { createDatabase } from '../database.mjs';
import { staffHash, staffPermissions } from '../staff-access.mjs';
import { topicLabels } from '../../research/network-effects/contracts.mjs';
import { createNetworkEffectsRepository } from './repository.mjs';
import { assertNetworkRole } from './database.mjs';

const pools = new Map();
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };
const actions = new Set(['network-overview', 'network-episodes', 'network-episode', 'network-review', 'network-jobs', 'network-verification', 'network-evaluations', 'network-evaluation']);
export const isNetworkEffectsAction = action => actions.has(action);

export function networkAdminInput(input) {
  if (!input || !actions.has(input.action)) fail('invalid_network_action');
  const listing = ['network-episodes', 'network-jobs', 'network-evaluations'].includes(input.action);
  const detail = ['network-episode', 'network-evaluation', 'network-verification'].includes(input.action);
  const allowed = new Set(['action', ...(listing ? ['page', 'pageSize'] : []), ...(input.action === 'network-episodes' ? ['topic', 'language', 'status', 'query'] : []), ...(detail ? ['id'] : []), ...(input.action === 'network-review' ? ['episodeId', 'expectedRevision', 'decision', 'note'] : [])]);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('invalid_network_input');
  if (listing && (!Number.isSafeInteger(input.page ?? 1) || (input.page ?? 1) < 1 || (input.page ?? 1) > 10000 || !Number.isSafeInteger(input.pageSize ?? 20) || (input.pageSize ?? 20) < 1 || (input.pageSize ?? 20) > 50)) fail('invalid_network_page');
  if (input.topic && !Object.hasOwn(topicLabels, input.topic)) fail('invalid_network_topic');
  if (input.language !== undefined && (typeof input.language !== 'string' || input.language.length > 35)) fail('invalid_network_language');
  if (input.status && !['reviewed', 'unreviewed', 'needs-review'].includes(input.status)) fail('invalid_network_status');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 120)) fail('invalid_network_query');
  if (detail && (typeof input.id !== 'string' || !/^[a-zA-Z0-9:._-]{1,160}$/.test(input.id))) fail('invalid_network_id');
  if (input.action === 'network-review' && (!/^[a-f0-9]{64}$/.test(input.episodeId || '') || !/^[a-f0-9]{64}$/.test(input.expectedRevision || '') || !['reviewed', 'needs-review'].includes(input.decision) || typeof (input.note ?? '') !== 'string' || (input.note ?? '').length > 2000)) fail('invalid_network_review');
  return input;
}

async function configuredRepository(env) {
  if (!env.NETWORK_EFFECTS_ADMIN_DATABASE_URL) fail('network_effects_database_not_configured', 503);
  const key = env.NETWORK_EFFECTS_ADMIN_DATABASE_URL;
  if (!pools.has(key)) {
    const pool = createDatabase({ ...env, DATABASE_URL: key, DATABASE_TLS_MODE: env.NETWORK_EFFECTS_DATABASE_TLS_MODE, DATABASE_SSL_CA: env.NETWORK_EFFECTS_DATABASE_SSL_CA }, undefined, { max: 2 });
    pools.set(key, { pool, repository: createNetworkEffectsRepository(pool), checked: false });
  }
  const entry = pools.get(key);
  if (!entry.checked) {
    await assertNetworkRole(entry.pool, 'origen_network_admin');
    entry.checked = true;
  }
  return entry.repository;
}

/** Called only after the existing admin capability, revocation and audit gates. */
export async function adminNetworkEffects(input, identity, env = {}, repository) {
  if (env.NETWORK_EFFECTS_ENABLED !== 'true') fail('network_effects_disabled', 503);
  if (!staffPermissions(identity, env).includes('read:network-effects')) fail('staff_permission_required', 403);
  const data = networkAdminInput(input);
  const { action, ...parameters } = data;
  const repo = repository || await configuredRepository(env);
  if (data.action === 'network-overview') return { ...await repo.overview(), enabled: true, mode: 'observation-only' };
  if (data.action === 'network-episodes') return repo.listEpisodes(parameters);
  if (data.action === 'network-episode') {
    const detail = await repo.getEpisode(data.id);
    if (!detail) fail('network_episode_not_found', 404);
    return detail;
  }
  if (data.action === 'network-review') {
    await repo.review({ episodeId: data.episodeId, expectedRevision: data.expectedRevision, decision: data.decision, note: data.note ?? '' }, staffHash(identity.sub));
    return repo.getEpisode(data.episodeId);
  }
  if (data.action === 'network-jobs') return repo.listJobs(parameters);
  if (data.action === 'network-verification') {
    const verification = await repo.getVerification(data.id);
    if (!verification) fail('network_verification_not_found', 404);
    return verification;
  }
  if (data.action === 'network-evaluations') return repo.listEvaluations(parameters);
  const evaluation = await repo.getEvaluation(data.id);
  if (!evaluation) fail('network_evaluation_not_found', 404);
  return evaluation;
}

export async function closeNetworkAdminPools() {
  const existing = [...pools.values()];
  pools.clear();
  await Promise.all(existing.map(entry => entry.pool.end()));
}

import { createHash } from 'node:crypto';
import { createObservedSessionCore } from '../research/decisions/local-call/session.mjs';
import { voiceControlSession } from './voice-control.mjs';
import { createDecisionsDiagnosticWriter } from './decisions-diagnostics.mjs';

export async function assertDecisionsReady(database, env) {
  if (env.ORIGEN_DECISIONS_SUPPORT !== 'true') return;
  if (!database) throw Error('decisions_database_required');
  const row = (await database.query(`SELECT to_regclass('origen_decisions_events') IS NOT NULL AS present,
    has_table_privilege(current_user,'origen_decisions_events','SELECT,INSERT') AS permitted`)).rows[0];
  if (!row?.present || !row.permitted) throw Error('decisions_diagnostics_migration_and_grants_required');
}

// Configured by the server once, never by a browser/tool parameter. The normal
// authenticated control-session registry still validates every context update.
export function createProductionDecisionsFactory({ env, database, dependencies = {} }) {
  if (env.ORIGEN_DECISIONS_SUPPORT !== 'true') return undefined;
  if (!database || !env.OPENAI_API_KEY || env.ORIGEN_LIVE_SERVER_CONTROL !== 'true'
    || env.ORIGEN_BACKGROUND_RESEARCH !== 'true') throw Error('decisions_support_dependencies_required');
  let active = 0;
  return options => {
    if (!options.subject || !options.scope?.sessionId || !['en','es'].includes(options.config?.language) || active >= 4)
      return voiceControlSession(options);
    let engine;
    const diagnostics = createDecisionsDiagnosticWriter(database, { subject: options.subject, sessionId: options.scope.sessionId,
      release: env.RENDER_GIT_COMMIT || env.APPLICATION_REVISION || null,
      onGap: reason => engine?.observation.disable('diagnostic_' + reason) });
    try {
      const studentId = options.scope.studentId ?? 'unselected';
      engine = createObservedSessionCore(options, {
        production: true, paid: true, apiKey: env.OPENAI_API_KEY,
        seed: { productionSession: true, fictional: false, dataKind: 'production',
          accountId: createHash('sha256').update(options.subject).digest('hex'),
          callId: options.scope.sessionId, studentId, language: options.config.language, role: 'unknown' },
        allowedStudentIds: [studentId], supportEnabled: true, preferencesEnabled: true,
        conversationEnabled: true, earlyEnabled: true, lateEnabled: false,
      }, { ...dependencies, onDiagnostic: diagnostics.record });
      active++;
      diagnostics.record({ type: 'production_decisions_enabled', contextSent: false, playbackClaim: false });
      void engine.observation.closed.then(async () => { active--; await diagnostics.close(); });
      return engine;
    } catch {
      diagnostics.record({ type: 'production_decisions_unavailable', contextSent: false, playbackClaim: false });
      void diagnostics.close(); return voiceControlSession(options);
    }
  };
}

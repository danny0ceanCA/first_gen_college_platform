import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const calibrationDirectory = fileURLToPath(new URL('./.local/calibration/', import.meta.url));
export const pricing = Object.freeze({ model: 'gpt-6-luna', inputPerMillion: 0.10, outputPerMillion: 0.50,
  checkedAt: '2026-11-05', source: 'https://developers.openai.com/api/docs/models/gpt-6-luna', tier: 'standard' });
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(value);
const micros = dollars => Math.ceil(dollars * 1_000_000);

export function localCalibrationPath(path) {
  mkdirSync(calibrationDirectory, { recursive: true });
  const parent = fileURLToPath(new URL('./.local/', import.meta.url));
  if (lstatSync(parent).isSymbolicLink() || lstatSync(calibrationDirectory).isSymbolicLink()) fail('local_calibration_path_required');
  const root = realpathSync(calibrationDirectory), target = resolve(path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('local_calibration_path_required');
  mkdirSync(dirname(target), { recursive: true });
  const actualParent = relative(root, realpathSync(dirname(target)));
  if (actualParent.startsWith('..') || isAbsolute(actualParent) || existsSync(target) && lstatSync(target).isSymbolicLink()) fail('local_calibration_path_required');
  return target;
}

export function reserveEstimate(request) {
  if (request.model !== pricing.model || request.tools || request.service_tier !== 'default'
      || !Number.isSafeInteger(request.max_output_tokens) || request.max_output_tokens < 256 || request.max_output_tokens > 6000) fail('unsupported_budget_request');
  // UTF-8 byte count is a conservative bound on text tokens; include schema and
  // envelope overhead. No tools, audio, long context pricing, or priority tier.
  const inputBound = Buffer.byteLength(JSON.stringify(request), 'utf8') + 4096;
  if (inputBound > 100000) fail('calibration_input_too_large');
  return { inputBound, outputBound: request.max_output_tokens,
    reservedMicros: Math.ceil(inputBound * pricing.inputPerMillion + request.max_output_tokens * pricing.outputPerMillion) };
}

export function openCalibrationBudget({ path, budgetId, capUsd }) {
  if (!validId(budgetId) || !Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 100) fail('invalid_calibration_budget');
  const db = new DatabaseSync(path === ':memory:' ? path : localCalibrationPath(path));
  db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, cap INTEGER NOT NULL, pricing TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budgets(id),
      reserved INTEGER NOT NULL, charged INTEGER NOT NULL, state TEXT NOT NULL, diagnostic TEXT);`);
  function transaction(work) { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  try { transaction(() => {
    const old = db.prepare('SELECT * FROM budgets WHERE id=?').get(budgetId);
    if (old && (old.cap !== micros(capUsd) || old.pricing !== JSON.stringify(pricing))) fail('budget_configuration_changed');
    db.prepare('INSERT OR IGNORE INTO budgets VALUES(?,?,?)').run(budgetId, micros(capUsd), JSON.stringify(pricing));
  }); } catch (error) { db.close(); throw error; }
  function summary() {
    const rows = db.prepare('SELECT * FROM calls WHERE budget_id=?').all(budgetId);
    const charged = rows.reduce((sum, row) => sum + row.charged, 0);
    return { budgetId, capUsd, accountedUsd: charged / 1_000_000,
      remainingUsd: Math.max(0, micros(capUsd) - charged) / 1_000_000,
      calls: rows.length, unresolvedCalls: rows.filter(row => row.state !== 'settled').length,
      pricing, accounting: 'Confirmed usage where available; full reservation retained when usage or completion is uncertain.' };
  }
  return {
    reserve(callId, request) {
      if (!validId(callId)) fail('invalid_calibration_call_id');
      const estimate = reserveEstimate(request);
      return transaction(() => {
        if (db.prepare('SELECT id FROM calls WHERE id=?').get(callId)) fail('calibration_call_already_reserved');
        const used = db.prepare('SELECT COALESCE(SUM(charged),0) AS total FROM calls WHERE budget_id=?').get(budgetId).total;
        if (used + estimate.reservedMicros > micros(capUsd)) fail('calibration_budget_exhausted');
        db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,NULL)').run(callId, budgetId, estimate.reservedMicros, estimate.reservedMicros, 'reserved');
        return estimate;
      });
    },
    settle(callId, diagnostic) {
      return transaction(() => {
        const row = db.prepare('SELECT * FROM calls WHERE id=? AND budget_id=?').get(callId, budgetId);
        if (!row) fail('unknown_calibration_reservation');
        if (row.state === 'settled') fail('calibration_call_already_settled');
        const usage = diagnostic.usage;
        const known = diagnostic.sent === false || usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
          && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0;
        const actual = diagnostic.sent === false ? 0 : known ? Math.ceil(usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) : row.reserved;
        const state = known ? 'settled' : 'uncertain';
        // Only metering metadata is kept here, never source text or provider errors.
        const safe = { sent: diagnostic.sent === true, outcome: diagnostic.outcome === 'completed' ? 'completed' : 'failed',
          usage: known && diagnostic.sent !== false ? usage : null };
        db.prepare('UPDATE calls SET charged=?,state=?,diagnostic=? WHERE id=?').run(actual, state, JSON.stringify(safe), callId);
        return { chargedUsd: actual / 1_000_000, usageConfirmed: Boolean(known), exceededReservation: actual > row.reserved };
      });
    }, summary, close: () => db.close(),
  };
}

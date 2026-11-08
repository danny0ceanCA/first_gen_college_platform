// Durable laboratory accounting only; never opens an application database.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const UNITS_PER_USD = 1_000_000_000;
const INPUT_TOKEN_UNITS = 100; // $0.10 / 1M input tokens; output tokens have no charge.
const METADATA_KEYS = new Set(['runId', 'caseId', 'fixtureId', 'policyVersion', 'snapshotHash', 'language', 'sessionId', 'callId', 'revision', 'inputRevision', 'taskRevision']);
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const usd = (units) => units / UNITS_PER_USD;

export class DecisionsBudgetError extends Error {
  constructor(code, message) { super(message); this.name = 'DecisionsBudgetError'; this.code = code; }
}
const fail = (code, message) => { throw new DecisionsBudgetError(code, message); };

function money(value, name) {
  const units = Math.round(value * UNITS_PER_USD);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(units) || units < 1
    || Math.abs(units / UNITS_PER_USD - value) > 1e-12) fail('invalid_config', `${name} must be positive exact nanodollars.`);
  return units;
}

function metadataJson(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(metadata))) fail('invalid_metadata', 'Metadata must contain safe identifiers only.');
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEYS.has(key) || !(safeId(value) || integer(value))) fail('invalid_metadata', 'Metadata must contain approved identifiers only.');
  }
  return JSON.stringify(metadata);
}

function usageAccounting(usage) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const total = usage?.total_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens;
  const written = usage?.input_tokens_details?.cache_write_tokens;
  const reasoning = usage?.output_tokens_details?.reasoning_tokens;
  if (![input, output, total, cached, written, reasoning].every(integer)
    || total !== input + output || cached + written > input || reasoning > output) {
    fail('invalid_usage', 'Missing or inconsistent provider token usage; reservation remains held.');
  }
  // Cache writes have separate prices. The lab disables all caching, so never
  // guess a settlement when the provider reports unexpected cache activity.
  if (cached !== 0 || written !== 0) fail('invalid_usage', 'Unexpected cached usage; reservation remains held.');
  const units = input * INPUT_TOKEN_UNITS;
  if (!Number.isSafeInteger(units)) fail('invalid_usage', 'Usage is outside supported accounting bounds.');
  return { units, json: JSON.stringify({ input_tokens: input, output_tokens: output, total_tokens: total,
    input_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
    output_tokens_details: { reasoning_tokens: reasoning } }) };
}

export function createBudgetLedger({ path, capUsd = 5, reservationUsd = 0.05, maxRequests = 60 } = {}) {
  if (typeof path !== 'string' || !path.trim() || path === ':memory:' || /^[\\/]{2}/.test(path)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^(?:file|postgres|postgresql|sqlite):/i.test(path)) {
    fail('invalid_path', 'An explicit local SQLite file path is required.');
  }
  const capUnits = money(capUsd, 'capUsd');
  const reservationUnits = money(reservationUsd, 'reservationUsd');
  if (reservationUnits > capUnits || !Number.isSafeInteger(maxRequests) || maxRequests < 1) fail('invalid_config', 'Invalid reservation or request limit.');
  const filename = resolve(path);
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  let closed = false;
  const transaction = (fn) => {
    if (closed) fail('closed', 'Budget ledger is closed.');
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    if (names.some((name) => !['decisions_budget_config', 'decisions_budget_reservations'].includes(name))) {
      fail('invalid_path', 'This is not an isolated Decisions budget database.');
    }
    transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS decisions_budget_config (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL,
        cap_units INTEGER NOT NULL, reservation_units INTEGER NOT NULL, max_requests INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions_budget_reservations (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
        reserved_units INTEGER NOT NULL, actual_units INTEGER, metadata_json TEXT NOT NULL,
        usage_json TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );`);
      const config = db.prepare('SELECT * FROM decisions_budget_config WHERE singleton=1').get();
      if (config) {
        if (config.version !== 1 || config.cap_units !== capUnits || config.reservation_units !== reservationUnits || config.max_requests !== maxRequests) {
          fail('config_mismatch', 'Existing ledger limits are immutable; reopening cannot reset or increase them.');
        }
      } else {
        if (db.prepare('SELECT COUNT(*) AS count FROM decisions_budget_reservations').get().count) fail('invalid_ledger', 'Ledger configuration is missing.');
        db.prepare('INSERT INTO decisions_budget_config VALUES (1,1,?,?,?,?)').run(capUnits, reservationUnits, maxRequests, new Date().toISOString());
      }
    });
    db.exec('PRAGMA journal_mode = WAL');
  } catch (error) { db.close(); throw error; }

  const totals = () => db.prepare(`SELECT COUNT(*) AS request_count,
    COALESCE(SUM(CASE WHEN status='settled' THEN actual_units ELSE 0 END),0) AS spent_units,
    COALESCE(SUM(CASE WHEN status!='settled' THEN reserved_units ELSE 0 END),0) AS reserved_units,
    COALESCE(SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END),0) AS unknown_count
    FROM decisions_budget_reservations`).get();
  const get = (id) => {
    if (!safeId(id)) fail('invalid_reservation', 'Invalid reservation identifier.');
    const row = db.prepare('SELECT * FROM decisions_budget_reservations WHERE id=?').get(id);
    if (!row) fail('unknown_reservation', 'Reservation not found.');
    return row;
  };
  const costs = (row) => ({ id: row.id, costUsd: usd(row.actual_units), inputCostUsd: usd(row.actual_units), outputCostUsd: 0,
    reservedUsd: usd(row.reserved_units), exceededReservation: row.actual_units > row.reserved_units });
  const markUnknown = (id, reason = 'unknown') => transaction(() => {
    if (!safeId(reason)) fail('invalid_reason', 'Use a short diagnostic reason code.');
    const row = get(id);
    if (row.status === 'settled') fail('already_settled', 'Settled usage cannot be replaced with an unknown outcome.');
    db.prepare("UPDATE decisions_budget_reservations SET status='unknown',reason=?,updated_at=? WHERE id=?").run(reason, new Date().toISOString(), id);
  });
  return {
    reserve({ operationId, metadata } = {}) {
      if (!safeId(operationId)) fail('invalid_operation', 'A unique safe operation identifier is required.');
      const serializedMetadata = metadataJson(metadata);
      return transaction(() => {
        if (db.prepare('SELECT id FROM decisions_budget_reservations WHERE operation_id=?').get(operationId)) fail('operation_exists', 'This operation already has a reservation.');
        const current = totals();
        if (current.request_count >= maxRequests || current.spent_units + current.reserved_units + reservationUnits > capUnits) {
          fail('budget_exhausted', 'The durable request or spending cap is exhausted.');
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare("INSERT INTO decisions_budget_reservations VALUES (?,?,'reserved',?,NULL,?,NULL,NULL,?,?)")
          .run(id, operationId, reservationUnits, serializedMetadata, now, now);
        return { id };
      });
    },
    settle(id, usage) {
      let accounting;
      try { accounting = usageAccounting(usage); } catch (error) {
        markUnknown(id, 'invalid_usage');
        throw error;
      }
      return transaction(() => {
        const row = get(id);
        if (row.status === 'settled') {
          if (row.usage_json !== accounting.json) fail('usage_conflict', 'Settled usage cannot be changed.');
          return costs(row);
        }
        db.prepare("UPDATE decisions_budget_reservations SET status='settled',actual_units=?,usage_json=?,reason=NULL,updated_at=? WHERE id=?")
          .run(accounting.units, accounting.json, new Date().toISOString(), id);
        return costs(get(id));
      });
    },
    markUnknown,
    summary() {
      if (closed) fail('closed', 'Budget ledger is closed.');
      const current = totals();
      const remaining = capUnits - current.spent_units - current.reserved_units;
      return { capUsd, reservationUsd, maxRequests, requestCount: current.request_count,
        spentUsd: usd(current.spent_units), reservedUsd: usd(current.reserved_units),
        availableUsd: usd(Math.max(0, remaining)), overspentUsd: usd(Math.max(0, -remaining)), unknownCount: current.unknown_count };
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}

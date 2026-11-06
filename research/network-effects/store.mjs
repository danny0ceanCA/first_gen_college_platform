import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, existsSync, lstatSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSource, validateExtraction } from './contracts.mjs';
import { validateVerificationAudit, verificationContextHash, supportedVerificationVersions } from './verification-contracts.mjs';
import { latestState, episodeProcessingHolds, processingHoldWarning, mixedStateWarning,
  correctionCoverageIndex, episodeCorrectionCoverageHolds, correctionCoverageWarning } from './projection-state.mjs';

export const localDirectory = fileURLToPath(new URL('./.local/', import.meta.url));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const itemId = (source, key) => `${source.id}@${source.version}#${key}`;
const episodeId = (source, key) => digest([source.accountId, source.studentId, key]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const evidenceTime = item => item.occurredAt || item.recordedAt;
const invalidationTable = `CREATE TABLE IF NOT EXISTS invalidations (
  source_id TEXT NOT NULL, episode_id TEXT NOT NULL, kind TEXT NOT NULL,
  source_version INTEGER NOT NULL, reported_by TEXT NOT NULL, evidence_at TEXT,
  PRIMARY KEY(source_id, episode_id, kind, reported_by)
)`;

function databasePath(path) {
  if (path === ':memory:') return path;
  const target = resolve(path);
  mkdirSync(localDirectory, { recursive: true });
  if (lstatSync(localDirectory).isSymbolicLink()) fail('local_database_path_required');
  const root = realpathSync(localDirectory);
  const within = relative(root, target);
  if (!within || within.startsWith('..') || isAbsolute(within)) fail('local_database_path_required');
  mkdirSync(dirname(target), { recursive: true });
  const parent = relative(root, realpathSync(dirname(target)));
  if (parent.startsWith('..') || isAbsolute(parent)) fail('local_database_path_required');
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) fail('local_database_path_required');
  return target;
}

/** This database has no imports, credentials, or connections to the application database. */
export function openStore({ path = resolve(localDirectory, 'review.sqlite'), clock = () => Date.now() } = {}) {
  const db = new DatabaseSync(databasePath(path));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL, account_id TEXT NOT NULL,
      student_id TEXT, body TEXT NOT NULL, fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_versions (
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (source_id, version)
    );
    CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS processing_gaps (
      source_id TEXT PRIMARY KEY, source_version INTEGER NOT NULL, account_id TEXT NOT NULL,
      student_id TEXT, reporter TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      source_version INTEGER NOT NULL, extractor_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','obsolete')),
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT, lease_token TEXT, lease_until INTEGER,
      available_at INTEGER NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
      duration_ms INTEGER, result_hash TEXT, UNIQUE(source_id, source_version, extractor_version)
    );
    CREATE TABLE IF NOT EXISTS verification_audits (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      lease_token TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0),
      audit TEXT NOT NULL, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(job_id, lease_token), UNIQUE(job_id, attempt)
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      source_version INTEGER NOT NULL, episode_id TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, revision TEXT NOT NULL,
      decision TEXT NOT NULL, note TEXT NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supersessions (target_id TEXT PRIMARY KEY, correction_id TEXT NOT NULL);
    ${invalidationTable};
    CREATE INDEX IF NOT EXISTS jobs_available ON jobs(status, available_at);
    CREATE INDEX IF NOT EXISTS items_episode ON items(episode_id);
    CREATE INDEX IF NOT EXISTS sources_scope ON sources(account_id, student_id);
    CREATE INDEX IF NOT EXISTS processing_gaps_scope ON processing_gaps(account_id, student_id);
    CREATE INDEX IF NOT EXISTS items_source ON items(source_id);
    CREATE INDEX IF NOT EXISTS reviews_episode ON reviews(episode_id);
  `);
  // Upgrade only this isolated local database. Older removed evidence without surviving
  // provenance remains uncertain rather than being silently cleared by a new report.
  if (!db.prepare('PRAGMA table_info(invalidations)').all().some(column => column.name === 'reported_by')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const legacy = db.prepare('SELECT * FROM invalidations').all();
      db.exec('ALTER TABLE invalidations RENAME TO legacy_invalidations');
      db.exec(invalidationTable);
      for (const row of legacy) {
        const entries = db.prepare('SELECT body FROM items WHERE source_id=? AND episode_id=?').all(row.source_id, row.episode_id)
          .map(item => JSON.parse(item.body)).filter(item => item.kind === row.kind);
        if (entries.length) for (const item of entries) retainInvalidation(row.episode_id, item);
        else db.prepare('INSERT INTO invalidations VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.source_id, row.episode_id, row.kind, 0, 'unknown', null);
      }
      db.exec('DROP TABLE legacy_invalidations; COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec('CREATE INDEX IF NOT EXISTS invalidations_episode ON invalidations(episode_id)');
  const now = () => new Date(clock()).toISOString();
  let transactionDepth = 0;
  const transaction = fn => {
    if (transactionDepth) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { transactionDepth -= 1; }
  };
  const source = id => {
    const row = db.prepare('SELECT body FROM sources WHERE id = ?').get(id);
    return row ? JSON.parse(row.body) : null;
  };
  function ingest(raw, extractorVersion = 'synthetic-v1') {
    const input = validateSource(raw);
    if (typeof extractorVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(extractorVersion)) fail('invalid_extractor_version');
    return transaction(() => {
      if (db.prepare('SELECT id FROM tombstones WHERE id = ?').get(input.id)) fail('source_deleted');
      const old = source(input.id);
      if (old && (old.accountId !== input.accountId || old.studentId !== input.studentId || old.reporter !== input.reporter || old.kind !== input.kind)) fail('source_scope_changed');
      if (old && input.version < old.version) fail('stale_source_version');
      if (old && input.version === old.version && digest(input) !== digest(old)) fail('source_version_conflict');
      // A replay is not a request to replace a newer extraction generation.
      const existingJob = db.prepare('SELECT * FROM jobs WHERE source_id=? AND source_version=? AND extractor_version=?')
        .get(input.id, input.version, extractorVersion);
      if (existingJob) return presentJob(existingJob);
      if (old && input.version > old.version) invalidateSource(input.id);
      db.prepare(`INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET version=excluded.version, body=excluded.body, fingerprint=excluded.fingerprint`)
        .run(input.id, input.version, input.accountId, input.studentId, JSON.stringify(input), digest(input));
      db.prepare('INSERT OR IGNORE INTO source_versions VALUES (?, ?, ?)').run(input.id, input.version, JSON.stringify(input));
      db.prepare("UPDATE jobs SET status='obsolete', lease_token=NULL WHERE source_id=? AND source_version < ? AND status IN ('queued','running','failed')")
        .run(input.id, input.version);
      db.prepare("UPDATE jobs SET status='obsolete', lease_token=NULL WHERE source_id=? AND source_version=? AND extractor_version<>? AND status IN ('queued','running','failed')")
        .run(input.id, input.version, extractorVersion);
      db.prepare(`INSERT OR IGNORE INTO jobs
        (id, source_id, source_version, extractor_version, status, available_at, created_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?)`).run(randomUUID(), input.id, input.version, extractorVersion, clock(), now());
      return presentJob(db.prepare('SELECT * FROM jobs WHERE source_id=? AND source_version=? AND extractor_version=?').get(input.id, input.version, extractorVersion));
    });
  }
  function claim({ leaseMs = 60000, maxAttempts = 3, jobId = null } = {}) {
    return transaction(() => {
      db.prepare(`UPDATE jobs SET status=CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
        error='lease_expired', lease_token=NULL, lease_until=NULL
        WHERE status='running' AND lease_until <= ?`).run(maxAttempts, clock());
      const row = db.prepare(`SELECT * FROM jobs WHERE status='queued' AND available_at <= ?
        AND (? IS NULL OR id = ?) ORDER BY created_at, rowid LIMIT 1`).get(clock(), jobId, jobId);
      if (!row) return null;
      const token = randomUUID();
      db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, lease_token=?, lease_until=? WHERE id=?")
        .run(token, clock() + leaseMs, row.id);
      return { ...presentJob({ ...row, attempts: row.attempts + 1, status: 'running' }), token, source: source(row.source_id) };
    });
  }
  function currentLease(job) {
    const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
    if (!row || row.status !== 'running' || row.lease_token !== job.token || row.lease_until <= clock()) fail('stale_job_lease');
    const input = source(row.source_id);
    if (!input || input.version !== row.source_version) fail('stale_source_version');
    return input;
  }
  function contextFor(input) {
    const episodes = state({ accountId: input.accountId, studentId: input.studentId }).episodes;
    return { episodes, existingItems: episodes.flatMap(e => e.items.filter(i => i.state === 'current')) };
  }
  const presentVerification = row => ({ attempt: row.attempt, recordedAt: row.recorded_at,
    updatedAt: row.updated_at, audit: JSON.parse(row.audit) });
  function recordVerification(job, raw) {
    return transaction(() => {
      const input = currentLease(job);
      const audit = validateVerificationAudit(raw, input, contextFor(input));
      const jobVersion = db.prepare('SELECT extractor_version FROM jobs WHERE id=?').get(job.id).extractor_version;
      if (supportedVerificationVersions.indexOf(audit.version) < supportedVerificationVersions.indexOf(jobVersion)) fail('verification_audit_conflict');
      const prior = db.prepare('SELECT * FROM verification_audits WHERE job_id=? AND lease_token=?').get(job.id, job.token);
      if (prior) {
        const previous = JSON.parse(prior.audit);
        if (digest(previous) === digest(audit)) return presentVerification(prior);
        if (previous.decision !== 'pending' || audit.decision === 'pending'
            || previous.version !== audit.version || previous.schemaVersion !== audit.schemaVersion
            || digest(previous.initial) !== digest(audit.initial) || previous.contextHash !== audit.contextHash
            || digest(previous.reasons) !== digest(audit.reasons)
            || audit.steps.length < previous.steps.length
            || previous.steps.some((step, index) => digest(step) !== digest(audit.steps[index]))) fail('verification_audit_conflict');
        db.prepare('UPDATE verification_audits SET audit=?, updated_at=? WHERE job_id=? AND lease_token=?')
          .run(JSON.stringify(audit), now(), job.id, job.token);
      } else {
        if (!['pending', 'skipped'].includes(audit.decision)) fail('verification_required');
        const attempt = db.prepare('SELECT COALESCE(max(attempt),0)+1 AS next FROM verification_audits WHERE job_id=?').get(job.id).next;
        const timestamp = now();
        db.prepare('INSERT INTO verification_audits VALUES (?, ?, ?, ?, ?, ?)')
          .run(job.id, job.token, attempt, JSON.stringify(audit), timestamp, timestamp);
      }
      return presentVerification(db.prepare('SELECT * FROM verification_audits WHERE job_id=? AND lease_token=?').get(job.id, job.token));
    });
  }
  function getVerification(id) {
    return transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
      if (!job) fail('job_not_found');
      const original = db.prepare('SELECT body FROM source_versions WHERE source_id=? AND version=?').get(job.source_id, job.source_version);
      return { job: presentJob(job), source: original ? JSON.parse(original.body) : null,
        attempts: db.prepare('SELECT * FROM verification_audits WHERE job_id=? ORDER BY attempt').all(id).map(presentVerification) };
    });
  }
  function complete(job, raw, durationMs = 0) {
    return transaction(() => {
      const input = currentLease(job);
      const context = contextFor(input);
      const extraction = validateExtraction(raw, input, context);
      const verified = db.prepare('SELECT audit FROM verification_audits WHERE job_id=? AND lease_token=?').get(job.id, job.token);
      if (!verified && (supportedVerificationVersions.includes(db.prepare('SELECT extractor_version FROM jobs WHERE id=?').get(job.id).extractor_version)
        || db.prepare('SELECT 1 FROM verification_audits WHERE job_id=? LIMIT 1').get(job.id))) fail('verification_required');
      if (verified) {
        const audit = JSON.parse(verified.audit);
        if (!['kept', 'revised', 'skipped'].includes(audit.decision)) fail('verification_required');
        if (audit.contextHash !== verificationContextHash(input, context)) fail('verification_context_changed');
        if (digest(audit.final) !== digest(extraction)) fail('verification_candidate_mismatch');
      }
      const localIds = new Map(extraction.items.map(item => [item.key, itemId(input, item.key)]));
      const known = new Map(context.existingItems.map(item => [item.id, item]));
      const normalized = extraction.items.map(item => ({
        ...item, id: itemId(input, item.key), sourceId: input.id, sourceVersion: input.version,
        accountId: input.accountId, studentId: input.studentId,
        recordedAt: input.recordedAt, basis: input.kind, extractorVersion: job.extractorVersion,
        linksTo: localIds.get(item.linksTo) || item.linksTo,
        corrects: localIds.get(item.corrects) || item.corrects,
      }));
      for (const item of normalized) known.set(item.id, item);
      for (const item of normalized) {
        for (const field of ['linksTo', 'corrects']) {
          if (!item[field]) continue;
          const target = known.get(item[field]);
          if (!target || target.id === item.id || target.episodeKey !== item.episodeKey || target.accountId !== input.accountId || target.studentId !== input.studentId) fail('invalid_evidence_link');
          if (field === 'corrects' && (target.kind !== item.kind || target.reportedBy !== item.reportedBy)) fail('invalid_correction');
        }
      }
      // A cycle cannot supply a meaningful independent evidence trail.
      for (const item of normalized) {
        const seen = new Set([item.id]);
        let next = item.corrects;
        while (next) {
          if (seen.has(next)) fail('cyclic_correction');
          seen.add(next);
          next = known.get(next)?.corrects;
        }
      }
      db.prepare('DELETE FROM items WHERE source_id=? AND source_version=?').run(input.id, input.version);
      for (const item of normalized) {
        const id = episodeId(input, item.episodeKey);
        db.prepare('INSERT INTO items VALUES (?, ?, ?, ?, ?)')
          .run(item.id, input.id, input.version, id, JSON.stringify(item));
        if (item.corrects) db.prepare('INSERT OR IGNORE INTO supersessions VALUES (?, ?)').run(item.corrects, item.id);
        db.prepare('DELETE FROM invalidations WHERE source_id=? AND episode_id=? AND kind=? AND reported_by=? AND source_version < ?')
          .run(input.id, id, item.kind, item.reportedBy, input.version);
      }
      db.prepare("UPDATE jobs SET status='completed', completed_at=?, duration_ms=?, result_hash=?, error=NULL, lease_token=NULL, lease_until=NULL WHERE id=?")
        .run(now(), Math.max(0, Math.round(durationMs)), digest(extraction), job.id);
      return normalized.length;
    });
  }
  function failure(job, error, { maxAttempts = 3, retryDelayMs = 1000 } = {}) {
    return transaction(() => {
      currentLease(job);
      // Only enumerated diagnostic codes are retained. Provider messages can contain private text.
      const allowed = ['provider_timeout', 'provider_failed', 'provider_refused', 'provider_incomplete', 'invalid_extraction', 'unsupported_demo_source',
        'invalid_verification', 'invalid_verification_issue', 'invalid_verification_step', 'invalid_verification_decision',
        'verification_audit_conflict', 'verification_required', 'verification_context_changed', 'verification_candidate_mismatch',
        'verification_needs_review', 'verification_failed'];
      const code = allowed.includes(error?.code) ? error.code : 'extraction_failed';
      const terminal = job.attempts >= maxAttempts;
      db.prepare('UPDATE jobs SET status=?, error=?, available_at=?, lease_token=NULL, lease_until=NULL WHERE id=?')
        .run(terminal ? 'failed' : 'queued', code, clock() + retryDelayMs * job.attempts, job.id);
      return terminal ? 'failed' : 'queued';
    });
  }
  function retry(id) {
    const result = db.prepare("UPDATE jobs SET status='queued', attempts=0, error=NULL, available_at=? WHERE id=? AND status='failed'").run(clock(), id);
    if (!result.changes) fail('job_not_retryable');
  }
  function state(scope = null) {
    // Build extraction context from this family/student's indexed rows only.
    // Reading the entire review workbench for every source grows quadratically.
    const parameters = scope ? [scope.accountId, scope.studentId] : [];
    const sourceFilter = scope ? ' WHERE account_id=? AND student_id IS ?' : '';
    const sourceIds = `SELECT id FROM sources${sourceFilter}`;
    const itemFilter = scope ? ` WHERE source_id IN (${sourceIds})` : '';
    const scopedItemIds = `SELECT id FROM items${itemFilter}`;
    const sources = db.prepare(`SELECT body FROM sources${sourceFilter} ORDER BY id`).all(...parameters).map(row => JSON.parse(row.body));
    const processingGaps = db.prepare(`SELECT * FROM processing_gaps${sourceFilter} ORDER BY source_id`).all(...parameters)
      .map(row => ({ id: row.source_id, version: row.source_version, accountId: row.account_id, studentId: row.student_id,
        reporter: row.reporter, recordedAt: row.recorded_at }));
    const jobs = db.prepare(`SELECT * FROM jobs${itemFilter} ORDER BY created_at, rowid`).all(...parameters).map(presentJob);
    const versions = new Map(sources.map(s => [s.id, s.version]));
    const items = db.prepare(`SELECT * FROM items${itemFilter} ORDER BY rowid`).all(...parameters).map(row => ({ ...JSON.parse(row.body), episodeId: row.episode_id }));
    const retainedIds = new Set(items.map(item => item.id));
    const active = items.filter(item => versions.get(item.sourceId) === item.sourceVersion);
    const supersessions = db.prepare(`SELECT target_id,correction_id FROM supersessions${scope ? ` WHERE target_id IN (${scopedItemIds})` : ''}`).all(...parameters);
    const corrected = new Set(supersessions.map(row => row.target_id));
    const correctionCoverage = correctionCoverageIndex(items, supersessions);
    const activeIds = new Set(active.filter(item => !corrected.has(item.id)).map(item => item.id));
    const reviews = db.prepare(`SELECT * FROM reviews${scope ? ` WHERE episode_id IN (SELECT episode_id FROM items${itemFilter})` : ''} ORDER BY rowid`).all(...parameters).map(row => ({
      id: row.id, episodeId: row.episode_id, revision: row.revision, decision: row.decision, note: row.note, recordedAt: row.recorded_at,
    }));
    const grouped = new Map();
    for (const item of items) {
      const displayed = { ...item, state: activeIds.has(item.id) ? 'current' : 'superseded',
        linkState: item.linksTo && !activeIds.has(item.linksTo)
          && !(item.linksTo === item.corrects && retainedIds.has(item.corrects)) ? 'unresolved' : 'supported' };
      const group = grouped.get(item.episodeId) || [];
      group.push(displayed);
      grouped.set(item.episodeId, group);
    }
    const episodes = [...grouped].map(([id, entries]) => {
      entries.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
      const current = entries.filter(item => item.state === 'current');
      const first = entries[0];
      const invalidations = db.prepare('SELECT * FROM invalidations WHERE episode_id=? ORDER BY source_id,kind,reported_by').all(id)
        .filter(invalidation => !current.some(item => item.sourceId !== invalidation.source_id
          && item.kind === invalidation.kind && item.reportedBy === invalidation.reported_by
          && invalidation.evidence_at && evidenceTime(item) > invalidation.evidence_at));
      const invalidatedKinds = new Set(invalidations.map(row => row.kind));
      const processingHolds = episodeProcessingHolds(entries, sources, jobs, processingGaps);
      const correctionCoverageHolds = episodeCorrectionCoverageHolds(current, correctionCoverage);
      const processingUnresolved = processingHolds.length > 0 || invalidatedKinds.has('unprocessed-source');
      const revision = digest({ entries, invalidations, processingHolds, correctionCoverageHolds });
      const latestReview = reviews.filter(review => review.episodeId === id).at(-1);
      const uncertainLinks = current.some(item => item.linkState === 'unresolved');
      const questionState = processingUnresolved || invalidatedKinds.has('question') ? 'unknown' : latestState(current, 'question') || 'unknown';
      const actionState = processingUnresolved || invalidatedKinds.has('action') ? 'unknown' : latestState(current, 'action');
      const outcomeState = processingUnresolved || correctionCoverageHolds.length > 0 || invalidatedKinds.has('outcome') ? 'unknown' : latestState(current, 'outcome');
      const mixed = [questionState, actionState, outcomeState].includes('mixed');
      const uncertain = uncertainLinks || [questionState, actionState, outcomeState].includes('conflicting') || invalidations.length > 0 || processingUnresolved || correctionCoverageHolds.length > 0;
      const reviewState = uncertain ? 'needs-review' : latestReview?.revision === revision ? latestReview.decision : 'unreviewed';
      return {
        id, revision, accountId: first.accountId, studentId: first.studentId, episodeKey: first.episodeKey,
        topic: current.at(-1)?.topic || first.topic,
        barriers: [...new Set(current.map(item => item.barrier).filter(Boolean))],
        questionState, actionState, outcomeState,
        reviewState, analysisEligible: !uncertain && reviewState !== 'needs-review', processingHolds, correctionCoverageHolds,
        evidenceWarnings: [...(invalidations.length ? ['Earlier source evidence changed or was removed. Review this concern before drawing conclusions.'] : []),
          ...(processingUnresolved ? [processingHoldWarning] : []), ...(mixed ? [mixedStateWarning] : []),
          ...(correctionCoverageHolds.length ? [correctionCoverageWarning] : [])],
        items: entries,
      };
    });
    return {
      mode: 'isolated-local', sources, episodes, jobs, reviews,
      sourceHistory: db.prepare(`SELECT body FROM source_versions${itemFilter} ORDER BY source_id,version`).all(...parameters).map(row => JSON.parse(row.body)),
      metrics: { sources: sources.length, episodes: episodes.length, items: activeIds.size,
        pending: episodes.filter(e => e.outcomeState === 'pending' || ['open', 'partial'].includes(e.questionState)).length,
        failedJobs: jobs.filter(job => job.status === 'failed').length },
    };
  }
  function review({ episodeId: id, expectedRevision, decision, note = '' }) {
    if (!['reviewed', 'needs-review'].includes(decision) || typeof note !== 'string' || note.length > 2000) fail('invalid_review');
    return transaction(() => {
      const episode = state().episodes.find(row => row.id === id);
      if (!episode || episode.revision !== expectedRevision) fail('stale_review');
      db.prepare('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, expectedRevision, decision, note.trim(), now());
      return state();
    });
  }
  function invalidateSource(id) {
    for (const row of db.prepare('SELECT episode_id,body FROM items WHERE source_id=?').all(id)) {
      const item = JSON.parse(row.body);
      retainInvalidation(row.episode_id, item);
    }
  }
  function retainInvalidation(id, item) {
    db.prepare(`INSERT INTO invalidations VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id,episode_id,kind,reported_by) DO UPDATE SET
      source_version=MAX(source_version,excluded.source_version),
      evidence_at=CASE WHEN evidence_at IS NULL THEN NULL ELSE MAX(evidence_at,excluded.evidence_at) END`)
      .run(item.sourceId, id, item.kind, item.sourceVersion, item.reportedBy, evidenceTime(item));
  }
  function deleteSource(id) {
    return transaction(() => {
      // Clear review prose on all affected episodes, including linked observations.
      const input = source(id);
      const snapshot = input ? state({ accountId: input.accountId, studentId: input.studentId }) : { episodes: [] };
      // This scoped content-free marker also protects older records imported
      // after deletion, when no concern existed at the time of deletion.
      if (input && snapshot.jobs.some(job => job.sourceId === id && job.sourceVersion === input.version
        && ['queued', 'running', 'failed'].includes(job.status))) {
        db.prepare('INSERT OR IGNORE INTO processing_gaps VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, input.version, input.accountId, input.studentId, input.reporter, input.recordedAt);
      }
      invalidateSource(id);
      // Deleting an unread/failed correction must not revive an older positive
      // result. Retain only a content-free tombstone; source text is still erased.
      for (const episode of snapshot.episodes) if (episode.processingHolds.some(hold => hold.sourceId === id)) {
        retainInvalidation(episode.id, { sourceId: id, sourceVersion: input.version, kind: 'unprocessed-source',
          reportedBy: input.reporter, occurredAt: null, recordedAt: null });
      }
      const removed = new Set(snapshot.episodes.flatMap(e => e.items).filter(i => i.sourceId === id).map(i => i.id));
      for (const episode of snapshot.episodes) if (episode.processingHolds.some(hold => hold.sourceId === id) || episode.items.some(i => i.sourceId === id || removed.has(i.linksTo) || removed.has(i.corrects)))
        db.prepare('DELETE FROM reviews WHERE episode_id=?').run(episode.id);
      db.prepare('INSERT OR IGNORE INTO tombstones VALUES (?, ?)').run(id, now());
      db.prepare('DELETE FROM sources WHERE id=?').run(id);
    });
  }
  function importRecords(records) {
    if (!Array.isArray(records) || records.length > 1000) fail('invalid_import');
    return transaction(() => {
      for (const record of records) {
        if (!record || Object.keys(record).length !== 2 || !record.source || !record.extraction) fail('invalid_import');
        const queued = ingest(record.source, 'local-snapshot-v1');
        if (queued.status === 'completed') {
          const receipt = db.prepare('SELECT result_hash FROM jobs WHERE id=?').get(queued.id);
          if (receipt.result_hash !== digest(record.extraction)) fail('extraction_version_conflict');
          continue;
        }
        const job = claim({ jobId: queued.id });
        if (!job) fail('import_job_unavailable');
        complete(job, record.extraction);
      }
      return state().metrics;
    });
  }
  return { ingest, claim, complete, failure, retry, state, review, source, contextFor, deleteSource, importRecords,
    recordVerification, getVerification, close: () => db.close() };
}

function presentJob(row) {
  return { id: row.id, sourceId: row.source_id, sourceVersion: row.source_version,
    extractorVersion: row.extractor_version, status: row.status, attempts: row.attempts, error: row.error,
    createdAt: row.created_at, completedAt: row.completed_at, durationMs: row.duration_ms };
}

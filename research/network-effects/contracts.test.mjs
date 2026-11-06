import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtraction, validateSource, validLanguage, statusesByKind, extractionSchemaForSource,
  extractionProviderSchemaForSource, decodeProviderExtraction } from './contracts.mjs';
import { demoSources, demoExtraction } from './fixtures.mjs';

const firstSource = () => demoSources()[0];
const firstExtraction = () => demoExtraction(firstSource());
const errorCode = code => error => error.code === code;

test('phase 1 — fictional cases validate across languages, topics, family scopes and corrections', () => {
  const existingItems = [];
  const topics = new Set();
  for (const source of demoSources()) {
    validateSource(source);
    const extraction = validateExtraction(demoExtraction(source), source, { existingItems });
    for (const item of extraction.items) {
      topics.add(item.topic);
      existingItems.push({ ...item, id: `${source.id}@${source.version}#${item.key}`,
        accountId: source.accountId, studentId: source.studentId, state: 'current' });
    }
  }
  assert.equal(topics.size, 9);
  assert.ok(demoSources().some(source => source.studentId === null));
  assert.ok(demoSources().some(source => source.language === 'mixed'));
});

test('phase 1 — source identity and metadata are explicit, bounded, and never supplied by extraction', () => {
  for (const change of [{ accountId: '' }, { studentId: 4 }, { id: '../outside' }, { version: 0 },
    { text: '' }, { text: 'a'.repeat(32001) }, { synthetic: 'true' }, { reporter: 'assistant' },
    { recordedAt: '2026-02-30T10:00:00.000Z' }, { language: 'not_a_language' }]) {
    assert.throws(() => validateSource({ ...firstSource(), ...change }));
  }
  assert.throws(() => validateSource({ ...firstSource(), databaseUrl: 'forbidden' }), errorCode('invalid_source_fields'));
  assert.throws(() => validateExtraction({ ...firstExtraction(), accountId: 'someone-else' }, firstSource()), errorCode('invalid_extraction_fields'));
  const source = firstSource();
  const copy = validateSource(source);
  copy.accountId = 'mutated';
  assert.notEqual(copy.accountId, source.accountId);
});

test('phase 1 — exact source evidence is required and summary basis remains explicit', () => {
  const extraction = firstExtraction();
  extraction.items[0].quote = 'Invented words that the student never said.';
  assert.throws(() => validateExtraction(extraction, firstSource()), errorCode('unsupported_item_evidence'));
  assert.equal(validateSource(firstSource()).kind, 'summary');
});

test('phase 1 — parent, family, and unknown speakers cannot become the student', () => {
  for (const reporter of ['parent', 'family', 'unknown']) {
    const source = { ...firstSource(), reporter };
    assert.throws(() => validateExtraction(firstExtraction(), source), errorCode('invalid_item_attribution'));
    const extraction = firstExtraction();
    extraction.items.forEach(item => { item.reportedBy = 'unknown'; });
    assert.doesNotThrow(() => validateExtraction(extraction, source));
  }
});

test('phase 1 — kinds keep understanding, intention, completion and result distinct', () => {
  const extraction = firstExtraction();
  extraction.items[0].status = 'completed';
  assert.throws(() => validateExtraction(extraction, firstSource()), errorCode('invalid_item_classification'));
  assert.ok(!statusesByKind.understanding.includes('completed'));
  assert.ok(!statusesByKind.action.includes('positive'));
  assert.ok(statusesByKind.outcome.includes('pending'));
  assert.ok(statusesByKind.outcome.includes('unknown'));
});

test('phase 1 — optional dates remain unknown and cannot be after source observation', () => {
  assert.equal(validateExtraction(firstExtraction(), firstSource()).items[0].occurredAt, null);
  const extraction = firstExtraction();
  extraction.items[0].occurredAt = '2026-11-06T10:00:00.000Z';
  assert.throws(() => validateExtraction(extraction, firstSource()), errorCode('invalid_item_date'));
});

test('phase 1 — duplicate item keys, extra fields, and oversized extraction are rejected', () => {
  const extraction = firstExtraction();
  extraction.items[1].key = extraction.items[0].key;
  assert.throws(() => validateExtraction(extraction, firstSource()), errorCode('invalid_item_key'));
  const extra = firstExtraction();
  extra.items[0].verified = true;
  assert.throws(() => validateExtraction(extra, firstSource()), errorCode('invalid_item_fields'));
  assert.throws(() => validateExtraction({ schemaVersion: 1, items: Array(31).fill(firstExtraction().items[0]) }, firstSource()), errorCode('invalid_extraction'));
  assert.deepEqual(validateExtraction({ schemaVersion: 1, items: [] }, firstSource()).items, []);
});

test('phase 1 — prior references require current same-scope evidence', () => {
  const source = firstSource();
  const extraction = firstExtraction();
  extraction.items[0].linksTo = 'prior@1#item-1';
  const target = { id: 'prior@1#item-1', accountId: source.accountId, studentId: source.studentId,
    episodeKey: extraction.items[0].episodeKey, kind: 'question', reportedBy: 'student', state: 'current' };
  assert.doesNotThrow(() => validateExtraction(extraction, source, { existingItems: [target] }));
  for (const change of [{ accountId: 'another-family' }, { studentId: 'sibling' }, { studentId: null }]) {
    assert.throws(() => validateExtraction(extraction, source, { existingItems: [{ ...target, ...change }] }), errorCode('cross_scope_reference'));
  }
  assert.throws(() => validateExtraction(extraction, source, { existingItems: [{ ...target, state: 'superseded' }] }), errorCode('stale_item_reference'));
  assert.throws(() => validateExtraction(extraction, source), errorCode('unknown_item_reference'));
});

test('phase 1 — corrections target the same kind and reporter in the same episode', () => {
  const source = firstSource();
  const extraction = firstExtraction();
  extraction.items[0].corrects = 'prior@1#item-1';
  const target = { id: 'prior@1#item-1', accountId: source.accountId, studentId: source.studentId,
    episodeKey: extraction.items[0].episodeKey, kind: 'question', reportedBy: 'student', state: 'current' };
  assert.doesNotThrow(() => validateExtraction(extraction, source, { existingItems: [target] }));
  for (const change of [{ kind: 'action' }, { reportedBy: 'parent' }]) {
    assert.throws(() => validateExtraction(extraction, source, { existingItems: [{ ...target, ...change }] }), errorCode('invalid_correction_target'));
  }
  assert.throws(() => validateExtraction(extraction, source, { existingItems: [{ ...target, episodeKey: 'other-question' }] }), errorCode('invalid_item_relationship'));
});

test('phase 1 — language support includes regional tags and uncertain source language', () => {
  for (const language of ['en', 'es', 'es-MX', 'zh-Hant', 'fr', 'nah', 'qu', 'mixed', 'und']) assert.equal(validLanguage(language), true);
  for (const language of ['', null, 4, 'es_mx', 'English', 'english', 'Spanish', 'spanish', 'es-mx', 'EN']) assert.equal(validLanguage(language), false);
});

test('metadata — saving time and date-only phrases cannot become event instants', () => {
  const source = firstSource();
  const extraction = firstExtraction();
  extraction.items[0].occurredAt = source.recordedAt;
  assert.throws(() => validateExtraction(extraction, source), errorCode('unsupported_item_date'));
  for (const phrase of ['I sent it yesterday.', 'Lo envié el 2026-10-15.']) {
    const dated = { ...source, text: phrase };
    const candidate = { schemaVersion: 1, items: [{ ...extraction.items[0], quote: phrase,
      statement: phrase, occurredAt: '2026-10-15T00:00:00.000Z' }] };
    assert.throws(() => validateExtraction(candidate, dated), errorCode('unsupported_item_date'));
    candidate.items[0].occurredAt = null;
    assert.equal(validateExtraction(candidate, dated).items[0].statement, phrase);
  }
});

test('metadata — an explicit valid instant is usable only with its own supporting quote', () => {
  const timestamp = '2026-10-15T09:30:00.000Z';
  const text = `I submitted the form at ${timestamp}. I still do not understand housing.`;
  const source = { ...firstSource(), text };
  const item = { ...firstExtraction().items[0], kind: 'action', status: 'completed',
    quote: `I submitted the form at ${timestamp}.`, statement: 'Submitted the form.', occurredAt: timestamp };
  assert.equal(validateExtraction({ schemaVersion: 1, items: [item] }, source).items[0].occurredAt, timestamp);
  assert.throws(() => validateExtraction({ schemaVersion: 1, items: [{ ...item,
    quote: 'I still do not understand housing.' }] }, source), errorCode('unsupported_item_date'));
});

test('metadata — source language remains canonical across mixed-language observations', () => {
  const source = { ...firstSource(), language: 'mixed' };
  for (const language of ['Spanish', 'English', 'en', 'es']) {
    const candidate = firstExtraction();
    candidate.items.forEach(item => { item.language = language; });
    assert.throws(() => validateExtraction(candidate, source), errorCode('invalid_item_language'));
  }
  const candidate = firstExtraction();
  candidate.items.forEach(item => { item.language = 'mixed'; });
  assert.equal(validateExtraction(candidate, source).items[0].language, 'mixed');
});

test('metadata — provider schema permits only grounded instants and canonical source metadata', () => {
  const plainBranches = extractionSchemaForSource(firstSource()).properties.items.items.anyOf;
  for (const { properties } of plainBranches) {
    assert.deepEqual(properties.occurredAt.enum, [null]);
    assert.deepEqual(properties.language.enum, ['en']);
  }
  const timestamp = '2026-10-15T09:30:00.000Z';
  const source = { ...firstSource(), language: 'mixed',
    text: `${timestamp} / 2026-02-30T09:30:00.000Z / 2099-01-01T00:00:00.000Z` };
  for (const { properties } of extractionSchemaForSource(source).properties.items.items.anyOf) {
    assert.deepEqual(properties.occurredAt.enum, [null, timestamp]);
    assert.deepEqual(properties.language.enum, ['mixed']);
    const keyPattern = new RegExp(properties.key.pattern);
    assert.equal(keyPattern.test('local-item.1'), true);
    assert.equal(keyPattern.test('source@1#item'), false);
    assert.equal(keyPattern.test(''), false);
  }
});

test('classification — provider schema excludes cross-kind status combinations', () => {
  const schema = extractionSchemaForSource(firstSource());
  assert.equal(schema.type, 'object');
  assert.equal(schema.anyOf, undefined);
  const branches = schema.properties.items.items.anyOf;
  const permitted = (kind, status) => branches.some(({ properties }) =>
    properties.kind.enum.includes(kind) && properties.status.enum.includes(status));
  for (const [kind, status] of [['action', 'exploring'], ['understanding', 'completed'],
    ['question', 'positive'], ['guidance', 'pending']]) assert.equal(permitted(kind, status), false);
  for (const [kind, status] of [['preference', 'exploring'], ['action', 'attempted'],
    ['outcome', 'mixed'], ['understanding', 'uncertain']]) assert.equal(permitted(kind, status), true);
  for (const branch of branches) {
    assert.equal(branch.type, 'object');
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual([...branch.required].sort(), Object.keys(branch.properties).sort());
  }
  const candidate = firstExtraction();
  candidate.items[0].kind = 'action'; candidate.items[0].status = 'exploring';
  assert.throws(() => validateExtraction(candidate, firstSource()), errorCode('invalid_item_classification'));
});

test('classification — lean provider schema represents every legal pair without duplicating item objects', () => {
  const source = firstSource();
  const schema = extractionProviderSchemaForSource(source);
  const itemSchema = schema.properties.items.items;
  const properties = itemSchema.properties;
  assert.equal(itemSchema.anyOf, undefined);
  assert.equal(properties.kind, undefined); assert.equal(properties.status, undefined);
  assert.equal(itemSchema.additionalProperties, false);
  assert.deepEqual([...itemSchema.required].sort(), Object.keys(properties).sort());
  for (const [kind, statuses] of Object.entries(statusesByKind)) {
    for (const status of statuses) assert.ok(properties.classification.enum.includes(`${kind}:${status}`));
  }
  assert.equal(properties.classification.enum.includes('action:exploring'), false);
  assert.deepEqual(properties.occurredAt.enum, [null]);
  assert.deepEqual(properties.language.enum, [source.language]);
  assert.ok(JSON.stringify(schema).length < JSON.stringify(extractionSchemaForSource(source)).length / 2);
});

test('classification — wire decoding preserves canonical evidence and rejects ambiguous shapes', () => {
  const canonical = firstExtraction();
  const wire = { ...canonical, items: canonical.items.map(({ kind, status, ...item }) =>
    ({ ...item, classification: `${kind}:${status}` })) };
  assert.deepEqual(decodeProviderExtraction(wire), canonical);
  assert.deepEqual(decodeProviderExtraction({ schemaVersion: 1, items: [] }), { schemaVersion: 1, items: [] });
  assert.throws(() => decodeProviderExtraction(canonical), errorCode('invalid_provider_item_fields'));
  const ambiguous = structuredClone(wire); ambiguous.items[0].kind = 'question';
  assert.throws(() => decodeProviderExtraction(ambiguous), errorCode('invalid_provider_item_fields'));
  for (const classification of ['action:exploring', 'outcome:positive:extra', null, '__proto__']) {
    const invalid = structuredClone(wire); invalid.items[0].classification = classification;
    assert.throws(() => decodeProviderExtraction(invalid), errorCode('invalid_item_classification'));
  }
});

test('phase 1 — synthetic fixtures cannot extract changed or arbitrary user text', () => {
  assert.throws(() => demoExtraction({ ...firstSource(), text: 'Unrecognized new account text.' }), errorCode('unsupported_demo_source'));
  assert.throws(() => demoExtraction({ ...firstSource(), synthetic: false }), errorCode('unsupported_demo_source'));
});

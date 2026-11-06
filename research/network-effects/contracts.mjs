// Offline learning contracts. These records are observations for review, never live instructions.
export const reporters = Object.freeze(['student', 'parent', 'family', 'coordinator', 'unknown']);
export const sourceKinds = Object.freeze(['summary', 'transcript', 'note', 'coordinator']);
export const topicLabels = Object.freeze({
  college_basics: 'Understanding college',
  paths: 'Exploring college paths',
  applications: 'Applying to college',
  costs: 'Understanding costs and aid',
  enrollment: 'Getting ready to enroll',
  family_support: 'Family questions and expectations',
  practical_needs: 'Work, time, and transportation',
  finding_help: 'Finding and asking for help',
  other: 'Other college navigation',
});
export const statusesByKind = Object.freeze({
  question: Object.freeze(['open', 'partial', 'resolved', 'unknown']),
  guidance: Object.freeze(['offered']),
  understanding: Object.freeze(['reported', 'uncertain']),
  action: Object.freeze(['intended', 'attempted', 'completed', 'declined', 'postponed']),
  outcome: Object.freeze(['pending', 'positive', 'unsuccessful', 'mixed', 'unknown']),
  preference: Object.freeze(['exploring', 'stated', 'changed']),
});
export const kinds = Object.freeze(Object.keys(statusesByKind));
export const statusLabels = Object.freeze({
  open: 'Open question', partial: 'Partly answered', resolved: 'Reported resolved',
  unknown: 'Unknown', offered: 'Guidance recorded', reported: 'Understanding reported',
  uncertain: 'Understanding uncertain', intended: 'Plans to act', attempted: 'Attempt reported',
  completed: 'Completion reported', declined: 'Declined', postponed: 'Postponed',
  pending: 'Still pending', positive: 'Positive result reported', unsuccessful: 'Unsuccessful result reported',
  mixed: 'Mixed result reported', exploring: 'Still exploring', stated: 'Stated preference', changed: 'Preference changed',
});

const sourceFields = ['id', 'version', 'accountId', 'studentId', 'reporter', 'language', 'kind', 'recordedAt', 'text', 'synthetic'];
const itemFields = ['key', 'episodeKey', 'topic', 'barrier', 'kind', 'status', 'statement', 'quote', 'reportedBy', 'language', 'occurredAt', 'linksTo', 'corrects'];
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function exactObject(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length
      || fields.some(field => !Object.hasOwn(value, field))) reject(code);
}

function boundedText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function identifier(value) {
  return typeof value === 'string' && identifierPattern.test(value);
}

export function validLanguage(value) {
  if (value === 'mixed' || value === 'und') return true;
  // Intl accepts reserved 5–8 letter language subtags, including "English".
  // This workspace uses canonical ISO 639-style tags, not language names.
  if (typeof value !== 'string' || value.length > 35 || !/^[a-z]{2,3}(?:-|$)/.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function instant(value) {
  return typeof value === 'string' && instantPattern.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function validateSource(source) {
  exactObject(source, sourceFields, 'invalid_source_fields');
  if (!identifier(source.id) || !identifier(source.accountId)
      || (source.studentId !== null && !identifier(source.studentId))) reject('invalid_source_identity');
  if (!Number.isSafeInteger(source.version) || source.version < 1) reject('invalid_source_version');
  if (!reporters.includes(source.reporter) || !sourceKinds.includes(source.kind)) reject('invalid_source_attribution');
  if (!validLanguage(source.language)) reject('invalid_source_language');
  if (!instant(source.recordedAt)) reject('invalid_source_date');
  if (!boundedText(source.text, 32000)) reject('invalid_source_text');
  if (typeof source.synthetic !== 'boolean') reject('invalid_source_synthetic');
  return structuredClone(source);
}

function validateReference(reference, item, source, localItems, existingItems, correction) {
  if (reference === null) return;
  if (!boundedText(reference, 350)) reject('invalid_item_reference');
  const local = localItems.get(reference);
  const target = local || existingItems.find(candidate => candidate.id === reference);
  if (!target) reject('unknown_item_reference');
  if ((local && target.key === item.key) || target.episodeKey !== item.episodeKey) reject('invalid_item_relationship');
  if (!local && (target.accountId !== source.accountId || target.studentId !== source.studentId)) reject('cross_scope_reference');
  if (!local && target.state && target.state !== 'current') reject('stale_item_reference');
  if (correction && (target.kind !== item.kind || target.reportedBy !== item.reportedBy)) reject('invalid_correction_target');
}

export function validateExtraction(extraction, rawSource, context = {}) {
  const source = validateSource(rawSource);
  exactObject(extraction, ['schemaVersion', 'items'], 'invalid_extraction_fields');
  if (extraction.schemaVersion !== 1 || !Array.isArray(extraction.items) || extraction.items.length > 30) reject('invalid_extraction');
  const localItems = new Map();
  for (const item of extraction.items) {
    exactObject(item, itemFields, 'invalid_item_fields');
    if (!identifier(item.key) || !identifier(item.episodeKey) || localItems.has(item.key)) reject('invalid_item_key');
    if (!Object.hasOwn(topicLabels, item.topic) || !Object.hasOwn(statusesByKind, item.kind)
        || !statusesByKind[item.kind].includes(item.status)) reject('invalid_item_classification');
    if (item.barrier !== null && !boundedText(item.barrier, 400)) reject('invalid_item_barrier');
    if (!boundedText(item.statement, 1200) || !boundedText(item.quote, 2000)
        || !source.text.includes(item.quote)) reject('unsupported_item_evidence');
    if (!reporters.includes(item.reportedBy)
        || (item.reportedBy !== 'unknown' && item.reportedBy !== source.reporter)) reject('invalid_item_attribution');
    if (!validLanguage(item.language) || item.language !== source.language) reject('invalid_item_language');
    if (item.occurredAt !== null && (!instant(item.occurredAt) || item.occurredAt > source.recordedAt)) reject('invalid_item_date');
    // Do not convert a save time, a relative phrase, or a calendar date into a
    // precise event instant. Less precise timing remains in statement/quote.
    if (item.occurredAt !== null && !item.quote.includes(item.occurredAt)) reject('unsupported_item_date');
    localItems.set(item.key, item);
  }
  const existingItems = context.existingItems ?? [];
  if (!Array.isArray(existingItems) || existingItems.length > 2000) reject('invalid_extraction_context');
  for (const item of extraction.items) {
    validateReference(item.linksTo, item, source, localItems, existingItems, false);
    validateReference(item.corrects, item, source, localItems, existingItems, true);
  }
  // A correction cannot itself be corrected in the same batch. That would make
  // replay order affect which observation is current.
  const corrected = new Set();
  for (const item of extraction.items) {
    if (item.corrects === null) continue;
    if (corrected.has(item.corrects) || localItems.get(item.corrects)?.corrects) reject('ambiguous_correction');
    corrected.add(item.corrects);
  }
  return structuredClone(extraction);
}

const nullableText = { type: ['string', 'null'] };
const itemProperties = {
  key: { type: 'string', pattern: identifierPattern.source },
  episodeKey: { type: 'string', pattern: identifierPattern.source },
  topic: { type: 'string', enum: Object.keys(topicLabels) }, barrier: nullableText,
  kind: { type: 'string', enum: kinds },
  status: { type: 'string', enum: [...new Set(Object.values(statusesByKind).flat())] },
  statement: { type: 'string' }, quote: { type: 'string' },
  reportedBy: { type: 'string', enum: reporters }, language: { type: 'string' },
  occurredAt: { type: ['string', 'null'], pattern: instantPattern.source }, linksTo: nullableText, corrects: nullableText,
};

export const extractionSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    items: { type: 'array', maxItems: 30, items: {
      // Nested unions are supported by Structured Outputs. Pairing the fields
      // here prevents valid individual labels forming an invalid combination.
      anyOf: kinds.map(kind => ({
        type: 'object',
        properties: {
          ...itemProperties,
          kind: { type: 'string', enum: [kind] },
          status: { type: 'string', enum: statusesByKind[kind] },
        },
        required: itemFields,
        additionalProperties: false,
      })),
    } },
  },
  required: ['schemaVersion', 'items'],
  additionalProperties: false,
};

export function extractionSchemaForSource(rawSource) {
  const source = validateSource(rawSource);
  const schema = structuredClone(extractionSchema);
  const timestamps = [...new Set(source.text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g) ?? [])]
    .filter(value => instant(value) && value <= source.recordedAt);
  for (const branch of schema.properties.items.items.anyOf) {
    branch.properties.language = { type: 'string', enum: [source.language] };
    branch.properties.occurredAt = { type: ['string', 'null'], enum: [null, ...timestamps] };
  }
  return schema;
}

const classifications = Object.freeze(Object.entries(statusesByKind)
  .flatMap(([kind, statuses]) => statuses.map(status => `${kind}:${status}`)));
const providerItemFields = itemFields.filter(field => field !== 'kind' && field !== 'status');
providerItemFields.splice(providerItemFields.indexOf('statement'), 0, 'classification');

// The provider chooses a single legal classification. The public evidence
// contract retains kind/status; a deterministic adapter expands this wire value.
// This avoids repeating every observation field once per kind in the request.
export function extractionProviderSchemaForSource(rawSource) {
  const sourceSchema = extractionSchemaForSource(rawSource);
  const common = sourceSchema.properties.items.items.anyOf[0].properties;
  const properties = Object.fromEntries(providerItemFields.map(field => [field,
    field === 'classification' ? { type: 'string', enum: classifications } : common[field]]));
  sourceSchema.properties.items.items = {
    type: 'object', properties, required: providerItemFields, additionalProperties: false,
  };
  return sourceSchema;
}

export function decodeProviderExtraction(value) {
  exactObject(value, ['schemaVersion', 'items'], 'invalid_provider_extraction_fields');
  if (value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 30) reject('invalid_provider_extraction');
  const items = value.items.map(item => {
    exactObject(item, providerItemFields, 'invalid_provider_item_fields');
    if (!classifications.includes(item.classification)) reject('invalid_item_classification');
    const [kind, status] = item.classification.split(':');
    const { classification: _classification, ...rest } = item;
    return { ...rest, kind, status };
  });
  return structuredClone({ schemaVersion: 1, items });
}

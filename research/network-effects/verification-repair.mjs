import { extractionProviderSchemaForSource, decodeProviderExtraction, validateExtraction } from './contracts.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join() !== [...keys].sort().join()) fail('invalid_verification');
};
const fields = ['classification', 'statement', 'quote', 'reportedBy', 'linksTo', 'corrects'];
const typesForField = {
  classification: ['classification', 'unsupported_claim', 'attribution'],
  statement: ['unsupported_claim', 'attribution', 'classification'],
  quote: ['unsupported_claim', 'attribution', 'classification', 'omission'],
  reportedBy: ['attribution'], linksTo: ['relationship'], corrects: ['relationship', 'unsupported_claim'],
};

// Automatic prose-only rewrites do not establish a material evidence repair.
// Keep the proposed issue for review rather than publishing an unnecessary edit.
export function isProseOnlyRevision(initial, final) {
  if (initial.items.length !== final.items.length) return false;
  let changed = false;
  for (const previous of initial.items) {
    const item = final.items.find(value => value.key === previous.key);
    if (!item || Object.keys(previous).some(field => !['statement', 'quote'].includes(field)
        && item[field] !== previous[field])) return false;
    if (item.statement !== previous.statement || item.quote !== previous.quote) changed = true;
  }
  return changed;
}

export function repairSchema(source, initial, issueTypes) {
  const itemSchema = extractionProviderSchemaForSource(source).properties.items.items;
  // Missing obstacles are handled explicitly, never through regenerated prose.
  itemSchema.properties.barrier = { type: 'null' };
  const key = { type: 'string', enum: initial.items.length ? initial.items.map(item => item.key) : ['__no_existing_item__'] };
  const issueIndex = { type: 'integer', minimum: 0, maximum: 29 };
  const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
  return object({
    obstacles: { type: 'array', maxItems: 20, items: object({
      quote: { type: 'string' }, itemKey: { type: 'string' }, coverage: { type: 'string', enum: ['recorded', 'missing'] },
    }) },
    decision: { type: 'string', enum: ['keep', 'revise', 'needs_review'] },
    issues: { type: 'array', maxItems: 30, items: object({
      type: { type: 'string', enum: issueTypes }, quote: { type: 'string' }, detail: { type: 'string' },
      itemKey: { type: ['string', 'null'], enum: [null, ...initial.items.map(item => item.key)] },
    }) },
    edits: { type: 'array', maxItems: 60, items: object({ itemKey: key,
      field: { type: 'string', enum: fields }, value: { type: ['string', 'null'] }, issueIndex }) },
    additions: { type: 'array', maxItems: 10, items: object({ item: itemSchema, issueIndex }) },
  });
}

// Applied both at the adapter and at the v2 durable audit boundary. A revision
// cannot silently regenerate unrelated records or discard a reported obstacle.
export function validateMinimalRevision(initial, final, issues, source) {
  const oldKeys = new Set(initial.items.map(item => item.key));
  const supportedBarrier = (text, key) => {
    const quotes = issues.filter(issue => issue.type === 'barrier' && issue.itemKey === key
      && source.text.includes(issue.quote)).map(issue => issue.quote);
    const covers = remaining => quotes.some(quote => remaining === quote
      || remaining.startsWith(`${quote}; `) && covers(remaining.slice(quote.length + 2)));
    return typeof text === 'string' && text.length > 0 && covers(text);
  };
  for (const previous of initial.items) {
    const item = final.items.find(value => value.key === previous.key);
    if (!item || ['episodeKey', 'topic', 'language', 'occurredAt'].some(field => item[field] !== previous[field])) fail('invalid_verification_decision');
    if (previous.barrier !== null && item.barrier !== previous.barrier && !item.barrier?.startsWith(`${previous.barrier}; `)) fail('invalid_verification_decision');
    for (const field of ['kind', 'status', 'statement', 'quote', 'reportedBy', 'linksTo', 'corrects']) {
      if (item[field] === previous[field]) continue;
      const allowed = typesForField[['kind', 'status'].includes(field) ? 'classification' : field];
      if (!issues.some(issue => issue.itemKey === item.key && allowed.includes(issue.type))) fail('invalid_verification_decision');
    }
    if (item.statement !== previous.statement && !item.quote.includes(item.statement)) fail('invalid_verification_decision');
    if (item.barrier !== previous.barrier) {
      const extra = previous.barrier === null ? item.barrier : item.barrier?.slice(previous.barrier.length + 2);
      if (!supportedBarrier(extra, item.key)) fail('invalid_verification_decision');
    }
  }
  for (const item of final.items.filter(value => !oldKeys.has(value.key))) {
    if (item.statement !== item.quote || !issues.some(issue => issue.itemKey === null
        && issue.type === 'omission' && issue.quote === item.quote)) fail('invalid_verification_decision');
    if (item.barrier !== null && !supportedBarrier(item.barrier, null)) fail('invalid_verification_decision');
  }
  return final;
}

export function applyVerificationRepair(result, initial, source, context, validatedIssues) {
  exact(result, ['obstacles', 'decision', 'issues', 'edits', 'additions']);
  if (!['keep', 'revise', 'needs_review'].includes(result.decision)
      || !Array.isArray(result.edits) || result.edits.length > 60
      || !Array.isArray(result.additions) || result.additions.length > 10
      || !Array.isArray(result.obstacles) || result.obstacles.length > 20) fail('invalid_verification');
  if (result.decision === 'needs_review') {
    if (!Array.isArray(validatedIssues) || !validatedIssues.length) fail('invalid_verification_decision');
    // Issues have already passed source/evidence validation at the adapter.
    // A hold cannot apply any proposals, even if the model also supplied them.
    // Keep the bounded top-level contract above, discard every proposed change,
    // and retain only the validated findings for human review.
    return { decision: 'needs_review', final: null, issues: structuredClone(validatedIssues) };
  }
  const final = structuredClone(initial), issues = structuredClone(validatedIssues), touched = new Set(), referenced = new Set();
  const getIssue = (index, itemKey, allowed) => {
    if (!Number.isInteger(index) || index < 0 || index >= validatedIssues.length) fail('invalid_verification_issue');
    const issue = validatedIssues[index];
    if (issue.itemKey !== itemKey || !allowed.includes(issue.type)) fail('invalid_verification_issue');
    referenced.add(index); return issue;
  };
  for (const edit of result.edits) {
    exact(edit, ['itemKey', 'field', 'value', 'issueIndex']);
    const item = final.items.find(value => value.key === edit.itemKey);
    if (!item || !fields.includes(edit.field) || touched.has(`${edit.itemKey}:${edit.field}`)
        || (typeof edit.value !== 'string' && edit.value !== null)) fail('invalid_verification');
    getIssue(edit.issueIndex, edit.itemKey, typesForField[edit.field]);
    touched.add(`${edit.itemKey}:${edit.field}`);
    if (edit.field === 'classification') {
      if (typeof edit.value !== 'string' || edit.value.split(':').length !== 2) fail('invalid_verification');
      [item.kind, item.status] = edit.value.split(':');
    } else item[edit.field] = edit.value;
  }
  for (const addition of result.additions) {
    exact(addition, ['item', 'issueIndex']);
    const issue = getIssue(addition.issueIndex, null, ['omission']);
    const item = decodeProviderExtraction({ schemaVersion: 1, items: [addition.item] }).items[0];
    if (final.items.some(value => value.key === item.key) || item.barrier !== null || item.quote !== issue.quote
        || item.statement !== item.quote) fail('invalid_verification');
    final.items.push(item);
  }
  const obstacleKeys = new Set();
  for (const obstacle of result.obstacles) {
    exact(obstacle, ['quote', 'itemKey', 'coverage']);
    const item = final.items.find(value => value.key === obstacle.itemKey);
    if (!item || typeof obstacle.quote !== 'string' || !obstacle.quote.trim() || obstacle.quote.length > 400
        || !source.text.includes(obstacle.quote) || !['recorded', 'missing'].includes(obstacle.coverage)
        || obstacleKeys.has(`${obstacle.itemKey}:${obstacle.quote}`)) fail('invalid_verification_issue');
    obstacleKeys.add(`${obstacle.itemKey}:${obstacle.quote}`);
    if (obstacle.coverage === 'recorded') {
      if (!initial.items.find(value => value.key === obstacle.itemKey)?.barrier) fail('invalid_verification_issue');
    } else {
      if (item.barrier?.includes(obstacle.quote)) fail('invalid_verification_issue');
      item.barrier = item.barrier === null ? obstacle.quote : `${item.barrier}; ${obstacle.quote}`;
      issues.push({ type: 'barrier', quote: obstacle.quote, detail: 'An explicit obstacle was missing from the structured barrier field.',
        itemKey: initial.items.some(value => value.key === item.key) ? item.key : null });
    }
  }
  if (referenced.size !== validatedIssues.length) fail('invalid_verification_issue');
  validateExtraction(final, source, context);
  validateMinimalRevision(initial, final, issues, source);
  const changed = JSON.stringify(final) !== JSON.stringify(initial);
  if (result.decision === 'keep' && (changed || issues.length)
      || result.decision === 'revise' && (!changed || !issues.length)) fail('invalid_verification_decision');
  if (changed && isProseOnlyRevision(initial, final)) return { decision: 'needs_review', final: null, issues };
  return { decision: changed ? 'revised' : 'kept', final, issues };
}

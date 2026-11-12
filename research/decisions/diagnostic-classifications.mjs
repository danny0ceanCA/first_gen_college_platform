// A metadata-only view of known classifier contracts. Unknown question names,
// values, provider prose and private reasoning never enter diagnostic records.
import { SUPPORT_NEEDS } from './rubric.mjs';
import { BROAD_PREDICATES, BROAD_EVIDENCE_CHECKS } from './broad-rubric.mjs';
import { PREFERENCES, PREFERENCE_ACTIONS } from './preference-rubric.mjs';
import { CONFUSION_ACTIONS, CONTINUATION_ACTIONS } from './conversation-rubric.mjs';
import { EARLY_PREDICATES } from './local-call/early-rubric.mjs';

const predicates = new Set(['already_addressed', ...BROAD_PREDICATES, ...BROAD_EVIDENCE_CHECKS, ...EARLY_PREDICATES]);
const choices = new Map([
  ['support_need', SUPPORT_NEEDS], ['confusion_state', CONFUSION_ACTIONS], ['continuation_acceptance', CONTINUATION_ACTIONS],
  ...PREFERENCES.map(name => ['preference_' + name, PREFERENCE_ACTIONS]),
]);
export const DIAGNOSTIC_QUESTION_NAMES = Object.freeze([...new Set([...predicates, ...choices.keys()])]);
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function diagnosticClassifications(input) {
  if (!Array.isArray(input)) return { answers: [], omittedAnswers: 0 };
  const answers = [], seen = new Set();
  for (const answer of input.slice(0, 64)) {
    const name = answer?.name;
    if (!DIAGNOSTIC_QUESTION_NAMES.includes(name) || seen.has(name)) continue;
    if (answer.type === 'refusal') { answers.push({ name, type: 'refusal' }); seen.add(name); continue; }
    if (predicates.has(name) && answer.type === 'predicate' && probability(answer.probability)) {
      answers.push({ name, type: 'predicate', probability: answer.probability }); seen.add(name); continue;
    }
    const allowed = choices.get(name);
    if (!allowed || answer.type !== 'choice' || !allowed.includes(answer.choice) || !probability(answer.confidence)
      || !Array.isArray(answer.probabilities) || answer.probabilities.length !== allowed.length) continue;
    const distribution = new Map();
    for (const item of answer.probabilities) if (allowed.includes(item?.value) && probability(item.probability)
      && !distribution.has(item.value)) distribution.set(item.value, item.probability);
    if (distribution.size !== allowed.length || Math.abs([...distribution.values()].reduce((a, b) => a + b, 0) - 1) > .02) continue;
    answers.push({ name, type: 'choice', choice: answer.choice, confidence: answer.confidence,
      probabilities: allowed.map(value => ({ value, probability: distribution.get(value) })) }); seen.add(name);
  }
  return { answers, omittedAnswers: Math.max(0, input.length - answers.length) };
}

// Early predicates already retain their whole distribution (one probability).
// Legacy completed records retain fewer fields. Preserve exactly what exists;
// never manufacture a distribution from a selected label or confidence.
export function diagnosticResult(result = {}) {
  const value = {}, facts = {};
  if (SUPPORT_NEEDS.includes(result.supportNeed)) value.supportNeed = result.supportNeed;
  for (const key of ['confidence', 'selectedProbability', 'addressedProbability'])
    if (probability(result[key])) value[key] = result[key];
  if (typeof result.alreadyAddressed === 'boolean') value.alreadyAddressed = result.alreadyAddressed;
  for (const name of predicates) {
    const observed = result.facts?.[name] ?? result.predicates?.[name]?.probability ?? result.evidenceChecks?.[name]?.probability;
    if (probability(observed)) facts[name] = observed;
  }
  if (Object.keys(facts).length) value.facts = facts;
  const preferenceRows = Array.isArray(result.preferenceChanges) ? result.preferenceChanges
    : Object.entries(result.preferenceChanges ?? {}).map(([preference, row]) => ({ preference, ...row }));
  const preferenceChanges = [];
  for (const row of preferenceRows.slice(0, 8)) {
    if (!PREFERENCES.includes(row?.preference) || !PREFERENCE_ACTIONS.includes(row.action)
      || !probability(row.confidence) || !probability(row.selectedProbability)
      || preferenceChanges.some(item => item.preference === row.preference)) continue;
    preferenceChanges.push({ preference: row.preference, action: row.action,
      confidence: row.confidence, selectedProbability: row.selectedProbability });
  }
  if (preferenceChanges.length) value.preferenceChanges = preferenceChanges;
  const conversationSupport = {};
  for (const [name, allowed] of [['confusion', CONFUSION_ACTIONS], ['continuation', CONTINUATION_ACTIONS]]) {
    const row = result.conversationSupport?.[name];
    if (allowed.includes(row?.action) && probability(row.confidence) && probability(row.selectedProbability))
      conversationSupport[name] = { action: row.action, confidence: row.confidence, selectedProbability: row.selectedProbability };
  }
  if (Object.keys(conversationSupport).length) value.conversationSupport = conversationSupport;
  if (Array.isArray(result.refusedQuestions)) value.refusedQuestions = [...new Set(result.refusedQuestions.filter(name => predicates.has(name)))];
  return value;
}

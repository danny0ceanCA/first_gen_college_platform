// Shared text predicate only. A match is not consent, a completed provider turn,
// or permission to speak. Classification and application timing gates still apply.
export function affirmativeAcknowledgment(text) {
  if (typeof text !== 'string' || text.length > 120) return false;
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  return /^(?:(?:yes|yeah|yep|okay|ok|sure|absolutely|of course|all right|si|claro|vale|bien|por supuesto|de acuerdo)[\s,.!¡¿?]*)+(?:(?:please|por favor)[\s,.!¡¿?]*)?$/u.test(normalized);
}

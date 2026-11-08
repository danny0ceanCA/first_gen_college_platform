// This chooses which local support gate may consider a classification. It does
// not authorize context delivery, speech, research, or a business action.
export function conversationOwnsSupport(result) {
  const eligible = (value, action) => value?.action === action
    && Number.isFinite(value.confidence) && value.confidence >= 0.85 && value.confidence <= 1
    && Number.isFinite(value.selectedProbability) && value.selectedProbability >= 0.9 && value.selectedProbability <= 1;
  return eligible(result?.conversationSupport?.confusion, 'needs_simpler_explanation')
    || eligible(result?.conversationSupport?.continuation, 'accepted_conversational_offer');
}

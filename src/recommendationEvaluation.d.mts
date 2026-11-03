export const RECOMMENDATION_EVALUATION_PURPOSE:'recommendation_evaluation';
export const RECOMMENDATION_EVALUATION_VERSION:1;
export const recommendationEvaluationNotice:Readonly<Record<'en'|'es',string>>;
export function validateRecommendationEvaluation(raw:unknown,report?:boolean):Record<string,unknown>;

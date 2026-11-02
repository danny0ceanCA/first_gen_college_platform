export const OUTCOME_EVALUATION_PURPOSE:'service_quality';
export const OUTCOME_EVALUATION_VERSION:1;
export const evaluationNotice:Readonly<Record<'en'|'es',string>>;
export function validateEvaluationCommand(value:unknown,report?:boolean):Record<string,unknown>;

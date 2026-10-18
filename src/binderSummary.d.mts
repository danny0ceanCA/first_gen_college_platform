export type BinderSummaryBlock={type:'heading'|'paragraph'|'note';text:string};
export function binderSummaryPages(summary:string,language?:'en'|'es'):BinderSummaryBlock[][];

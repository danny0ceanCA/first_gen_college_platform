export type PublishedBudget={year:string;population:string;currency:'USD'|'CAD'|'EUR'|'GBP'|'MXN';period:'academic_year'|'calendar_year'|'semester'|'quarter'|'month';housing:'renting'|'with_family'|'on_campus'|'off_campus'|'unspecified';assumed:boolean;total:number|null;sourceCitation:string;complete:boolean;expectedCategories:string[];components:{key:string;sourceLabel:string;amount:number|null;role:'component'|'subtotal'|'excluded'|'additional'|'missing';qualification:string}[]};
export const budgetKeys:string[];
export const publishedBudgetSchema:Record<string,unknown>;
export const budgetLabels:{en:string[];es:string[]};
export function validatedBudget(value:unknown,sourceIds:Set<number>):PublishedBudget|null;
export function budgetAudit(budget:PublishedBudget):{missing:string[];sum:number;difference:number|null;complete:boolean};
export function remapBudget(budget:PublishedBudget|undefined,remap:(text:string)=>string):PublishedBudget|undefined;
export function budgetFinding(budget:PublishedBudget,qualification:string,language?:string):{answer:string;qualification:string;audit:ReturnType<typeof budgetAudit>};
export function budgetHeadline(budget:PublishedBudget,language?:string):string;

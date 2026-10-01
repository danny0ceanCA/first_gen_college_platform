export type StudentProfile = {id:string;name:string;stage:string;interest:string;gpa:string;color:string;institutions?:string;entryTerm?:string;school?:string;activities?:string;goals?:string;needs?:string;notes?:string};
export type PlanStep = {id:string;title:string;why:string;action:string;deadline?:string;source?:string;date:string;notes:string;status:'not-started'|'in-progress'|'complete'};
export type PlanDraft = Pick<PlanStep,'title'|'why'|'action'|'deadline'|'source'>;
export function loadLocal<T>(key:string,fallback:T):T {try {const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}}
export function saveLocal(key:string,value:unknown):boolean {try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}

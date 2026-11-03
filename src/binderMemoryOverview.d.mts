type Memory={id:string;studentId:string|null;category:string;content:string;language:string;status:string;speaker:string;reportedBy:string;updatedAt:string;organization?:{topic?:string;certainty?:string}};
export function memoryOverview<T extends Memory>(memories:T[]|undefined,options:{studentId:string|null;topic?:string}):{category:'goal'|'constraint'|'preference'|'question';count:number;highlights:T[]}[];
export function memoryExcerpt(content:string,maxLength?:number):{text:string;truncated:boolean};

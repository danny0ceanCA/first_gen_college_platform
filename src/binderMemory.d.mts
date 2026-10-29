export function binderMemoryEntries<T extends {id:string;studentId:string|null;status:string;organization?:{topic?:string}}>(memories:T[]|undefined,studentId:string|null,topic?:string):T[];
export function binderMemorySignalId(id:string):string;
export function binderMemoryReviewEntries<T extends {studentId:string|null;status:string}>(memories:T[]|undefined,studentId:string|null):T[];
export function binderMemorySummaryEntries<T extends {studentId:string|null;status:string;organization?:{topic?:string}}>(memories:T[]|undefined,studentId:string|null):T[];

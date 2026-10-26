export function binderMemoryEntries<T extends {id:string;studentId:string|null;status:string;organization?:{topic?:string}}>(memories:T[]|undefined,studentId:string|null,topic?:string):T[];
export function binderMemorySignalId(id:string):string;

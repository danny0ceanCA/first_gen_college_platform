export function legacyPlanBatches(value:unknown,studentId:string):{id:string;title:string;action:string;notes:string;status:'not-started'|'in-progress'|'complete';dueDate:string|null;sources:{title:string;url:string}[]}[][];
export function legacyCreationId(subject:string,studentId:string,steps:unknown[]):Promise<string>;

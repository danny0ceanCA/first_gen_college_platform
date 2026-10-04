export function summarySaveQueue():{add:(id:string,save:()=>Promise<void>)=>void;readonly size:number;flush:()=>Promise<void>};

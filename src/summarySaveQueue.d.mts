export function summarySaveQueue():{add:(id:string,save:(signal:AbortSignal)=>Promise<void>)=>void;remove:(id:string)=>void;clear:()=>void;readonly size:number;flush:()=>Promise<void>};

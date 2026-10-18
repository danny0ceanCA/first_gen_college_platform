export function notifyMemoryContext(subject:string,studentId:string|null):void;
export function subscribeMemoryContext(subject:string|undefined,callback:(studentId:string|null)=>void):()=>void;
export function watchMemoryRevision(options:{revision:number;read:(signal:AbortSignal)=>Promise<number>;onChange:()=>void;onUnavailable:()=>void;intervalMs?:number}):()=>void;

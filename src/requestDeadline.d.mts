export function withRequestDeadline<T>(operation:(signal:AbortSignal)=>Promise<T>,options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<T>;

export function flushPendingHistory<T extends {id:string;studentId:string|null}>(pending:Map<string,T>,studentIds:Set<string>,save:(item:T)=>Promise<unknown>):Promise<void>;

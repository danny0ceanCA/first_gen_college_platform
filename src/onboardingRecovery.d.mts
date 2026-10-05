export function onboardingRecovery(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,now?:()=>number):{read:<T>(fallback:T)=>T;write:(value:unknown)=>boolean;clear:()=>void};

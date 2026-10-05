export function onboardingRecovery(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,now?:()=>number):{read:<T>(fallback:T,valid?:(value:unknown)=>boolean)=>T;write:(value:unknown)=>boolean;clear:()=>void;removeEntry:(id:string)=>boolean};
export function validOnboardingDraft(value:unknown):boolean;

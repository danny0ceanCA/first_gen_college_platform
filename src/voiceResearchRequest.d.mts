export function voiceResearchRequest(options?:{signal?:AbortSignal;timeoutMs?:number}):{
 revision:()=>number;
 cancel:()=>void;
 run:<T>(operation:(signal:AbortSignal)=>Promise<T>,expectedRevision?:number)=>Promise<T>;
};

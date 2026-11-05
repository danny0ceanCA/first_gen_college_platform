type Result={preparedContextId?:string|null;expiresInMs?:number};
type Load=(signal:AbortSignal)=>Promise<Result|undefined>;
export function createVoicePreparation(options?:{now?:()=>number;ttlMs?:number;timeoutMs?:number}):{
 consumeReady:(subject:string,input:Record<string,unknown>)=>string|undefined;
 warm:(subject:string,input:Record<string,unknown>,load:Load)=>Promise<string|undefined>;
 consume:(subject:string,input:Record<string,unknown>,load:Load,signal?:AbortSignal)=>Promise<string|undefined>;
 clear:()=>void;
};

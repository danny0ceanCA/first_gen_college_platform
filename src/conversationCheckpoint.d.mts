export type CheckpointState='saving'|'protected'|'failed'|'pending'|'review'|'complete';
export function conversationCheckpoint(options:{post:(body:Record<string,unknown>)=>Promise<any>;epoch:number;contextRevision:number;onState?:(state:CheckpointState)=>void;delayMs?:number}):{update:(body:any)=>void;flush:()=>Promise<any>;finish:()=>Promise<any>;stop:()=>void;readonly id:string|undefined};

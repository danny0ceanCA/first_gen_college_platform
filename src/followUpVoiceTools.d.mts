type Evidence={sessionId:string;sequence:number;turnId:string;transcript:string};
type Result={status:string;[key:string]:unknown};
export function followUpVoiceTools(options:{post:(body:unknown,signal:AbortSignal)=>Promise<Result>;evidence:()=>Promise<Evidence|null>;sequence:()=>number;isCurrent?:()=>boolean;canHear?:()=>boolean;onSaved?:(result:Result)=>void|Promise<void>;onChanged?:()=>void;onWriting?:(writing:boolean)=>void;onUncertain?:()=>void;onResponseContext?:(guard:unknown)=>Promise<boolean>;signal?:AbortSignal;timeoutMs?:number;timeZone?:string}):{
 configure:(enabled:boolean,outcomeEnabled?:boolean)=>void;isTool:(name:string)=>boolean;settled:()=>Promise<void>;begin:()=>void;event:(event:Record<string,any>)=>void;spokenTurn:()=>Promise<Result|null>;invoke:(item:{name:string;call_id:string;arguments:string},sequence?:number)=>Promise<Result|null>;stop:()=>void;
};

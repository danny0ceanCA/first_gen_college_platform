type Result={status:string;revision?:number;kind?:string;id?:string;[key:string]:unknown};
type Session={id:string;revision:number};
export function isLiveMemoryTool(name:string):boolean;
export function voiceMemoryTools(options:{post:(body:unknown,signal:AbortSignal)=>Promise<Result>;isCurrent?:()=>boolean;canHear?:()=>boolean;onSaved?:(result:Result)=>void|Promise<void>;onConflict?:()=>void;onUncertain?:()=>void;onWriting?:(writing:boolean)=>void;beforeInvoke?:()=>Promise<boolean>;beforeRegister?:()=>Promise<void>;onResponseContext?:(guard:unknown)=>Promise<boolean>;signal?:AbortSignal;timeoutMs?:number}):{
 event:(event:Record<string,any>)=>void;isTool:(name:string)=>boolean;session:()=>Session|undefined;sequence:()=>number;evidence:()=>Promise<{sessionId:string;sequence:number;turnId:string;transcript:string}|null>;configure:(session:Session|undefined)=>void;begin:(id:string,language?:string)=>void;transcript:(id:string,text:string,language?:string)=>void;assistant:(text:string)=>void;invoke:(item:{name:string;call_id:string;arguments:string},sequence?:number)=>Promise<Result|null>;stop:()=>void;
};

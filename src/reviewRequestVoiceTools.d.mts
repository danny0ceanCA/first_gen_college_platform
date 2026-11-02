type Result={status:string;[key:string]:unknown};
export function reviewRequestVoiceTools(options:{post:(body:unknown,signal:AbortSignal)=>Promise<any>;isCurrent?:()=>boolean;canHear?:()=>boolean;onChanged?:()=>void;onUncertain?:()=>void;signal?:AbortSignal;timeoutMs?:number}):{
 isTool:(name:string)=>boolean;sequence:()=>number;configure:(value:{id:string}|undefined)=>void;begin:(id:string,language?:string)=>void;transcript:(id:string,text:string,language?:string)=>void;event:(event:Record<string,any>)=>void;invoke:(item:{name:string;call_id:string;arguments:string},sequence?:number)=>Promise<Result|null>;stop:()=>void;
};

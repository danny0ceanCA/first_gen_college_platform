export function voiceTurns(send:(event:unknown)=>void|string,onRecovery?:()=>void,options?:{schedule?:(callback:()=>void,delay:number)=>any;cancel?:(timer:any)=>void;transcriptionTimeout?:number;onMissing?:(itemId:string)=>void}): {
  request:()=>void;
  holdReply:()=>()=>void;
  busy:()=>boolean;
  speechStopped:(itemId:string)=>void;
  stop:()=>void;
  progress:(sentence:string)=>boolean;
  progressEvent:(event:any)=>boolean;
  created:()=>void;
  speechStarted:(itemId:string)=>void;
  beginDone:(responseId:string,hasTools?:boolean,cancelled?:boolean)=>boolean;
  toolsCompleted:()=>void;
  failed:(responseId?:string,retry?:boolean)=>boolean;
  recover:(code:string)=>boolean;
  completed:(continueTool?:boolean)=>void;
  transcript:(itemId:string,text:unknown)=>boolean;
};

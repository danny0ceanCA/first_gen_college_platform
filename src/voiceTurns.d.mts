export function voiceTurns(send:(event:unknown)=>void|string,onRecovery?:()=>void): {
  request:()=>void;
  progress:(sentence:string)=>boolean;
  progressEvent:(event:any)=>boolean;
  created:()=>void;
  speechStarted:(itemId:string)=>void;
  beginDone:(responseId:string,hasTools?:boolean,cancelled?:boolean)=>boolean;
  toolsCompleted:()=>void;
  recover:(code:string)=>boolean;
  completed:(continueTool?:boolean)=>void;
  transcript:(itemId:string,text:unknown)=>boolean;
};

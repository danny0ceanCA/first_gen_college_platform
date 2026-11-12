export const timingClassifierVersion:'preamble-v2';
export function answerKind(text:unknown,topic?:string,options?:{streaming?:boolean}):'unclassified'|'acknowledgment'|'incomplete_preamble'|'progress'|'answer_candidate';
export function parseContextTiming(header:string|null):Record<string,number>;
export function createVoiceTiming(options:{emit:(details:Record<string,unknown>)=>void;clock?:()=>number}):{
 event:(event:any)=>void;playback:()=>void;span:(stage:string)=> (outcome?:string,extra?:Record<string,unknown>)=>void;
 toolStart:(item:any,responseId:string)=>void;sent:(event:any)=>void;stop:()=>void;
};

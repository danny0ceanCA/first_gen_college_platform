export type RecapTopic='options'|'transfer'|'costs'|'applications';
export type TopicRecapData={paragraphs:{text:string;refs:string[]}[];sources:{ref:string;kind:'note'|'memory';id:string;content:string;evidence:{reportedBy:string;certainty:string;review:string}}[];omitted:number};
export type TopicRecapState={status:'queued'|'loading'|'error'|'ready';data?:TopicRecapData};
export type RecapTiming={event:string;topic:RecapTopic;mode:string;cache?:string;outcome?:string;queueMs?:number;durationMs?:number;totalMs?:number};
export type RecapConfiguration={scope:string;ready:boolean;topics:{topic:RecapTopic;revision:string}[];priority:RecapTopic;foreground?:RecapTopic};
export function createTopicRecapQueue(options:{load:(job:{scope:string;topic:RecapTopic;revision:string;mode:'background'|'foreground';signal:AbortSignal})=>Promise<TopicRecapData>;log?:(record:RecapTiming)=>void;clock?:()=>number;delayMs?:number}):{subscribe:(listener:()=>void)=>()=>void;snapshot:()=>number;configure:(next:RecapConfiguration)=>void;read:(scope:string,topic:string,revision:string|undefined)=>TopicRecapState|undefined;retry:(topic:string)=>void;reset:()=>void};
export function logTopicRecapTiming(record:RecapTiming):void;

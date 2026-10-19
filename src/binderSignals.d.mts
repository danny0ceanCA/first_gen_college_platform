export type BinderTopic='options'|'transfer'|'costs'|'applications';
export const binderTopics:BinderTopic[];
export const binderTopicTool:{type:'function';name:string;description:string;parameters:Record<string,unknown>};
export const binderTopicInstructions:string;
export function createBinderActivity():{
 subscribe:(listener:()=>void)=>()=>void;
 snapshot:()=>{source:string;subject:string;studentId:string|null;topics:BinderTopic[]}|null;
 begin:(source:string,subject:string,studentId:string|null,topics?:BinderTopic[])=>boolean;
 update:(source:string,topics:unknown)=>boolean;
 end:(source:string)=>void;
 clear:()=>void;
};
export function createBinderNoteUpdates():{
 subscribe:(listener:()=>void)=>()=>void;
 snapshot:()=>{scope:string;ids:string[]};
 observe:(scope:string,notes:{id:string}[])=>void;
 read:(scope:string,id:string)=>void;
 clear:()=>void;
};

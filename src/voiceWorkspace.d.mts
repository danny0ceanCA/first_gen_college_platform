export type WorkspaceTopic='options'|'transfer'|'costs'|'applications';
export type WorkspaceFocus={kind:'topic';studentId:string|null;topic:WorkspaceTopic}|{kind:'note';studentId:string|null;topic:WorkspaceTopic;noteId:string;version:number}|{kind:'action';studentId:string|null;topic:WorkspaceTopic;planId:string;stepId:string;version:number};
export type WorkspaceSelection=WorkspaceFocus&{serial:string};
export function workspaceGuide(topic:string):'planning'|'finance'|'admissions';
export function planTopic(category:string):WorkspaceTopic;
export function voiceWorkspaceQueue<Selection=WorkspaceSelection>(options:{busy:()=>boolean;apply:(selection:Selection)=>Promise<void>;onPending?:(pending:boolean)=>void;onError?:()=>void;schedule?:(callback:()=>void,delay:number)=>any;cancel?:(timer:any)=>void}):{select:(selection:Selection)=>void;stop:()=>void};

export type VoiceProfileSaveResult={status:'saved'|'missing_details'|'save_failed'|'save_in_progress';instruction:string};
export function explicitProfileSaveRequest(text:unknown):boolean;
export function voiceProfileSaveConsent():{begin:(id:string)=>void;transcript:(id:string,text:unknown)=>boolean;token:()=>string;consume:(token:unknown)=>boolean;clear:()=>void};
export function voiceProfileSaveTools(output:{type:string;name?:string;call_id?:string;arguments?:string}[],save:(()=>Promise<VoiceProfileSaveResult>)|undefined,send:(event:unknown)=>void,isCurrent?:()=>boolean,hasConsent?:()=>boolean):Promise<number>;

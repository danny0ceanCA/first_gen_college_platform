export type VoiceProfileSaveResult={status:'saved'|'missing_details'|'save_failed'|'save_in_progress';instruction:string};
export function voiceProfileSaveTools(output:{type:string;name?:string;call_id?:string;arguments?:string}[],save:(()=>Promise<VoiceProfileSaveResult>)|undefined,send:(event:unknown)=>void,isCurrent?:()=>boolean):Promise<number>;

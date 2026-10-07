export type VoiceLanguage='en'|'es';
type Session={type?:string;instructions:string;tools?:unknown[];[key:string]:unknown};
export type VoiceLanguageControl={
 language:()=>VoiceLanguage;
 event:(event:any)=>boolean;
 change:(language:VoiceLanguage)=>Promise<boolean>;
 configure:(build:(language:VoiceLanguage)=>Session|Promise<Session>,onApplied?:()=>void)=>Promise<boolean>;
 stop:()=>void;
};
export const bilingualTranscriptionPrompt:string;
export function voiceLanguageInstructions(instructions:string,language:VoiceLanguage):string;
export function voiceLanguageControl(send:(event:unknown)=>void,options?:{language?:VoiceLanguage;onLanguage?:(language:VoiceLanguage)=>void;schedule?:(callback:()=>void,delay:number)=>any;cancel?:(timer:any)=>void}):VoiceLanguageControl;
export function voiceLanguageTools(output:{type:string;name?:string;call_id?:string;arguments?:string}[],control:VoiceLanguageControl,send:(event:unknown)=>void):Promise<number>;

export function spokenLanguageFromText(text:unknown,current?:VoiceLanguage):VoiceLanguage;

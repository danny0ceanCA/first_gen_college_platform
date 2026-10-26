export function isVoiceGoodbye(text:unknown):boolean;
export function canEndVoiceConversation(text:unknown):boolean;
export function voiceFarewell(language:'en'|'es'):string;
export function voiceClosing(options:{send:(event:unknown)=>unknown;stopInput:()=>void;stopWork:()=>void;disconnect:(reason:string)=>void;language?:()=> 'en'|'es';schedule?:typeof setTimeout;cancel?:typeof clearTimeout;timeout?:number}):{active:()=>boolean;begin:(instructions?:string)=>void;event:(event:any)=>void;force:()=>void;stop:()=>void};

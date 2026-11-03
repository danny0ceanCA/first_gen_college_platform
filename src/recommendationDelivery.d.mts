export function recommendationSpeechIntent(text:string):'dismiss'|'approve'|'prepare'|'select'|'other';
export function recommendationSpeechRequest(text:string):{goal:string|null;process:string|null}|null;
export function recommendationReadback(value:{action:string;explanation:string},language:string,spoken?:boolean):string;
export function recommendationSaveDisclosure(language:string):string;

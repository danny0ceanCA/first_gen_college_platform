type Turn={role:'user'|'assistant';text:string;topic?:string;language?:'en'|'es';expectedLanguage?:'en'|'es'};
type Source={title:string;url:string;checkedAt:string};
export function appendConversationTurn(turns:Turn[],turn:Turn):Turn[];
export function mergeConversationSources(previous:Source[],incoming:Source[]):Source[];
export function selectConversationMemory<T extends {date:string;id?:string|number;mode?:string;summary?:string}>(items:T[],mode?:string):T[];
export function recentConversationMemory<T extends {studentId:string|null;date:string;id?:string|number;mode?:string;summary?:string}>(items:T[],studentId:string|null,mode?:string):T[];

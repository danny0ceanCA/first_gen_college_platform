type Turn={role:'user'|'assistant';text:string};
type Source={title:string;url:string;checkedAt:string};
export function appendConversationTurn(turns:Turn[],turn:Turn):Turn[];
export function mergeConversationSources(previous:Source[],incoming:Source[]):Source[];
export function recentConversationMemory<T extends {studentId:string|null;date:string}>(items:T[],studentId:string|null):T[];

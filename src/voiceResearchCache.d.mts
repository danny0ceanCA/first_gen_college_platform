type Query={mode:string;language:string;institution:string;question:string;forceRefresh?:boolean};
type Result={sources:{title:string;url:string;checkedAt:string}[];[key:string]:unknown};
export function voiceResearchCache(now?:()=>number):{get:(input:Query)=>Result|undefined;put:(input:Query,result:Result)=>void};
export function wantsFreshLookup(text:string):boolean;
export function voiceResearchBudget(options?:{maxCalls?:number;maxAttemptsPerQuestion?:number}):{take:(query:Query)=>boolean;used:()=>number};

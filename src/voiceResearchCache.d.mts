type Query={mode:string;language:string;institution:string;question:string};
type Result={sources:{title:string;url:string;checkedAt:string}[];[key:string]:unknown};
export function voiceResearchCache(now?:()=>number):{get:(input:Query)=>Result|undefined;put:(input:Query,result:Result)=>void};

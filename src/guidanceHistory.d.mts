export type GuidanceScope={sessionId:string;segmentId:string};
export type GuidanceAttribution={sessionId:string;segmentIds:string[]};
export function guidanceHistory(post:(body:unknown)=>Promise<unknown>):{reset:()=>void;resetScope:()=>void;accept:(value:GuidanceScope|undefined)=>void;current:()=>GuidanceScope|undefined;attribution:()=>GuidanceAttribution|undefined;event:(name:string,payload?:Record<string,string>)=>Promise<unknown>|undefined};

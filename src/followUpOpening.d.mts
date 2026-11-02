export type OpeningClaim={studentId:string;conversationId:string;claimId:string;expiresAt:string;presentation:string};
export type CapturedOpeningTurn={sequence:number;turnId:string;transcript:string};
export type OpeningEvidence={studentId:string;conversationId:string;claimId:string}&(
 {action:'verify'|'release'}|{action:'present';presentation:string}|({action:'defer'}&CapturedOpeningTurn)
);
export function followUpOpeningText(title:string,language:'en'|'es'):string;
export function normalizedOpening(text:unknown):string;
export function declinesCheckIn(text:unknown):boolean;
export function followUpOpeningPlayback(options:{
 claim:OpeningClaim;post:(body:OpeningEvidence,signal?:AbortSignal)=>Promise<{status:string}>;
 canHear?:()=>boolean;isCurrent?:()=>boolean;onUnavailable?:()=>void;signal?:AbortSignal;timeoutMs?:number;
}):{verify:()=>Promise<boolean>;event:(event:Record<string,unknown>)=>void;notNow:(turn:CapturedOpeningTurn)=>Promise<boolean>;settled:()=>Promise<void>;presented:()=>boolean;stop:()=>void};

import type {ReviewResponseReference} from './reviewResponseConnection.mjs';
export type ReviewResponseGuard={source:ReviewResponseReference;revision:string;mode:'focus'|'question'};
export function reviewResponseContextGuard(options:{verify:(guards:ReviewResponseGuard[],signal:AbortSignal)=>Promise<{status:string}>;onInvalidate:()=>void;onUnavailable:()=>void;isCurrent?:()=>boolean;signal?:AbortSignal;intervalMs?:number;maxSources?:number}):{accept:(value:unknown)=>Promise<boolean>;verifyAll:()=>Promise<boolean>;stop:()=>void};

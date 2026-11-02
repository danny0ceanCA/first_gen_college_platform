import type {FollowUpSchedule,FollowUpReport} from './studentFollowUp.mjs';
export function followUpIntent(value:unknown):'stop'|'stop-all'|'check-in'|'report'|'none';
export function approvesFollowUp(value:unknown):boolean;
export function followUpSchedule(text:string,timeZone:string,now?:Date):FollowUpSchedule|null;
export const reportLabels:Record<'en'|'es',Record<string,string>>;
export type PrivateUpdatePayload={report:Omit<FollowUpReport,'provenance'|'definitionVersion'>;planStatus:string|null;reportId?:string;reportVersion?:number};
export type PrivateUpdatePreview={id:string;digest:string;expiresAt:string;kind:'report';action:{title:string;content:string};payload:PrivateUpdatePayload;language:'en'|'es'};
export function privateUpdateReadback(preview:PrivateUpdatePreview,language:'en'|'es',spoken?:boolean):string;
export function checkInReadback(preview:unknown,language:'en'|'es'):string;

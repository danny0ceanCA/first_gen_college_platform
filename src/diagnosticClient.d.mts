import type {browserPrivacy} from './browserPrivacy.mjs';
export function createDiagnosticHints(privacy:typeof browserPrivacy,random?:()=>string,clock?:()=>number):(kind:string,studentId:string|null|undefined,logicalId:string)=>string;
export const diagnosticHint:ReturnType<typeof createDiagnosticHints>;
export function responseReference(response:Response):string|undefined;
export function apiFailure(response:Response,message:string):Error&{status:number;errorReference?:string};

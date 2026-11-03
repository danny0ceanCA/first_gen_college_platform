export const CAPTURE_EMAIL:string;
export function capturePayload(event:any,direction?:string):Record<string,unknown>|null;
export function createVoiceCapture(post:(batch:any[])=>Promise<unknown>):{enable(value:boolean):void;event(event:any,scope:{subject?:string;sessionId:string;attemptId?:string;studentId?:string|null}):void;flush():Promise<void>};

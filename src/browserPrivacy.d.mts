export type ConversationTarget={id?:string;studentId?:string|null;mode?:string};
export type PrivacyEvent={type:'end'|'forget';subject?:string;reason?:string;target?:ConversationTarget};
export type PrivacyLease={signal:AbortSignal;valid:()=>boolean;assert:()=>void;release:()=>void};
export function createBrowserPrivacy(options?:{local?:Storage;session?:Storage;events?:Window;nonce?:()=>string}):{start:(subject:string,options?:{fresh?:boolean})=>boolean;stop:(reason?:string)=>void;pause:()=>void;valid:()=>boolean;capture:(conversation?:ConversationTarget)=>PrivacyLease;forget:(target:ConversationTarget,publish?:boolean)=>void;storage:(key:string)=>Pick<Storage,'getItem'|'setItem'|'removeItem'>;matches:(target:ConversationTarget,item:ConversationTarget)=>boolean;purge:(subject?:string,others?:boolean)=>void;subscribe:(listener:(event:PrivacyEvent)=>void)=>()=>void;readonly subject:string|undefined;destroy:()=>void};
export const browserPrivacy:ReturnType<typeof createBrowserPrivacy>;

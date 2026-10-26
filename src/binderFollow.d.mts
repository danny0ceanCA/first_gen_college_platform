import type {BinderTopic} from './binderSignals.mjs';
export type BinderFollowRequest={serial:number;source:string;subject:string;studentId:string|null;topic:BinderTopic|null};
export function binderFollowDeliverable(request:BinderFollowRequest|null,activity:{source:string;subject:string;studentId:string|null;topics:BinderTopic[]}|null,context:{subject:string|undefined;studentIds:string[];role:'parent'|'student';ready:boolean;blocked:boolean}):boolean;
export function createBinderFollower():{observe(activity:{source:string;subject:string;studentId:string|null;topics:BinderTopic[]}|null,context:{subject:string|undefined;studentIds:string[];role:'parent'|'student';ready:boolean}):BinderFollowRequest|null};
export function createBinderNavigationGuards():{snapshot:()=>boolean;subscribe:(listener:()=>void)=>()=>void;set:(owner:object,blocked:boolean)=>void};

import type {BinderTopic} from './binderSignals.mjs';
type Guide='planning'|'finance'|'loans'|'admissions';
export function binderTopicGuide(topic:unknown,current:string):Guide|null;
export function voiceBinderTopics(options:{getTurn:()=>unknown;canApply:()=>boolean;getGuide:()=>string;followGuide?:boolean;getFocusTopic?:()=>string|undefined;highlight:(topics:BinderTopic[])=>boolean;switchGuide:(guide:Guide,topic:BinderTopic,current:()=>boolean)=>Promise<unknown>;onGuideUnavailable?:()=>void}):{update:(topics:unknown,turn:unknown)=>Promise<boolean>;stop:()=>void};

export function spokenBinderTopic(text:unknown):'options'|'transfer'|'costs'|'applications'|null;

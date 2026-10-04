import {createContext} from 'react';
import type {VoiceProps} from './ProfileVoice';
import type {summarySaveQueue} from './summarySaveQueue.mjs';
export const SharedVoiceContext=createContext<{active:boolean;owner:string|null;claim:(owner:string,active:boolean)=>boolean;launch:(props:VoiceProps)=>void;open:()=>void;queue:ReturnType<typeof summarySaveQueue>;reportSave:(failed:boolean,saving:boolean)=>void}|null>(null);

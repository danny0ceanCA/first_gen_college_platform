import {createContext} from 'react';
import type {VoiceProps} from './ProfileVoice';
import type {WorkspaceFocus} from './voiceWorkspace.mjs';
import type {summarySaveQueue} from './summarySaveQueue.mjs';
export const SharedVoiceContext=createContext<{start:()=>void;ready:boolean;talkAbout:(focus:WorkspaceFocus)=>void;profileSaved:()=>boolean;syncOnboarding:(props:VoiceProps)=>void;configure:(props:VoiceProps|null)=>void;active:boolean;owner:string|null;claim:(owner:string,active:boolean)=>boolean;launch:(props:VoiceProps)=>void;open:()=>void;queue:ReturnType<typeof summarySaveQueue>;reportSave:(failed:boolean,saving:boolean)=>void}|null>(null);

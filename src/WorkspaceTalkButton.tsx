import {useContext} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import VoiceStartButton from './VoiceStartButton';
import type {WorkspaceFocus} from './voiceWorkspace.mjs';
export default function WorkspaceTalkButton({focus,t,disabled=false}:{focus:WorkspaceFocus;t:(en:string,es:string)=>string;disabled?:boolean}){
 const shared=useContext(SharedVoiceContext);
 return <VoiceStartButton label={t('Talk about this','Hablemos de esto')} disabled={disabled||!shared} onClick={()=>shared?.talkAbout(focus)}/>;
}

import {Pause,Play} from 'lucide-react';
import {useSyncExternalStore} from 'react';
import {binderActivity} from './binderActivity';
import {binderFollowControl,useBinderFollowPaused} from './binderFollowControl';

export default function VoiceFollowControl({t}:{t:(en:string,es:string)=>string}){
 const activity=useSyncExternalStore(binderActivity.subscribe,binderActivity.snapshot,()=>null);
 const paused=useBinderFollowPaused();
 if(!activity)return null;
 return <button type="button" className="voice-follow-control" aria-pressed={paused} onClick={()=>binderFollowControl.setPaused(!paused)} title={t('Keep reading while Origen talks. Topic highlights continue.','Sigue leyendo mientras Origen habla. Los temas siguen iluminándose.')}>
  {paused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}
  {paused?t('Resume topic following','Seguir los temas de nuevo'):t('Pause topic following','Pausar seguimiento de temas')}
 </button>;
}

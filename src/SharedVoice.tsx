import {summarySaveQueue} from './summarySaveQueue.mjs';
import {useRef,useState,type ReactNode} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import {LocalProfileVoice,type VoiceProps} from './ProfileVoice';
import './SharedVoice.css';
export default function SharedVoice({children}:{children:ReactNode}){
 const [session,setSession]=useState<{id:number;props:VoiceProps}|null>(null);
 const [owner,setOwner]=useState<string|null>(null),[expanded,setExpanded]=useState(true);
 const ownerRef=useRef<string|null>(null),queue=useRef(summarySaveQueue());
 const [saveFailed,setSaveFailed]=useState(false),[saving,setSaving]=useState(false);
 const active=owner!==null;
 function claim(id:string,live:boolean){if(live){if(ownerRef.current&&ownerRef.current!==id)return false;ownerRef.current=id;setOwner(id);}else if(ownerRef.current===id){ownerRef.current=null;setOwner(null);}return true;}
 async function retry(){setSaving(true);setSaveFailed(false);try{await queue.current.flush();}catch{setSaveFailed(true);}finally{setSaving(false);}}

 const t=session?.props.t||((en:string)=>en);
 return <SharedVoiceContext.Provider value={{active,owner,claim,queue:queue.current,reportSave:(failed,saving)=>{setSaveFailed(failed);setSaving(saving);},open:()=>setExpanded(true),launch:props=>{if(ownerRef.current){setExpanded(true);return;}if(!claim('shared',true)){setExpanded(true);return;}setSession({id:Date.now(),props});setExpanded(true);}}}>
 {children}
 {!session&&saveFailed&&<aside className="shared-voice"><p role="alert">Conversation summary not saved / Resumen sin guardar</p><button className="button outline" disabled={saving} onClick={()=>void retry()}>Retry / Reintentar</button></aside>}
 {session&&<aside className={`shared-voice ${expanded?'expanded':'compact'}`} aria-label={t('Live conversation','Conversacion en vivo')}>
 <div className="shared-voice-heading"><strong>{t('Origen voice guide','Guia de voz Origen')}</strong><button type="button" className="text-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?t('Minimize','Minimizar'):t('Show conversation','Mostrar conversacion')}</button></div>
 {saveFailed&&<div className="shared-summary-error" role="alert"><p>{t('Your conversation summary has not saved yet.','El resumen de tu conversacion aun no se ha guardado.')}</p><button type="button" className="button outline" disabled={saving} onClick={()=>void retry()}>{t('Retry saving summary','Volver a guardar el resumen')}</button></div>}
 <LocalProfileVoice key={session.id} {...session.props} autoStart onActive={live=>{claim('shared',live);}}/>
 </aside>}
 </SharedVoiceContext.Provider>;
}

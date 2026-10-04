import {ChevronDown,ChevronUp,AudioLines,Mic} from 'lucide-react';
import {summarySaveQueue} from './summarySaveQueue.mjs';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import {LocalProfileVoice,type VoiceProps,type VoiceHandoff} from './ProfileVoice';
import './SharedVoice.css';
export default function SharedVoice({children}:{children:ReactNode}){
 const [entry,setEntry]=useState<VoiceProps|null>(null);
 const [guide,setGuide]=useState<'finance'|'admissions'|'planning'|'loans'>('planning');
 const [session,setSession]=useState<{id:number;props:VoiceProps}|null>(null);
 const [owner,setOwner]=useState<string|null>(null),[expanded,setExpanded]=useState(false);
 const ownerRef=useRef<string|null>(null),queue=useRef(summarySaveQueue());
 const [saveFailed,setSaveFailed]=useState(false),[saving,setSaving]=useState(false);
 const active=owner!==null;
 useEffect(()=>{if(!active&&entry?.mode&&entry.mode!=='profile')setGuide(entry.mode);},[active,entry?.mode]);
 const guideName=(mode:string|undefined)=>mode==='loans'?t('Loans','Préstamos'):mode==='finance'?t('College costs','Costos universitarios'):mode==='admissions'?t('Applications','Solicitudes'):t('Planning','Planificacion');
 function claim(id:string,live:boolean){if(live){if(ownerRef.current&&ownerRef.current!==id)return false;ownerRef.current=id;setOwner(id);}else if(ownerRef.current===id){ownerRef.current=null;setOwner(null);}return true;}
 async function retry(){setSaving(true);setSaveFailed(false);try{await queue.current.flush();}catch{setSaveFailed(true);}finally{setSaving(false);}}

 const t=entry?.t||session?.props.t||((en:string)=>en);
 function launch(props:VoiceProps){if(ownerRef.current){setExpanded(true);return;}if(!claim('shared',true))return;if(props.mode&&props.mode!=='profile')setGuide(props.mode);setSession({id:Date.now(),props});setExpanded(false);}
 function handoff(mode:'finance'|'admissions'|'planning'|'loans',continuity:VoiceHandoff){if(!session)return;launch({...session.props,mode,language:continuity.language,continuity,onboarding:false,replayWelcome:false});}
 return <SharedVoiceContext.Provider value={{configure:setEntry,active,owner,claim,queue:queue.current,reportSave:(failed,saving)=>{setSaveFailed(failed);setSaving(saving);},open:()=>setExpanded(true),launch}}>
 {children}
 {!session&&entry&&<aside className="shared-voice voice-ready" aria-label={t('Origen voice guide','Guia de voz Origen')}><div className="shared-voice-heading"><strong><AudioLines size={18} aria-hidden="true"/> Origen</strong><span className="voice-ready-label">{t('Here to help','Aqui para ayudarte')}</span></div><div className="voice-ready-controls"><span className="voice-current-section">{guideName(entry.mode)}</span><button type="button" className="button primary" disabled={active} onClick={()=>launch({...entry,mode:guide})}><Mic size={16}/>{t('Talk','Hablar')}</button></div></aside>}
 {!session&&saveFailed&&<aside className="shared-voice"><p role="alert">Conversation summary not saved / Resumen sin guardar</p><button className="button outline" disabled={saving} onClick={()=>void retry()}>Retry / Reintentar</button></aside>}
 {session&&<aside className={`shared-voice compact${expanded?' details-open':''}`} aria-label={t('Live conversation','Conversacion en vivo')}>
 <div className="shared-voice-heading"><strong><AudioLines size={18} aria-hidden="true"/> Origen <span className="voice-guide-tag">{(active?session.props.mode:guide)==='loans'?t('Loans','Préstamos'):(active?session.props.mode:guide)==='finance'?t('College costs','Costos'):(active?session.props.mode:guide)==='admissions'?t('Applications','Solicitudes'):t('Planning','Planificación')}</span></strong><button type="button" className="voice-expand" aria-label={expanded?t('Close conversation details','Cerrar detalles de la conversación'):t('Show conversation details','Mostrar detalles de la conversación')} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button></div>
 {saveFailed&&<div className="shared-summary-error" role="alert"><p>{t('Your conversation summary has not saved yet.','El resumen de tu conversacion aun no se ha guardado.')}</p><button type="button" className="button outline" disabled={saving} onClick={()=>void retry()}>{t('Retry saving summary','Volver a guardar el resumen')}</button></div>}
 {!active&&entry&&<div className="voice-ready-controls"><span className="voice-current-section">{guideName(entry.mode)}</span></div>}
 <LocalProfileVoice detailsOpen={expanded} onCloseDetails={()=>setExpanded(false)} onHandoff={handoff} onSwitchGuide={active&&entry&&entry.mode!==session.props.mode?context=>handoff(entry.mode as 'finance'|'admissions'|'planning'|'loans',context):undefined} switchGuideLabel={entry?guideName(entry.mode):undefined} onRestart={()=>launch({...entry||session.props,mode:guide})} key={session.id} {...session.props} autoStart onActive={live=>{claim('shared',live);}}/>
 </aside>}
 </SharedVoiceContext.Provider>;
}

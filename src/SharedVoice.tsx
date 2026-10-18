import {ChevronDown,ChevronUp,AudioLines} from 'lucide-react';
import VoiceStartButton from './VoiceStartButton';
import {summarySaveQueue} from './summarySaveQueue.mjs';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import {LocalProfileVoice,type VoiceProps} from './ProfileVoice';
import './SharedVoice.css';
import {workspaceGuide,type WorkspaceFocus} from './voiceWorkspace.mjs';
export default function SharedVoice({children}:{children:ReactNode}){
 const [entry,setEntry]=useState<VoiceProps|null>(null);
 const voiceLanguage=useRef<'en'|'es'|null>(null),screenLanguage=useRef<'en'|'es'|null>(null);
 const [guide,setGuide]=useState<'finance'|'admissions'|'planning'|'loans'>('planning');
 const [session,setSession]=useState<{id:number;props:VoiceProps}|null>(null);
 const [owner,setOwner]=useState<string|null>(null),[expanded,setExpanded]=useState(false);
 const ownerRef=useRef<string|null>(null),queue=useRef(summarySaveQueue());
 const [saveFailed,setSaveFailed]=useState(false),[saving,setSaving]=useState(false);
 const dock=useRef<HTMLDivElement>(null);
 const active=owner!==null;
 useLayoutEffect(()=>{
  const container=dock.current;
  if(!container)return;
  const root=document.documentElement;
  const bars=Array.from(container.children) as HTMLElement[];
  // Reserve exactly the visible dock, including wrapped text and mobile safe area.
  // A fixed allowance left an empty tail below the binder's last page.
  const measure=()=>{
   const height=Math.ceil(Math.max(0,...bars.map(bar=>bar.getBoundingClientRect().height)));
   root.style.setProperty('--shared-voice-height',`${height}px`);
  };
  measure();
  const observer=new ResizeObserver(measure);
  bars.forEach(bar=>observer.observe(bar,{box:'border-box'}));
  return()=>{observer.disconnect();root.style.removeProperty('--shared-voice-height');};
 },[!!session,!!entry,saveFailed]);
 useEffect(()=>browserPrivacy.subscribe(event=>{if(event.type==='end'){queue.current.clear();ownerRef.current=null;setOwner(null);setSession(null);setEntry(null);}}),[]);
 useEffect(()=>{if(!active)setExpanded(false);},[active]);
 useEffect(()=>{if(!active&&entry?.mode&&entry.mode!=='profile')setGuide(entry.mode);},[active,entry?.mode]);
 const guideName=(mode:string|undefined)=>mode==='loans'?t('Loans','Préstamos'):mode==='finance'?t('College costs','Costos universitarios'):mode==='admissions'?t('Applications','Solicitudes'):t('Planning','Planificacion');
 function claim(id:string,live:boolean){if(live){if(ownerRef.current&&ownerRef.current!==id)return false;ownerRef.current=id;setOwner(id);}else if(ownerRef.current===id){ownerRef.current=null;setOwner(null);}return true;}
 async function retry(){setSaving(true);setSaveFailed(false);try{await queue.current.flush();}catch{setSaveFailed(true);}finally{setSaving(false);}}

 const t=entry?.t||session?.props.t||((en:string)=>en);
 function launch(props:VoiceProps){if(ownerRef.current){setExpanded(true);return;}if(!claim('shared',true))return;if(props.mode&&props.mode!=='profile')setGuide(props.mode);const language=props.language===screenLanguage.current?voiceLanguage.current||props.language:props.language;screenLanguage.current=props.language;voiceLanguage.current=language;setSession({id:Date.now(),props:{...props,language}});setExpanded(false);}
 function talkAbout(focus:WorkspaceFocus){
  const workspaceFocus={...focus,serial:crypto.randomUUID()};
  if(ownerRef.current){setSession(previous=>previous?{...previous,props:{...previous.props,workspaceFocus}}:previous);return;}
  if(entry)launch({...entry,mode:workspaceGuide(focus.topic),workspaceFocus});
 }
 function configure(props:VoiceProps|null){
  setEntry(props);
  // Screen selection is a prompt to clarify the target, never automatic consent.
  if(props)setSession(previous=>previous&&!previous.props.onboarding?{...previous,props:{...previous.props,profile:props.profile}}:previous);
 }

 return <SharedVoiceContext.Provider value={{start:()=>{if(entry)launch({...entry,mode:guide});},ready:!!entry,talkAbout,configure,profileSaved:()=>{if(!ownerRef.current)return false;setSession(previous=>previous?{...previous,props:{...previous.props,profileSaved:(previous.props.profileSaved||0)+1}}:previous);return true;},syncOnboarding:props=>setSession(previous=>previous?.props.onboarding&&previous.props.recoveryKey===props.recoveryKey?{...previous,props:{...previous.props,...props}}:previous),active,owner,claim,queue:queue.current,reportSave:(failed,saving)=>{setSaveFailed(failed);setSaving(saving);},open:()=>setExpanded(true),launch}}>
 {children}
 <div ref={dock} className="shared-voice-dock">
 {!session&&entry&&<aside className="shared-voice voice-ready" aria-label={t('Origen voice guide','Guía de voz Origen')}><div className="shared-voice-heading"><strong>Origen</strong><span className="voice-current-section">{guideName(entry.mode)}</span></div><div className="voice-ready-controls"><VoiceStartButton label={t('Talk with Origen','Hablar con Origen')} disabled={active} onClick={()=>launch({...entry,mode:guide})}/></div></aside>}
 {!session&&saveFailed&&<aside className="shared-voice"><p role="alert">Conversation summary not saved / Resumen sin guardar</p><button className="button outline" disabled={saving} onClick={()=>void retry()}>Retry / Reintentar</button></aside>}
 {session&&<aside className={`shared-voice compact${expanded?' details-open':''}`} aria-label={t('Live conversation','Conversacion en vivo')}>
 <div className="shared-voice-heading"><strong><AudioLines size={18} aria-hidden="true"/> Origen <span className="voice-guide-tag">{(active?session.props.mode:guide)==='loans'?t('Loans','Préstamos'):(active?session.props.mode:guide)==='finance'?t('College costs','Costos'):(active?session.props.mode:guide)==='admissions'?t('Applications','Solicitudes'):t('Planning','Planificación')}</span></strong><button type="button" className="voice-expand" aria-label={expanded?t('Close conversation details','Cerrar detalles de la conversación'):t('Show conversation details','Mostrar detalles de la conversación')} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button></div>
 {saveFailed&&<div className="shared-summary-error" role="alert"><p>{t('Your conversation summary has not saved yet.','El resumen de tu conversacion aun no se ha guardado.')}</p><button type="button" className="button outline" disabled={saving} onClick={()=>void retry()}>{t('Retry saving summary','Volver a guardar el resumen')}</button></div>}
 {!active&&entry&&<div className="voice-ready-controls"><span className="voice-current-section">{guideName(entry.mode)}</span></div>}
 <LocalProfileVoice detailsOpen={expanded} onCloseDetails={()=>setExpanded(false)} onGuideChanged={mode=>{setGuide(mode);setSession(previous=>previous?{...previous,props:{...previous.props,mode,...(previous.props.onboarding?{onboarding:false,onSaveProfile:undefined,onAccountDraft:undefined,onDraft:undefined,onProfileSaveComplete:undefined,recoveryKey:undefined}: {})}}:previous);}} switchGuideMode={active&&entry&&entry.mode!=='profile'&&entry.mode!==session.props.mode?entry.mode:undefined} switchGuideLabel={entry?guideName(entry.mode):undefined} onRestart={()=>launch({...entry||session.props,mode:guide})} key={session.id} {...session.props} t={t} onLanguageChanged={next=>{voiceLanguage.current=next;setSession(previous=>previous?{...previous,props:{...previous.props,language:next}}:previous);session.props.onLanguageChanged?.(next);}} autoStart onActive={live=>{claim('shared',live);session.props.onActive(live);}}/>
 </aside>}
 </div>
 </SharedVoiceContext.Provider>;
}

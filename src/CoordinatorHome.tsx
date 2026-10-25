import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,HandHelping,Sparkles,UserRoundPlus,KeyRound,ShieldCheck} from 'lucide-react';
import {browserPrivacy} from './browserPrivacy.mjs';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';

export type BinderView='all'|'new'|'help';
type T=(en:string,es:string)=>string;
export default function CoordinatorHome({organizationId,name,t,request,onBinders,onConnections,onProfile}:{organizationId:string;name:string;t:T;request:(input:Record<string,unknown>)=>Promise<any>;onBinders:(view:BinderView)=>void;onConnections:()=>void;onProfile:()=>void}){
 const [counts,setCounts]=useState<Record<BinderView,number>>(),[error,setError]=useState('');
 const requestRef=useRef(request);requestRef.current=request;
 useEffect(()=>{
  let version=0;
  const clear=()=>{version++;setCounts(undefined);setError('');};
  async function load(){
   clear();if(document.hidden||!navigator.onLine||!browserPrivacy.valid())return;
   const current=version,lease=browserPrivacy.capture();
   try{const result=await requestRef.current({action:'list',organizationId,view:'all',search:'',cursor:null});lease.assert();if(current===version)setCounts(result.counts);}
   catch(e){if(current===version)setError((e as Error).message);}
   finally{lease.release();}
  }
  void load();const stop=browserPrivacy.subscribe(clear);
  window.addEventListener('focus',load);window.addEventListener('blur',clear);window.addEventListener('online',load);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',load);
  const timer=setInterval(()=>void load(),60000);
  return()=>{clear();stop();clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('blur',clear);window.removeEventListener('online',load);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',load);};
 },[organizationId]);
 return <>
  <section className="coordinator-welcome"><div><span className="eyebrow">{t('A LITTLE GUIDANCE. A NEXT STEP.','ORIENTACIÓN PARA EL SIGUIENTE PASO.')}</span><h2>{t(`Welcome, ${name}.`,`Te damos la bienvenida, ${name}.`)}</h2><p>{t('A place to stay connected and help your students move forward.','Un espacio para mantener el contacto y ayudar a tus estudiantes a avanzar.')}</p><button className="button primary" onClick={()=>onBinders('all')}>{t('Open shared binders','Abrir carpetas compartidas')}<ArrowRight size={18}/></button></div><BookOpen className="coordinator-welcome-icon" size={90} strokeWidth={1} aria-hidden="true"/></section>
  <section className="coordinator-home-stats" aria-label={t('Shared binder overview','Resumen de carpetas compartidas')}>
   {([{id:'all',label:t('Shared binders','Carpetas compartidas'),detail:t('Ready for your guidance','Listas para tu orientación'),Icon:BookOpen},{id:'new',label:t('New updates','Novedades'),detail:t('Publications to review','Publicaciones por revisar'),Icon:Sparkles},{id:'help',label:t('Help requested','Ayuda solicitada'),detail:t('Students asking for guidance','Estudiantes que piden orientación'),Icon:HandHelping}] as const).map(({id,label,detail,Icon})=><button key={id} onClick={()=>onBinders(id)}><span><Icon size={19}/>{label}<ArrowRight size={16}/></span><strong>{counts?counts[id].toLocaleString(t('en','es')):'—'}</strong><small>{detail}</small></button>)}
  </section>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{t('The binder overview could not be loaded. Refresh to try again.','No se pudo cargar el resumen de carpetas. Actualiza para intentar de nuevo.')}</p>)}
  <div className="coordinator-home-actions"><button onClick={onConnections}><UserRoundPlus size={24}/><span><strong>{t('Student connections','Conexiones con estudiantes')}</strong><small>{t('Review requests and welcome students.','Revisa solicitudes y da la bienvenida a estudiantes.')}</small></span><ArrowRight size={18}/></button><button onClick={onProfile}><KeyRound size={24}/><span><strong>{t('Your connection code','Tu código de conexión')}</strong><small>{t('Help students find you on Origen.','Ayuda a los estudiantes a encontrarte en Origen.')}</small></span><ArrowRight size={18}/></button></div>
  <p className="coordinator-sharing-note"><ShieldCheck size={19}/>{t('Students choose what to share. Family conversations stay private.','Los estudiantes eligen qué compartir. Las conversaciones familiares permanecen privadas.')}</p>
 </>;
}

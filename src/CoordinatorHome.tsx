import {useEffect,useRef,useState} from 'react';
import {useArrivalPending} from './arrivalReadiness';
import {ArrowRight,BookOpen,HandHelping,UserRoundPlus,KeyRound,ShieldCheck} from 'lucide-react';
import {browserPrivacy} from './browserPrivacy.mjs';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';

type T=(en:string,es:string)=>string;
export default function CoordinatorHome({organizationId,name,t,request,onBinders,onConnections,onProfile,loading=false,refreshVersion=0}:{organizationId:string;name:string;t:T;request:(input:Record<string,unknown>)=>Promise<any>;onBinders:()=>void;onConnections:()=>void;onProfile:()=>void;loading?:boolean;refreshVersion?:number}){
 const [counts,setCounts]=useState<{all:number;help:number}>(),[error,setError]=useState('');
 useArrivalPending(!loading&&!counts&&!error);
 const requestRef=useRef(request);requestRef.current=request;
 const refresh=useRef<()=>void>(()=>{}),seenRefresh=useRef(refreshVersion);
 useEffect(()=>{
  if(loading)return;
  let version=0;
  const clear=()=>{version++;setCounts(undefined);setError('');};
  async function load(){
   if(document.hidden||!navigator.onLine||!browserPrivacy.valid()){clear();return;}
   const current=++version,lease=browserPrivacy.capture();setError('');
   try{const result=await requestRef.current({action:'list',organizationId,view:'all',search:'',cursor:null});lease.assert();if(current===version)setCounts(result.counts);}
   catch(e){if(current===version){setCounts(undefined);setError((e as Error).message);}}
   finally{lease.release();}
  }
  refresh.current=()=>void load();void load();const stop=browserPrivacy.subscribe(clear);
  window.addEventListener('focus',load);window.addEventListener('blur',clear);window.addEventListener('online',load);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',load);
  const timer=setInterval(()=>void load(),60000);
  return()=>{refresh.current=()=>{};clear();stop();clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('blur',clear);window.removeEventListener('online',load);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',load);};
 },[organizationId,loading]);
 useEffect(()=>{if(seenRefresh.current!==refreshVersion){seenRefresh.current=refreshVersion;refresh.current();}},[refreshVersion]);
 return <>
  <section className="coordinator-welcome"><div><span className="eyebrow">{t('A LITTLE GUIDANCE. A NEXT STEP.','ORIENTACIÓN PARA EL SIGUIENTE PASO.')}</span><h2>{t(`Welcome, ${name}.`,`Te damos la bienvenida, ${name}.`)}</h2><p>{t('A place to stay connected and help your students move forward.','Un espacio para mantener el contacto y ayudar a tus estudiantes a avanzar.')}</p><button className="button primary" disabled={loading} onClick={onBinders}>{t('Open shared binders','Abrir carpetas compartidas')}<ArrowRight size={18}/></button></div><BookOpen className="coordinator-welcome-icon" size={90} strokeWidth={1} aria-hidden="true"/></section>
  <section className="coordinator-home-stats" aria-label={t('Shared binder overview','Resumen de carpetas compartidas')}>
   <button disabled={loading} onClick={onBinders}><span><BookOpen size={19}/>{t('Shared binders','Carpetas compartidas')}<ArrowRight size={16}/></span><strong>{counts?counts.all.toLocaleString(t('en','es')):'—'}</strong><small>{t('Ready for your guidance','Listas para tu orientación')}</small></button>
   <button disabled={loading} onClick={onBinders}><span><HandHelping size={19}/>{t('Students asking for help','Estudiantes que piden ayuda')}<ArrowRight size={16}/></span><strong>{counts?counts.help.toLocaleString(t('en','es')):'—'}</strong><small>{t('Find their requests in shared binders','Encuentra sus solicitudes en las carpetas compartidas')}</small></button>
  </section>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{t('The binder overview could not be loaded. Refresh to try again.','No se pudo cargar el resumen de carpetas. Actualiza para intentar de nuevo.')}</p>)}
  <div className="coordinator-home-actions"><button onClick={onConnections}><UserRoundPlus size={24}/><span><strong>{t('Student connections','Conexiones con estudiantes')}</strong><small>{t('Review requests and welcome students.','Revisa solicitudes y da la bienvenida a estudiantes.')}</small></span><ArrowRight size={18}/></button><button onClick={onProfile}><KeyRound size={24}/><span><strong>{t('Your connection code','Tu código de conexión')}</strong><small>{t('Help students find you on Origen.','Ayuda a los estudiantes a encontrarte en Origen.')}</small></span><ArrowRight size={18}/></button></div>
  <p className="coordinator-sharing-note"><ShieldCheck size={19}/>{t('Students choose what to share. Family conversations stay private.','Los estudiantes eligen qué compartir. Las conversaciones familiares permanecen privadas.')}</p>
 </>;
}

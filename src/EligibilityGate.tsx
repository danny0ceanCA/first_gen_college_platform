import {apiFetch} from './api';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';
import './EligibilityGate.css';
type Screen={ageBand:string;audience:string};
type Status={status:string;allowed:boolean;ageBand?:string;requestId?:string;delivery?:string;permissionExpiresAt?:string};
export function EligibilityQuestions({es,onSubmit,busy=false}:{es:boolean;onSubmit:(value:Screen)=>void;busy?:boolean}){
 const [ageBand,setAge]=useState(''),[audience,setAudience]=useState('');const t=(en:string,sp:string)=>es?sp:en;
 return <form onSubmit={e=>{e.preventDefault();if(ageBand&&audience)onSubmit({ageBand,audience});}}>
  <label>{t('Which age group are you in?','¿En qué grupo de edad estás?')}<select required value={ageBand} onChange={e=>setAge(e.target.value)}><option value="">{t('Select an answer','Selecciona una respuesta')}</option><option value="under13">{t('Under 13','Menos de 13')}</option><option value="13to17">13–17</option><option value="18plus">{t('18 or older','18 o más')}</option></select></label>
  <label>{t('Which describes your current situation?','¿Qué describe tu situación actual?')}<select required value={audience} onChange={e=>setAudience(e.target.value)}><option value="">{t('Select an answer','Selecciona una respuesta')}</option><option value="grade9plus">{t('Student in ninth grade or later, including college or returning to education','Estudiante de noveno grado en adelante, incluida la universidad o el regreso a los estudios')}</option><option value="adult_supporter">{t('Adult supporting a student','Adulto que apoya a un estudiante')}</option><option value="other">{t('Another situation','Otra situación')}</option></select></label>
  <button className="button primary" disabled={busy||!ageBand||!audience}>{t('Continue','Continuar')}</button>
 </form>;
}
export default function EligibilityGate({children,onAllowed,hideSignOut=false}:{children?:ReactNode;onAllowed?:()=>void;hideSignOut?:boolean}){
 const auth=useAuth0(),subject=auth.user?.sub;const [state,setState]=useState<Status>(),[error,setError]=useState(false),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[es,setEs]=useState(()=>document.documentElement.lang==='es');
 const active=useRef(true),allowed=useRef(false),unavailable=useRef(false),sequence=useRef(0),callback=useRef(onAllowed);callback.current=onAllowed;
 const t=(en:string,sp:string)=>es?sp:en;
 const check=async(body:Record<string,unknown>,signal?:AbortSignal)=>{
  const requestSequence=++sequence.current;let deadline:ReturnType<typeof setTimeout>|undefined;
  const token=await Promise.race([auth.getAccessTokenSilently(),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('permission_unavailable')),10000);})]).finally(()=>clearTimeout(deadline));signal?.throwIfAborted();
  const response=await fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/eligibility`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok||data.subject!==subject||typeof data.allowed!=='boolean')throw new Error('permission_unavailable');
  if(!active.current||requestSequence!==sequence.current)return;
  if(!data.allowed&&(allowed.current||unavailable.current))browserPrivacy.stop('eligibility_changed');
  if(data.allowed&&subject&&!allowed.current&&!browserPrivacy.start(subject,{fresh:!unavailable.current}))throw new Error('permission_unavailable');
  unavailable.current=false;allowed.current=data.allowed===true;setState(data);setError(false);if(data.allowed)callback.current?.();
 };
 const pause=()=>{if(!active.current)return;unavailable.current=true;allowed.current=false;setState(undefined);setError(true);browserPrivacy.pause();};
 useEffect(()=>{
  active.current=true;const controller=new AbortController();
  let polling=false;const poll=async()=>{if(polling)return;polling=true;try{await check({action:'status'},controller.signal);}catch{if(!controller.signal.aborted)pause();}finally{polling=false;}};
  void poll();const timer=setInterval(()=>void poll(),5000);window.addEventListener('focus',poll);
  const unsubscribe=browserPrivacy.subscribe(event=>{if(event.type==='end'&&['eligibility_changed','permission_unavailable'].includes(event.reason||'')){sequence.current++;allowed.current=false;setState(undefined);}});
  return()=>{active.current=false;sequence.current++;controller.abort();clearInterval(timer);window.removeEventListener('focus',poll);unsubscribe();};
  // Entry/native wrappers key this boundary by authenticated subject.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[subject]);
 useEffect(()=>{if(!state?.allowed)return;const id=sessionStorage.getItem('origen-login-event');if(!id)return;void apiFetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',id})}).then(response=>{if(response.ok&&sessionStorage.getItem('origen-login-event')===id)sessionStorage.removeItem('origen-login-event');}).catch(()=>{});},[state?.allowed,subject]);
 const act=async(body:Record<string,unknown>)=>{if(busy)return;setBusy(true);try{await check(body);}catch{pause();}finally{if(active.current)setBusy(false);}};
 if(state?.allowed)return <>{children}<button className="permission-withdraw" onClick={()=>void act({action:'withdraw'})}>{t('Withdraw account permission','Retirar el permiso de la cuenta')}</button></>;
 return <main className="eligibility-panel"><button className="button outline" onClick={()=>setEs(!es)}>{es?'English':'Español'}</button><h1>{t('Account eligibility and permission','Elegibilidad y permiso de la cuenta')}</h1>
  {error&&<p role="alert">{t('We could not confirm permission. Please try again.','No pudimos confirmar el permiso. Intenta de nuevo.')}</p>}
  {!state&&!error&&<p role="status">{t('Checking account permission…','Comprobando el permiso de la cuenta…')}</p>}
  {state?.status==='unknown'&&<><p>{t('Answer for the person who will use this account. We do not ask for a full birth date.','Responde por la persona que usará esta cuenta. No pedimos la fecha de nacimiento completa.')}</p><EligibilityQuestions es={es} busy={busy} onSubmit={value=>void act({action:'screen',...value})}/></>}
  {state&&['pending','expired'].includes(state.status)&&<><h2>{t('Parent or guardian permission','Permiso de madre, padre o tutor')}</h2><p>{t('A parent or legal guardian must review an email notice and choose whether to approve. Until then, profiles, microphone use and AI are unavailable. This does not link family accounts or share conversations.','Una madre, padre o tutor legal debe revisar un aviso por correo y decidir si autoriza. Hasta entonces, los perfiles, el micrófono y la IA no están disponibles. Esto no vincula cuentas familiares ni comparte conversaciones.')}</p>
   <form onSubmit={e=>{e.preventDefault();void act({action:'request',guardianEmail:email});}}><label>{t('Parent or guardian email','Correo de madre, padre o tutor')}<input required type="email" maxLength={254} autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="button primary" disabled={busy}>{t('Request permission','Solicitar permiso')}</button></form>
   {state.requestId&&<><p>{t('Request reference:','Referencia de la solicitud:')} {state.requestId}</p><p role="status">{state.delivery==='accepted'?t('The email provider accepted the request. Approval is still pending.','El proveedor de correo aceptó la solicitud. El permiso sigue pendiente.'):state.delivery==='mock'?t('Synthetic review: a mock message was captured. No email was sent.','Revisión de prueba: se capturó un mensaje simulado. No se envió un correo.'):state.delivery==='failed'?t('Delivery failed. Permission remains pending. Try again later.','Falló el envío. El permiso sigue pendiente. Intenta más tarde.'):t('Email delivery is disabled. No email has been sent, and permission remains pending.','El envío de correo está desactivado. No se ha enviado un correo y el permiso sigue pendiente.')}</p></>}
   <button className="button outline" disabled={busy} onClick={()=>void act({action:'withdraw'})}>{t('Withdraw this request','Retirar esta solicitud')}</button></>}
  {state&&['blocked','denied','revoked'].includes(state.status)&&<p role="status">{t('This account cannot continue into profiles or AI. Contact daniel@origenedu.ai for help or a deletion request. Changing the answers is not available here.','Esta cuenta no puede continuar a perfiles o IA. Contacta a daniel@origenedu.ai para pedir ayuda o eliminación. No se pueden cambiar las respuestas aquí.')}</p>}
  <button className="button outline" disabled={busy} onClick={()=>void act({action:'status'})}>{t('Check status','Consultar estado')}</button>{!hideSignOut&&<button className="button outline" onClick={()=>void auth.logout({logoutParams:{returnTo:window.location.origin}})}>{t('Sign out','Cerrar sesión')}</button>}<p><a href="mailto:daniel@origenedu.ai">daniel@origenedu.ai</a></p>
 </main>;
}

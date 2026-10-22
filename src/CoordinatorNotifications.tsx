import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import './CoordinatorNotifications.css';
type T=(en:string,es:string)=>string;
type Notice={id:string;kind:string;createdAt:string;read:boolean};
export type NoticeDestination={destination:string;grantId:string;studentId:string;organizationId:string};
export function useNotificationRequest(){
 const {getAccessTokenSilently}=useAuth0();
 return useCallback(async(input:Record<string,unknown>)=>{
  const lease=browserPrivacy.capture(typeof input.studentId==='string'?{studentId:input.studentId}:undefined);
  try{
  const token=await getAccessTokenSilently();
  lease.assert();
  const response=await apiFetch('/api/coordinator-notifications',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(10000)])});
  const data=await response.json();lease.assert();if(!response.ok)throw new Error(data.error||'notifications_unavailable');return data;
  }finally{lease.release();}
 },[getAccessTokenSilently]);
}
export default function CoordinatorNotifications({studentId,organizationId,t,onOpen,request:provided}:{studentId?:string;organizationId?:string;t:T;onOpen:(value:NoticeDestination)=>void;request?:(input:Record<string,unknown>)=>Promise<any>}){
 const authenticatedRequest=useNotificationRequest(),request=provided||authenticatedRequest;
 const requestRef=useRef(request);requestRef.current=request;
 const [items,setItems]=useState<Notice[]>([]),[expanded,setExpanded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef(true),working=useRef(false);
 const epoch=useRef(0);const scope={audience:organizationId?'staff':'student',studentId,organizationId};
 const clear=()=>{working.current=false;epoch.current++;setItems([]);setError('');setBusy(false);};
 async function load(){if(!browserPrivacy.valid()||!active.current||working.current)return;const v=++epoch.current;try{const data=await requestRef.current({...scope,action:'list'});if(v===epoch.current){setItems(data.notifications);setError('');}}catch(e){if(v===epoch.current){setItems([]);setError((e as Error).message);}}}
 useEffect(()=>{
  active.current=true;clear();void load();const pause=()=>{active.current=false;clear();},resume=()=>{active.current=!document.hidden&&navigator.onLine;clear();if(active.current)void load();};
  const stop=browserPrivacy.subscribe(clear);const timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void load();},60000);
  window.addEventListener('blur',pause);window.addEventListener('focus',resume);window.addEventListener('offline',pause);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{epoch.current++;stop();clearInterval(timer);window.removeEventListener('blur',pause);window.removeEventListener('focus',resume);window.removeEventListener('offline',pause);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
 // Refresh only the currently selected owner/organization, never a previous response.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[studentId,organizationId]);
 async function act(item:Notice,action:'read'|'open'){
  const v=++epoch.current;working.current=true;setBusy(true);setError('');
  try{const result=await requestRef.current({...scope,action,id:item.id});if(v!==epoch.current)return;setItems(rows=>rows.map(row=>row.id===item.id?{...row,read:true}:row));if(action==='open')onOpen(result);}
  catch(e){if(v===epoch.current){setItems(rows=>rows.filter(row=>row.id!==item.id));setError((e as Error).message);}}
  finally{if(v===epoch.current){working.current=false;setBusy(false);}}
 }
 const labels:Record<string,string>={help:t('A student asked for help with their shared selection.','Un estudiante pidió ayuda con su selección compartida.'),requested:t('A connection request is ready to review.','Hay una solicitud de conexión para revisar.'),accepted:t('Your connection request was accepted.','Se aceptó tu solicitud de conexión.'),published:t('A shared binder has an update.','Hay una actualización en una carpeta compartida.'),feedback:t('You have new coordinator guidance.','Tienes nueva orientación de tu coordinador.'),reply:t('You have a reply to your guidance.','Tienes una respuesta a tu orientación.'),revoked:t('Shared access has ended.','El acceso compartido ha terminado.'),expiring:t('Shared access ends within seven days.','El acceso compartido termina dentro de siete días.')};
 if(!items.length&&!expanded)return null;
 return <section className="coordinator-updates" aria-label={t('Coordinator updates','Novedades del coordinador')}>
  <button type="button" className="coordinator-updates-heading" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><span>{t('Updates','Novedades')} <span className="coordinator-updates-count">{items.filter(n=>!n.read).length}</span></span><span aria-hidden="true">{expanded?'−':'+'}</span></button>
  {expanded&&<div className="coordinator-updates-content">
   <button className="text-button" disabled={busy} onClick={()=>void load()}>{t('Refresh updates','Actualizar novedades')}</button>
   {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{t('This update is no longer available, or access could not be verified. Refresh to check again.','Esta novedad ya no está disponible o no se pudo verificar el acceso. Actualiza para comprobarlo.')}</p>)}
   {!error&&!items.length&&<p>{t('You’re all caught up.','Estás al día.')}</p>}
   <ul>{items.map(item=><li key={item.id} className={item.read?'':'unread'}><div><strong>{labels[item.kind]||t('You have an update in Origen.','Tienes una novedad en Origen.')}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(t('en','es'))}</time></div><div className="coordinator-update-actions"><button type="button" disabled={busy} onClick={()=>void act(item,'open')}>{t('Open update','Abrir novedad')}</button>{!item.read&&<button type="button" disabled={busy} onClick={()=>void act(item,'read')}>{t('Mark read','Marcar como leída')}</button>}</div></li>)}</ul>
  </div>}
 </section>;
}

export function CoordinatorOperations({t}:{t:T}){
 const request=useNotificationRequest();const [data,setData]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);const version=useRef(0);
 useEffect(()=>{const clear=()=>{version.current++;setData(undefined);setError('');setBusy(false);};const stop=browserPrivacy.subscribe(clear);window.addEventListener('blur',clear);return()=>{version.current++;stop();window.removeEventListener('blur',clear);};},[]);
 async function load(){const v=++version.current;setBusy(true);setError('');try{const result=await request({action:'operations'});if(v===version.current)setData(result);}catch(e){if(v===version.current){setData(undefined);setError((e as Error).message);}}finally{if(v===version.current)setBusy(false);}}
 async function resolve(id:string,resolution:string){if(!window.confirm(t('Record this review? Disabling a coordinator ends their existing sharing access.','¿Registrar esta revisión? Desactivar a un coordinador termina su acceso compartido.')))return;const v=++version.current;setBusy(true);try{await request({action:'resolve-report',id,resolution});if(v===version.current)await load();}catch(e){if(v===version.current)setError((e as Error).message);}finally{if(v===version.current)setBusy(false);}}
 async function retry(){const v=++version.current;setBusy(true);try{await request({action:'retry-deliveries'});if(v===version.current)await load();}catch(e){if(v===version.current)setError((e as Error).message);}finally{if(v===version.current)setBusy(false);}}
 return <section className="coordinator-card coordinator-operations"><h2>{t('Sharing operations','Operaciones de acceso compartido')}</h2><p>{t('Delivery health and access checks. No student content is included.','Estado de entregas y comprobaciones de acceso. No incluye contenido de estudiantes.')}</p><button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh operations','Actualizar operaciones')}</button>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{t('Operations could not be loaded.','No se pudieron cargar las operaciones.')}</p>)}
  {data&&<>{data.failed>0&&<button className="button outline" disabled={busy} onClick={()=>void retry()}>{t('Retry failed deliveries','Reintentar entregas fallidas')}</button>}<dl className="coordinator-operations-grid">{[[t('Pending updates','Novedades pendientes'),data.pending],[t('Failed deliveries','Entregas fallidas'),data.failed],[t('Oldest pending (seconds)','Mayor espera (segundos)'),Math.round(data.oldestPendingSeconds)],[t('Denied access · 24h','Acceso denegado · 24 h'),data.events24h.authorization_denied||0],[t('Conflicts · 24h','Conflictos · 24 h'),data.events24h.publication_conflict||0],[t('Expired grants · last sweep','Accesos vencidos · última ejecución'),data.expiredGrants]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>{t('Last successful cleanup:','Última limpieza correcta:')} {data.lastSuccessAt?new Date(data.lastSuccessAt).toLocaleString(t('en','es')):t('Not yet run','Aún no se ha ejecutado')}</p>
   <h3>{t('Reports awaiting review','Reportes pendientes de revisión')}</h3>{!data.reports.length&&<p>{t('No pending reports.','No hay reportes pendientes.')}</p>}{data.reports.map((r:any)=><article key={r.id}><p>{t('Report','Reporte')}: {r.reason} · {new Date(r.createdAt).toLocaleDateString(t('en','es'))}</p><code>{r.id}</code><div className="coordinator-update-actions"><button disabled={busy} onClick={()=>void resolve(r.id,'reviewed')}>{t('Mark reviewed','Marcar como revisado')}</button><button disabled={busy} onClick={()=>void resolve(r.id,'coordinator-disabled')}>{t('Disable coordinator','Desactivar coordinador')}</button></div></article>)}</>}
 </section>;
}

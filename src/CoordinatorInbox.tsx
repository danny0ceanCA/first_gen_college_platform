import {useEffect,useRef,useState} from 'react';
import {connectionRequest} from './CoordinatorConnection';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
export default function CoordinatorInbox({organizationId,t,es,refreshVersion=0}:{organizationId:string;t:(en:string,es:string)=>string;es:boolean;refreshVersion?:number}){
 const seenRefresh=useRef(refreshVersion);
 const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);const generation=useRef(0);
 async function load(){const v=++generation.current;setLoading(true);setError('');try{const r=await connectionRequest({action:'inbox',organizationId});if(v===generation.current){setRows(r.connections);setEnabled(true);}}catch(e){if(v===generation.current){setRows([]);setEnabled(false);setError((e as Error).message);}}finally{if(v===generation.current)setLoading(false);}}
 useEffect(()=>{generation.current++;setRows([]);setEnabled(false);setError('');void load();return()=>{generation.current++;};},[organizationId]);
 useEffect(()=>{if(seenRefresh.current!==refreshVersion){seenRefresh.current=refreshVersion;generation.current++;void load();}},[refreshVersion]);
 async function decide(action:string,connectionId:string){if(busy||loading||!enabled)return;const v=generation.current;setBusy(true);try{await connectionRequest({action,organizationId,connectionId});if(v===generation.current)await load();}catch(e){if(v===generation.current)setError((e as Error).message);}finally{setBusy(false);}}
 const labels:Record<string,string>={options:t('College options','Opciones universitarias'),transfer:t('Transfer & courses','Transferencia y cursos'),costs:t('Paying for college','Pagar la universidad'),applications:t('Applications','Solicitudes')};
 return <section className="coordinator-card coordinator-inbox" aria-busy={loading||busy}>
  <div className="coordinator-inbox-heading"><h2>{t('Student connections','Conexiones con estudiantes')}</h2><button className="button outline" disabled={busy||loading} onClick={()=>void load()}>{t('Refresh connections','Actualizar conexiones')}</button></div>
  <p>{t('Students choose to send you a request. Accepting connects you; their binder stays private.','Los estudiantes deciden enviarte una solicitud. Al aceptar se conectan; su carpeta permanece privada.')}</p>
  <span className="coordinator-loading-announcement" role="status">{loading?t('Loading connections…','Cargando conexiones…'):''}</span>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators"/>:<p role="alert">{t('Could not load connections. Refresh to check your access and try again.','No se pudieron cargar las conexiones. Actualiza para comprobar tu acceso e intentar de nuevo.')}</p>)}
  <div className="coordinator-inbox-results">
   {loading&&!enabled&&<div className="coordinator-connection-placeholder" aria-hidden="true"><i/><i/><i/></div>}
   {!loading&&enabled&&rows.length===0&&<p>{t('No pending or accepted connections yet.','Aún no hay conexiones pendientes o aceptadas.')}</p>}
   {rows.map(r=><article className="coordinator-connection" key={r.id}><h3>{r.displayName}</h3><p>{r.topics.map((x:string)=>labels[x]).join(' · ')||t('No topics selected','Sin temas seleccionados')}</p>{r.status==='requested'?<><p>{t('Request expires','La solicitud vence')} {new Date(r.expiresAt).toLocaleDateString(es?'es':'en')}</p><div className="connection-actions"><button className="button primary" disabled={busy||loading} onClick={()=>void decide('accept',r.id)}>{t('Accept','Aceptar')}</button><button className="button outline" disabled={busy||loading} onClick={()=>void decide('decline',r.id)}>{t('Decline','Rechazar')}</button></div></>:<p>{t('Connected · The student chooses what to publish','Conectado · El estudiante elige qué publicar')}</p>}</article>)}
  </div>
 </section>;
}

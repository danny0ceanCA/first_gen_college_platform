import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {PenLine} from 'lucide-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import WorkspaceTalkButton from './WorkspaceTalkButton';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import type {ActionSeed} from './ActionPlan';
import type {WorkspaceTopic} from './voiceWorkspace.mjs';
import './CoordinatorGuidance.css';
type T=(en:string,es:string)=>string;
export type Guidance={id:string;topic:WorkspaceTopic;kind:string;body:string;resourceUrl:string;version:number;authorName:string;organizationName:string;createdAt:string;editedAt:string|null;withdrawn:boolean;hidden:boolean;reviewed:boolean;connectionEnded:boolean;publicationItemId:string|null;replyCount:number};
type Request=(input:Record<string,unknown>)=>Promise<any>;
type Thread={revisions:{version:number;body:string;kind:string;resourceUrl:string;createdAt:string}[];replies:{id:string;body:string;feedbackVersion:number;createdAt:string}[]};
type Draft={id?:string;version?:number;kind:string;body:string;resourceUrl:string;publicationItemId:string};
export function useGuidanceRequest():Request{
 const {getAccessTokenSilently}=useAuth0();
 return async input=>{const token=await getAccessTokenSilently();const response=await apiFetch('/api/coordinator-feedback',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const value=await response.json();if(!response.ok)throw Error(value.error||'feedback_unavailable');return value;};
}
export default function StudentGuidance({studentId,topic,t,onAction}:{studentId:string;topic?:string;t:T;onAction?:(seed:ActionSeed)=>void}){
 const request=useGuidanceRequest();
 return <GuidancePanel key={studentId} studentId={studentId} topic={topic} request={request} t={t} onAction={onAction}/>;
}
export function GuidancePanel({studentId,organizationId,grantId,publicationId,topic,entries=[],request,t,onAction}:{studentId?:string;organizationId?:string;grantId?:string;publicationId?:string;topic?:string;entries?:{id:string;topic:string;content:string}[];request:Request;t:T;onAction?:(seed:ActionSeed)=>void}){
 const staff=!!grantId,prefix=staff?'staff':'student';
 const entryScope=staff?entries.map(e=>e.id).join(','):'';
 const [items,setItems]=useState<Guidance[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[writes,setWrites]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[hidden,setHidden]=useState(false);
 const [draft,setDraft]=useState<Draft>(),[reply,setReply]=useState<{id:string;version:number;body:string}>(),[report,setReport]=useState<{id:string;version:number;reason:string}>(),[threads,setThreads]=useState<Record<string,Thread>>({});
 const epoch=useRef(0),locked=useRef(false),requestRef=useRef(request),retry=useRef<{payload:string;id:string}|undefined>(undefined);requestRef.current=request;
 const scope=staff?{organizationId,grantId}:{studentId};
 const clear=()=>{epoch.current++;locked.current=false;setItems([]);setReady(false);setThreads({});setDraft(undefined);setReply(undefined);setReport(undefined);setBusy(false);};
 async function load(){const n=++epoch.current;setReady(false);setError('');try{const data=await requestRef.current({action:`${prefix}-list`,...scope});if(n!==epoch.current||!browserPrivacy.valid())return;setItems(data.feedback);setWrites(data.writesEnabled);setReady(true);}catch(e){if(n===epoch.current){setItems([]);setThreads({});setDraft(undefined);setReply(undefined);setError((e as Error).message);}}}
 useEffect(()=>{clear();void load();const resume=()=>{clear();if(!document.hidden&&navigator.onLine)void load();};const pause=()=>clear();const unsubscribe=browserPrivacy.subscribe(pause);window.addEventListener('focus',resume);window.addEventListener('blur',pause);window.addEventListener('offline',pause);document.addEventListener('visibilitychange',resume);return()=>{epoch.current++;unsubscribe();window.removeEventListener('focus',resume);window.removeEventListener('blur',pause);window.removeEventListener('offline',pause);document.removeEventListener('visibilitychange',resume);};},[studentId,grantId,publicationId,entryScope]);
 useEffect(()=>{setDraft(undefined);setReply(undefined);setReport(undefined);setThreads({});},[topic]);
 async function mutate(input:Record<string,unknown>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');const n=epoch.current;
  const payload=JSON.stringify({...scope,...input});if(retry.current?.payload!==payload)retry.current={payload,id:crypto.randomUUID()};
  try{await requestRef.current({...scope,...input,requestId:retry.current.id});if(n!==epoch.current||!browserPrivacy.valid())return;retry.current=undefined;setDraft(undefined);setReply(undefined);setReport(undefined);setThreads({});setNotice(input.action==='student-report'?t('Report recorded for review.','Reporte registrado para revisión.'):input.action==='student-reply'?t('Your reply was sent to this coordinator.','Tu respuesta se envió a este coordinador.'):t('Saved.','Guardado.'));await load();}
  catch(e){if(n===epoch.current){const code=(e as Error).message;setError(code);if(['feedback_denied','binder_unavailable','binder_access_denied','coordinator_sharing_unavailable','feedback_unavailable'].includes(code)){clear();}}}
  finally{locked.current=false;setBusy(false);}
 }
 async function thread(f:Guidance){const n=epoch.current;setError('');try{const data=await requestRef.current({action:`${prefix}-thread`,...scope,feedbackId:f.id});if(n===epoch.current&&browserPrivacy.valid())setThreads(prev=>({...prev,[f.id]:data}));}catch(e){if(n===epoch.current)setError((e as Error).message);}}
 const date=(s:string)=>new Date(s).toLocaleString(t('en','es'),{dateStyle:'medium',timeStyle:'short'});
 const kind=(s:string)=>s==='resource'?t('Resource','Recurso'):s==='suggested-step'?t('Suggested step','Paso sugerido'):t('Guidance','Orientación');
 const selected=items.filter(f=>(!topic||topic==='summary'||f.topic===topic)&&(!f.hidden||hidden));
 const button=(f:Guidance,action:string,label:string)=><button type="button" disabled={busy} onClick={()=>void mutate({action,feedbackId:f.id,version:f.version})}>{label}</button>;
 if(!staff&&ready&&!items.length&&!writes)return null;
 return <section className="coordinator-guidance" aria-label={t('Coordinator guidance','Orientación de coordinadores')}>
  <header className="guidance-heading"><h4><PenLine size={20} aria-hidden="true"/>{t('Coordinator guidance','Orientación de coordinadores')}</h4><button type="button" disabled={busy} onClick={()=>void load()}>{t('Refresh','Actualizar')}</button></header>
  {error&&(staff&&staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{error==='feedback_changed'?t('This guidance changed. Refresh and review the latest version before trying again.','Esta orientación cambió. Actualiza y revisa la versión más reciente antes de intentar otra vez.'):error==='invalid_feedback_link'?t('Use an https:// resource link without a username or password.','Usa un enlace https:// sin nombre de usuario ni contraseña.'):error==='feedback_paused'?t('New guidance and replies are paused. Existing guidance remains available.','La orientación nueva y las respuestas están en pausa. La orientación recibida sigue disponible.'):error==='feedback_limit'?t('This thread has reached its limit. Contact your coordinator for the next step.','Este hilo llegó a su límite. Contacta a tu coordinador para continuar.'):t('Guidance could not be updated or access has ended. Refresh to check access.','No se pudo actualizar la orientación o terminó el acceso. Actualiza para comprobarlo.')}</p>)}
  {notice&&<p role="status">{notice}</p>}
  {!ready&&!error&&<p role="status">{t('Loading guidance…','Cargando orientación…')}</p>}
  {ready&&!writes&&<p>{t('New guidance and replies are paused.','La orientación nueva y las respuestas están en pausa.')}</p>}
  {ready&&!selected.length&&<p>{t('No coordinator guidance here yet.','Aún no hay orientación de coordinadores aquí.')}</p>}
  {!staff&&items.some(f=>f.hidden)&&<label className="guidance-hidden"><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/>{t('Show hidden guidance','Mostrar orientación oculta')}</label>}
  {selected.map(f=><article key={f.id} className="guidance-card">
   <p className="guidance-attribution"><PenLine size={16} aria-hidden="true"/><strong>{t('Coordinator guidance','Orientación de coordinadores')} · {f.authorName} · {f.organizationName}</strong></p>
   <p className="guidance-meta">{kind(f.kind)} · {date(f.createdAt)} · {t('Version','Versión')} {f.version}{f.editedAt&&<> · {t('Edited','Editado')} {date(f.editedAt)}</>}</p>
   {f.connectionEnded&&<p className="guidance-ended">{t('Sharing ended. This copy remains in your binder.','Terminó el acceso compartido. Esta copia permanece en tu carpeta.')}</p>}
   {f.withdrawn?<p>{t('Withdrawn by the coordinator.','Retirado por el coordinador.')}</p>:<><p className="guidance-body">{f.body}</p>{f.resourceUrl&&<a href={f.resourceUrl} target="_blank" rel="noopener noreferrer">{t('Open resource','Abrir recurso')} ↗</a>}</>}
   {!f.withdrawn&&<div className="guidance-actions">{staff?<><button type="button" disabled={busy||!writes} onClick={()=>setDraft({id:f.id,version:f.version,body:f.body,kind:f.kind,resourceUrl:f.resourceUrl,publicationItemId:f.publicationItemId||''})}>{t('Edit guidance','Editar orientación')}</button><button type="button" disabled={busy} onClick={()=>{if(window.confirm(t('Withdraw this guidance and its replies? A student’s separate next step will remain.','¿Retirar esta orientación y sus respuestas? El paso separado del estudiante se conservará.')))void mutate({action:'staff-withdraw',feedbackId:f.id,version:f.version});}}>{t('Withdraw','Retirar')}</button></>:<>
    {f.reviewed?<span>{t('Reviewed by you','Revisado por ti')}</span>:button(f,'student-review',t('Mark reviewed','Marcar como revisado'))}
    <button type="button" disabled={busy||!writes||f.connectionEnded} onClick={()=>setReply({id:f.id,version:f.version,body:''})}>{t('Reply','Responder')}</button>
    {onAction&&<button type="button" disabled={busy} onClick={()=>onAction({serial:crypto.randomUUID(),studentId:studentId!,feedbackId:f.id,version:f.version,content:f.body,topic:f.topic})}>{t('Add to my next steps','Agregar a mis próximos pasos')}</button>}
    <WorkspaceTalkButton t={t} disabled={busy} focus={{kind:'coordinator-guidance',studentId:studentId!,topic:f.topic,feedbackId:f.id,version:f.version}}/>
   </>}</div>}
   {!f.withdrawn&&<details onToggle={e=>{if(e.currentTarget.open&&!threads[f.id])void thread(f);}}><summary>{t('Edit history & replies','Historial y respuestas')} ({f.replyCount})</summary>{threads[f.id]?<><h5>{t('Guidance history','Historial de orientación')}</h5>{threads[f.id].revisions.map(r=><div className="guidance-history" key={r.version}><strong>{t('Version','Versión')} {r.version} · {kind(r.kind)} · {date(r.createdAt)}</strong><p>{r.body}</p>{r.resourceUrl&&<p>{r.resourceUrl}</p>}</div>)}<h5>{t('Student replies','Respuestas del estudiante')}</h5>{!threads[f.id].replies.length&&<p>{t('No replies sent.','No se han enviado respuestas.')}</p>}{threads[f.id].replies.map(r=><div className="guidance-reply" key={r.id}><strong>{t('Student reply','Respuesta del estudiante')} · {date(r.createdAt)} · v{r.feedbackVersion}</strong><p>{r.body}</p></div>)}</>:<p>{t('Loading thread…','Cargando hilo…')}</p>}</details>}
   {!staff&&<div className="guidance-actions guidance-manage">{button(f,f.hidden?'student-unhide':'student-hide',f.hidden?t('Show in binder','Mostrar en carpeta'):t('Hide','Ocultar'))}<button type="button" disabled={busy} onClick={()=>{if(window.confirm(t('Remove this guidance, its history, and replies? Your separate next steps stay saved.','¿Eliminar esta orientación, su historial y respuestas? Tus próximos pasos se conservan.')))void mutate({action:'student-remove',feedbackId:f.id,version:f.version});}}>{t('Remove','Eliminar')}</button><button type="button" disabled={busy} onClick={()=>setReport({id:f.id,version:f.version,reason:'abuse'})}>{t('Report','Reportar')}</button></div>}
   {reply?.id===f.id&&<form onSubmit={e=>{e.preventDefault();void mutate({action:'student-reply',feedbackId:f.id,version:reply.version,body:reply.body});}}><label>{t('Reply to','Responder a')} {f.authorName}<textarea required maxLength={2000} rows={4} value={reply.body} disabled={busy} onChange={e=>setReply({...reply,body:e.target.value})}/></label><p>{t('Only this reply is sent. Your private conversations with Origen and family stay private.','Solo se envía esta respuesta. Tus conversaciones privadas con Origen y tu familia siguen privadas.')}</p><button type="submit" disabled={busy||!reply.body.trim()}>{t('Send reply to coordinator','Enviar respuesta al coordinador')}</button><button type="button" disabled={busy} onClick={()=>setReply(undefined)}>{t('Cancel','Cancelar')}</button></form>}
   {report?.id===f.id&&<form onSubmit={e=>{e.preventDefault();void mutate({action:'student-report',feedbackId:f.id,version:report.version,reason:report.reason});}}><label>{t('Reason','Motivo')}<select value={report.reason} onChange={e=>setReport({...report,reason:e.target.value})}>{[['abuse','Abuse or harassment','Abuso o acoso'],['spam','Spam','Correo no deseado'],['inaccurate','Inaccurate guidance','Orientación incorrecta'],['privacy','Privacy concern','Problema de privacidad'],['other','Other','Otro']].map(([v,en,es])=><option value={v} key={v}>{t(en,es)}</option>)}</select></label><button disabled={busy}>{t('Submit report','Enviar reporte')}</button><button type="button" disabled={busy} onClick={()=>setReport(undefined)}>{t('Cancel','Cancelar')}</button></form>}
  </article>)}
  {staff&&ready&&writes&&topic&&topic!=='summary'&&!draft&&<button type="button" onClick={()=>setDraft({body:'',kind:'guidance',resourceUrl:'',publicationItemId:''})}>{t('Write guidance in this topic','Escribir orientación en este tema')}</button>}
  {staff&&draft&&<form className="guidance-editor" onSubmit={e=>{e.preventDefault();void mutate({action:draft.id?'staff-edit':'staff-create',...(draft.id?{feedbackId:draft.id,version:draft.version}:{topic,publicationId,publicationItemId:draft.publicationItemId||undefined}),kind:draft.kind,body:draft.body,resourceUrl:draft.resourceUrl});}}>
   <h5>{draft.id?t('Edit guidance','Editar orientación'):t('New coordinator guidance','Nueva orientación del coordinador')}</h5><p>{t('The student will see this guidance, your name, and your organization.','El estudiante verá esta orientación, tu nombre y tu organización.')}</p>
   <label>{t('Type','Tipo')}<select value={draft.kind} disabled={busy} onChange={e=>setDraft({...draft,kind:e.target.value})}>{['guidance','resource','suggested-step'].map(k=><option key={k} value={k}>{kind(k)}</option>)}</select></label>
   {!draft.id&&<label>{t('Attach to','Adjuntar a')}<select value={draft.publicationItemId} disabled={busy} onChange={e=>setDraft({...draft,publicationItemId:e.target.value})}><option value="">{t('This topic','Este tema')}</option>{entries.filter(e=>e.topic===topic).map(e=><option value={e.id} key={e.id}>{e.content.slice(0,80)}</option>)}</select></label>}
   <label>{t('Your guidance','Tu orientación')}<textarea rows={5} required maxLength={2000} disabled={busy} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label><small>{draft.body.length}/2000</small>
   <label>{t('Resource link (optional, https://)','Enlace de recurso (opcional, https://)')}<input type="url" maxLength={2000} disabled={busy} value={draft.resourceUrl} onChange={e=>setDraft({...draft,resourceUrl:e.target.value})}/></label>
   <button type="submit" disabled={busy||!draft.body.trim()}>{busy?t('Saving…','Guardando…'):t('Save guidance for student','Guardar orientación para el estudiante')}</button><button type="button" disabled={busy} onClick={()=>setDraft(undefined)}>{t('Cancel','Cancelar')}</button>
  </form>}
 </section>;
}

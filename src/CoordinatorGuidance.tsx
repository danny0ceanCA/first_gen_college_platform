import {motionDuration,motionEasing,prefersReducedMotion} from './motion';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useNavigationGuard} from './workspaceNavigation';
import {useAuth0} from '@auth0/auth0-react';
import {Check,Link2,PenLine,Send,X} from 'lucide-react';
import {commentDraftKey,holdCommentDraft,takeCommentDraft,discardCommentDraft} from './commentDrafts';
import type {StudentCommentsState} from './StudentComments';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import WorkspaceTalkButton from './WorkspaceTalkButton';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import type {ActionSeed} from './ActionPlan';
import type {WorkspaceTopic} from './voiceWorkspace.mjs';
import './CoordinatorGuidance.css';
type T=(en:string,es:string)=>string;
export type Guidance={id:string;topic:WorkspaceTopic;kind:string;body:string;resourceUrl:string;version:number;authorName:string;organizationName:string;createdAt:string;editedAt:string|null;withdrawn:boolean;hidden:boolean;reviewed:boolean;connectionEnded:boolean;replyAvailable?:boolean;publicationItemId:string|null;replyCount:number;anchor?:{id:string;kind:'note'|'memory';version:number}|null};
type Request=(input:Record<string,unknown>)=>Promise<any>;
type Thread={revisions:{version:number;body:string;kind:string;resourceUrl:string;createdAt:string}[];replies:{id:string;body:string;feedbackVersion:number;createdAt:string}[]};
type SharedEntry={id:string;topic:string;content:string;kind?:string;language?:string};
type Draft={id?:string;version?:number;kind:string;body:string;resourceUrl:string;publicationItemId:string};
export function useGuidanceRequest():Request{
 const {getAccessTokenSilently}=useAuth0();
 return async input=>{const lease=browserPrivacy.capture(typeof input.studentId==='string'?{studentId:input.studentId}:undefined);try{const token=await getAccessTokenSilently();lease.assert();const response=await apiFetch('/api/coordinator-feedback',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(15000)])});const value=await response.json();lease.assert();if(!response.ok)throw Object.assign(Error(value.error||'feedback_unavailable'),{status:response.status});return value;}finally{lease.release();}};
}
export default function StudentGuidance({studentId,topic,t,onAction}:{studentId:string;topic?:string;t:T;onAction?:(seed:ActionSeed)=>void}){
 const request=useGuidanceRequest();
 return <GuidancePanel key={studentId} studentId={studentId} topic={topic} request={request} t={t} onAction={onAction}/>;
}
export function GuidancePanel({studentId,organizationId,grantId,publicationId,topic,entries=[],request,t,onAction,paper=false,onDraftChange,renderStudent}:{studentId?:string;organizationId?:string;grantId?:string;publicationId?:string;topic?:string;entries?:SharedEntry[];paper?:boolean;onDraftChange?:(dirty:boolean)=>void;renderStudent?:(state:StudentCommentsState)=>ReactNode;request:Request;t:T;onAction?:(seed:ActionSeed)=>void}){
 const staff=!!grantId,prefix=staff?'staff':'student';
 const entryScope=staff?entries.map(e=>e.id).join(','):'';
 const [items,setItems]=useState<Guidance[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[writes,setWrites]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[hidden,setHidden]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [draft,setDraft]=useState<Draft>(),[reply,setReply]=useState<{id:string;version:number;body:string}>(),[report,setReport]=useState<{id:string;version:number;reason:string}>(),[threads,setThreads]=useState<Record<string,Thread>>({});
 const epoch=useRef(0),locked=useRef(false),requestRef=useRef(request),retry=useRef<{payload:string;id:string}|undefined>(undefined);requestRef.current=request;
 const [sent,setSent]=useState('');
 const draftRef=useRef(draft);draftRef.current=draft;
 const draftKey=commentDraftKey([organizationId,grantId,publicationId,topic]);
 useNavigationGuard(!!draft&&(!!draft.body.trim()||!!draft.resourceUrl.trim())||!!reply?.body.trim()||!!report?.reason.trim(),{locked:busy,onLeave:()=>{discardCommentDraft(draftKey);draftRef.current=undefined;setDraft(undefined);setReply(undefined);setReport(undefined);}});
 const scope=staff?{organizationId,grantId}:{studentId};
 const clear=()=>{epoch.current++;locked.current=false;setItems([]);setReady(false);setLoaded(false);setThreads({});setDraft(undefined);setReply(undefined);setReport(undefined);setBusy(false);setSent('');};
 useLayoutEffect(()=>{
  if(!sent)return;
  const note=document.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(sent)}"]`);
  const margin=note?.closest<HTMLElement>('.binder-annotation-content');
  if(note&&margin){
   // Reveal the confirmed note within its margin, without moving the binder or
   // the whole page. Its entrance animation then plays in the visible area.
   const top=note.offsetTop,bottom=top+note.offsetHeight;
   if(top<margin.scrollTop||bottom>margin.scrollTop+margin.clientHeight)margin.scrollTop=Math.max(0,top-16);
  }
  note?.focus({preventScroll:true});
 },[sent]);
 async function load(){const n=++epoch.current;setReady(false);setError('');try{const data=await requestRef.current({action:`${prefix}-list`,...scope});if(n!==epoch.current||!browserPrivacy.valid())return;setItems(data.feedback);setWrites(data.writesEnabled);setLoaded(true);setReady(true);}catch(e){if(n===epoch.current){setItems([]);setLoaded(false);setThreads({});setReply(undefined);setError((e as Error).message);}}}
 useEffect(()=>{
  clear();void load();
  const restore=()=>{const saved=takeCommentDraft(draftKey);if(saved){retry.current=saved.retry;setDraft(saved.draft);}};
  restore();
  const pause=()=>{if(staff)holdCommentDraft(draftKey,draftRef.current,retry.current);clear();};
  const resume=()=>{if(document.hidden||!navigator.onLine){pause();return;}if(staff)holdCommentDraft(draftKey,draftRef.current,retry.current);clear();restore();void load();};
  const unsubscribe=browserPrivacy.subscribe(()=>{discardCommentDraft(draftKey);clear();});
  window.addEventListener('focus',resume);window.addEventListener('blur',pause);window.addEventListener('offline',pause);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{epoch.current++;unsubscribe();window.removeEventListener('focus',resume);window.removeEventListener('blur',pause);window.removeEventListener('offline',pause);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
 },[studentId,grantId,publicationId,entryScope,topic]);
 async function mutate(input:Record<string,unknown>){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');if(input.action==='staff-create'||input.action==='staff-edit')setSent('');const n=epoch.current;
  const payload=JSON.stringify({...scope,...input});if(retry.current?.payload!==payload)retry.current={payload,id:crypto.randomUUID()};
  try{const result=await requestRef.current({...scope,...input,requestId:retry.current.id});discardCommentDraft(draftKey);if(n!==epoch.current||!browserPrivacy.valid())return;retry.current=undefined;await load();if(!browserPrivacy.valid())return;if(input.action==='staff-create'||input.action==='staff-edit'){setSent(result.id||String(input.feedbackId||''));}setDraft(undefined);setReply(undefined);setReport(undefined);setThreads({});setNotice(input.action==='student-report'?t('Report recorded for review.','Reporte registrado para revisión.'):input.action==='student-reply'?t('Your reply was sent to this coordinator.','Tu respuesta se envió a este coordinador.'):input.action==='staff-create'||input.action==='staff-edit'?t('Sent to student.','Enviado al estudiante.'):t('Saved.','Guardado.'));}
  catch(e){if(n===epoch.current){const code=(e as Error).message;setError(code);if(['feedback_denied','binder_unavailable','binder_access_denied','coordinator_sharing_unavailable'].includes(code)){discardCommentDraft(draftKey);clear();}}}
  finally{locked.current=false;setBusy(false);}
 }
 async function thread(f:Guidance){const n=epoch.current;setError('');try{const data=await requestRef.current({action:`${prefix}-thread`,...scope,feedbackId:f.id});if(n===epoch.current&&browserPrivacy.valid())setThreads(prev=>({...prev,[f.id]:data}));}catch(e){if(n===epoch.current)setError((e as Error).message);}}
 useEffect(()=>{onDraftChange?.(busy||!!draft&&(!!draft.body.trim()||!!draft.resourceUrl.trim()));return()=>onDraftChange?.(false);},[draft,busy,onDraftChange]);
 function cancelDraft(){
  if((draft?.body.trim()||draft?.resourceUrl.trim())&&!window.confirm(t('Discard this unsent comment?','¿Descartar este comentario sin enviar?')))return;
  const slot=document.activeElement?.closest('.binder-annotation-slot');
  discardCommentDraft(draftKey);setDraft(undefined);
  requestAnimationFrame(()=>slot?.querySelector<HTMLButtonElement>('.ink-add')?.focus({preventScroll:true}));
 }
 function beginDraft(publicationItemId=''){
  if(draft&&(draft.body.trim()||draft.resourceUrl.trim())&&!window.confirm(t('Discard this unsaved annotation?','¿Descartar esta anotación sin guardar?')))return;
  setDraft({body:'',kind:'guidance',resourceUrl:'',publicationItemId});
 }
 const date=(s:string)=>new Date(s).toLocaleString(t('en','es'),{dateStyle:'medium',timeStyle:'short'});
 const kind=(s:string)=>s==='resource'?t('Resource','Recurso'):s==='suggested-step'?t('Suggested step','Paso sugerido'):t('Guidance','Orientación');
 // A named page owns only its comments. Summary is not an all-topic alias.
 const selected=items.filter(f=>(!topic||f.topic===topic)&&(!f.hidden||hidden));
 const button=(f:Guidance,action:string,label:string)=><button type="button" disabled={busy} onClick={()=>void mutate({action,feedbackId:f.id,version:f.version})}>{label}</button>;
 const renderCard=(f:Guidance)=><InkComment key={f.id} id={f.id} reveal={staff&&paper} sent={sent===f.id} order={Math.max(0,selected.findIndex(item=>item.id===f.id))} className={`guidance-card${sent===f.id?' ink-just-sent':''}${!staff&&!f.reviewed&&!f.withdrawn?' comment-unread':''}`}>
   <p className="guidance-attribution"><PenLine size={16} aria-hidden="true"/><strong>{f.authorName} · {f.organizationName}{!staff&&!f.reviewed&&!f.withdrawn&&<span className="comment-new">{t('New','Nuevo')}</span>}</strong></p>
   <p className="guidance-meta">{f.publicationItemId?t('On a shared note','Sobre una nota compartida'):t('Page note','Nota de la página')} · {kind(f.kind)} · {date(f.createdAt)}{f.editedAt&&<> · {t('Edited','Editado')} {date(f.editedAt)}</>}</p>
   {f.connectionEnded&&<p className="guidance-ended">{t('Sharing ended. This copy remains in your binder.','Terminó el acceso compartido. Esta copia permanece en tu carpeta.')}</p>}
   {!staff&&!f.withdrawn&&!f.connectionEnded&&f.replyAvailable===false&&<p>{t('Replies are closed because this guidance refers to notes or a topic that are no longer shared. Your copy stays in your binder.','Las respuestas están cerradas porque esta orientación se refiere a notas o un tema que ya no se comparten. Tu copia permanece en tu carpeta.')}</p>}
   {f.withdrawn?<p>{t('Withdrawn by the coordinator.','Retirado por el coordinador.')}</p>:<><p className="guidance-body">{f.body}</p>{f.resourceUrl&&<a href={f.resourceUrl} target="_blank" rel="noopener noreferrer">{t('Open resource','Abrir recurso')} ↗</a>}</>}
   {!f.withdrawn&&<div className="guidance-actions">{staff?<><button type="button" disabled={busy||!writes} onClick={()=>setDraft({id:f.id,version:f.version,body:f.body,kind:f.kind,resourceUrl:f.resourceUrl,publicationItemId:f.publicationItemId||''})}>{t('Edit comment','Editar comentario')}</button><button type="button" disabled={busy} onClick={()=>{if(window.confirm(t('Withdraw this guidance and its replies? A student’s separate next step will remain.','¿Retirar esta orientación y sus respuestas? El paso separado del estudiante se conservará.')))void mutate({action:'staff-withdraw',feedbackId:f.id,version:f.version});}}>{t('Withdraw','Retirar')}</button></>:<>
    {f.reviewed?<span>{t('Reviewed by you','Revisado por ti')}</span>:button(f,'student-review',t('Mark read','Marcar como leído'))}
    <button type="button" disabled={busy||!writes||f.connectionEnded||f.replyAvailable!==true} onClick={()=>setReply({id:f.id,version:f.version,body:''})}>{t('Reply','Responder')}</button>
    {onAction&&<button type="button" disabled={busy} onClick={()=>onAction({serial:crypto.randomUUID(),studentId:studentId!,feedbackId:f.id,version:f.version,content:f.body,topic:f.topic})}>{t('Add to my next steps','Agregar a mis próximos pasos')}</button>}
    <WorkspaceTalkButton t={t} disabled={busy} focus={{kind:'coordinator-guidance',studentId:studentId!,topic:f.topic,feedbackId:f.id,version:f.version}}/>
   </>}</div>}
   {!f.withdrawn&&<details onToggle={e=>{if(e.currentTarget.open&&!threads[f.id])void thread(f);}}><summary>{t('Edit history & replies','Historial y respuestas')} ({f.replyCount})</summary>{threads[f.id]?<><h5>{t('Guidance history','Historial de orientación')}</h5>{threads[f.id].revisions.map(r=><div className="guidance-history" key={r.version}><strong>{t('Version','Versión')} {r.version} · {kind(r.kind)} · {date(r.createdAt)}</strong><p>{r.body}</p>{r.resourceUrl&&<p>{r.resourceUrl}</p>}</div>)}<h5>{t('Student replies','Respuestas del estudiante')}</h5>{!threads[f.id].replies.length&&<p>{t('No replies sent.','No se han enviado respuestas.')}</p>}{threads[f.id].replies.map(r=><div className="guidance-reply" key={r.id}><strong>{t('Student reply','Respuesta del estudiante')} · {date(r.createdAt)} · v{r.feedbackVersion}</strong><p>{r.body}</p></div>)}</>:<p>{t('Loading thread…','Cargando hilo…')}</p>}</details>}
   {!staff&&<details className="guidance-management"><summary>{t('More options','Más opciones')}</summary><div className="guidance-actions guidance-manage">{button(f,f.hidden?'student-unhide':'student-hide',f.hidden?t('Show in binder','Mostrar en carpeta'):t('Hide','Ocultar'))}<button type="button" disabled={busy} onClick={()=>{if(window.confirm(t('Remove this guidance, its history, and replies? Your separate next steps stay saved.','¿Eliminar esta orientación, su historial y respuestas? Tus próximos pasos se conservan.')))void mutate({action:'student-remove',feedbackId:f.id,version:f.version});}}>{t('Remove','Eliminar')}</button><button type="button" disabled={busy} onClick={()=>setReport({id:f.id,version:f.version,reason:'abuse'})}>{t('Report','Reportar')}</button></div></details>}
   {reply?.id===f.id&&<form onSubmit={e=>{e.preventDefault();void mutate({action:'student-reply',feedbackId:f.id,version:reply.version,body:reply.body});}}><label>{t('Reply to','Responder a')} {f.authorName}<textarea required maxLength={2000} rows={4} value={reply.body} disabled={busy} onChange={e=>setReply({...reply,body:e.target.value})}/></label><p>{t('Only this reply is sent. Your private conversations with Origen and family stay private.','Solo se envía esta respuesta. Tus conversaciones privadas con Origen y tu familia siguen privadas.')}</p><button type="submit" disabled={busy||!reply.body.trim()}>{t('Send reply to coordinator','Enviar respuesta al coordinador')}</button><button type="button" disabled={busy} onClick={()=>setReply(undefined)}>{t('Cancel','Cancelar')}</button></form>}
   {report?.id===f.id&&<form onSubmit={e=>{e.preventDefault();void mutate({action:'student-report',feedbackId:f.id,version:report.version,reason:report.reason});}}><label>{t('Reason','Motivo')}<select value={report.reason} onChange={e=>setReport({...report,reason:e.target.value})}>{[['abuse','Abuse or harassment','Abuso o acoso'],['spam','Spam','Correo no deseado'],['inaccurate','Inaccurate guidance','Orientación incorrecta'],['privacy','Privacy concern','Problema de privacidad'],['other','Other','Otro']].map(([v,en,es])=><option value={v} key={v}>{t(en,es)}</option>)}</select></label><button disabled={busy}>{t('Submit report','Enviar reporte')}</button><button type="button" disabled={busy} onClick={()=>setReport(undefined)}>{t('Cancel','Cancelar')}</button></form>}
  </InkComment>;
 const editor=staff&&draft&&<InkComposer><form className={`guidance-editor${paper?' ink-editor':''}`} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();cancelDraft();}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!busy&&draft.body.trim()){e.preventDefault();e.currentTarget.requestSubmit();}}} onSubmit={e=>{e.preventDefault();void mutate({action:draft.id?'staff-edit':'staff-create',...(draft.id?{feedbackId:draft.id,version:draft.version}:{topic,publicationId,publicationItemId:draft.publicationItemId||undefined}),kind:draft.kind,body:draft.body,resourceUrl:draft.resourceUrl});}}>
  <div className="ink-editor-heading"><span><PenLine size={15}/>{t('Your comment','Tu comentario')}</span><button type="button" aria-label={t('Close comment','Cerrar comentario')} disabled={busy} onClick={cancelDraft}><X size={16}/></button></div>
  <label><span>{draft.id?t('Edit red note','Editar nota roja'):draft.publicationItemId?t('On this note','Sobre esta nota'):t('In the page margin','En el margen de la página')}</span><textarea autoFocus rows={3} required maxLength={2000} disabled={busy} value={draft.body} placeholder={t('Write to the student…','Escribe al estudiante…')} aria-label={t('Your guidance','Tu orientación')} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>
  <small>{draft.body.length}/2000 · {t('Saved with your name, organization, and date.','Se guarda con tu nombre, organización y fecha.')}</small>
  <details className="ink-editor-options"><summary><Link2 size={13}/>{t('Add a link or suggest a step','Agregar un enlace o sugerir un paso')}</summary>
   <label>{t('Type','Tipo')}<select value={draft.kind} disabled={busy} onChange={e=>setDraft({...draft,kind:e.target.value})}>{['guidance','resource','suggested-step'].map(k=><option key={k} value={k}>{kind(k)}</option>)}</select></label>
   <label>{t('Resource link (optional, https://)','Enlace de recurso (opcional, https://)')}<input type="url" maxLength={2000} disabled={busy} value={draft.resourceUrl} onChange={e=>setDraft({...draft,resourceUrl:e.target.value})}/></label>
  </details>
  {error&&<p className="ink-editor-error" role="alert">{error==='invalid_feedback_link'?t('Use an https:// link, then send again.','Usa un enlace https:// y vuelve a enviar.'):error==='feedback_changed'?t('This comment changed. Refresh before editing again. Your draft is still here.','Este comentario cambió. Actualiza antes de editarlo de nuevo. Tu borrador sigue aquí.'):t('Your comment was not confirmed. Your draft is still here; try sending again.','No se confirmó tu comentario. Tu borrador sigue aquí; intenta enviarlo de nuevo.')}</p>}
  <div className="ink-editor-actions"><button type="submit" disabled={busy||!draft.body.trim()}>{busy?<span className="ink-sending" aria-hidden="true"/>:<Send size={14} aria-hidden="true"/>}{busy?t('Sending…','Enviando…'):error?t('Try sending again','Intentar enviar de nuevo'):t('Send to student','Enviar al estudiante')}</button><button type="button" disabled={busy} onClick={cancelDraft}>{t('Cancel','Cancelar')}</button></div>
 </form></InkComposer>;
 const initialLoading=paper&&!loaded&&!error;
 const annotationSlot=(anchor:string)=> <PaperSlot label={anchor?t(`Coordinator comments on note ${entries.filter(e=>e.topic===topic).findIndex(e=>e.id===anchor)+1}`,`Comentarios del coordinador sobre la nota ${entries.filter(e=>e.topic===topic).findIndex(e=>e.id===anchor)+1}`):t('Coordinator page notes','Notas del coordinador en la página')} loading={initialLoading} layoutKey={JSON.stringify([initialLoading,draft?.publicationItemId===anchor?draft.id||'new':'closed',selected.filter(f=>(f.publicationItemId||'')===anchor).map(f=>[f.id,f.version,f.withdrawn])])}>
  {initialLoading&&!draft&&<div className="ink-loading-placeholder" aria-hidden="true"><i/><i/><i/></div>}
  {selected.filter(f=>(f.publicationItemId||'')===anchor).map(renderCard)}
  {draft?.publicationItemId===anchor?editor:loaded&&writes&&<button type="button" className="ink-add" disabled={busy||!ready} onClick={()=>beginDraft(anchor)}><PenLine size={16} aria-hidden="true"/>{anchor?t('Add comment','Agregar comentario'):t('Write in the page margin','Escribir en el margen')}</button>}
 </PaperSlot>;
 const feedbackStatus=<>{error&&<p role="alert">{t('Could not refresh comments. Your writing is still here. Try again.','No se pudieron actualizar los comentarios. Tu texto sigue aquí. Intenta de nuevo.')} <button type="button" onClick={()=>void load()}>{t('Retry','Reintentar')}</button></p>}{notice&&<p role="status"><Check size={14} aria-hidden="true"/> {notice}</p>}{items.some(f=>f.hidden)&&<label className="guidance-hidden"><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/>{t('Show hidden comments','Mostrar comentarios ocultos')}</label>}</>;
 if(renderStudent)return renderStudent({items:items.filter(f=>!f.hidden||hidden),ready,render:values=>values.length?<section className="coordinator-guidance student-inline-comments" aria-label={t('Coordinator comments','Comentarios del coordinador')}>{values.map(renderCard)}</section>:null,status:<div className="student-comment-status">{feedbackStatus}</div>});
 if(!staff&&ready&&!items.length&&!writes)return null;
 return <section className={`coordinator-guidance${paper?' guidance-on-paper':''}`} aria-label={t('Coordinator guidance','Orientación de coordinadores')}>
  <header className="guidance-heading"><h4><PenLine size={20} aria-hidden="true"/>{paper?t('Write on the page','Escribe en la página'):t('Coordinator guidance','Orientación de coordinadores')}</h4><button type="button" disabled={busy} onClick={()=>void load()}>{t('Refresh','Actualizar')}</button></header>
  {error&&(!draft||staffVerificationErrors.includes(error))&&(staff&&staffVerificationErrors.includes(error)?<StaffVerification es={t('en','es')==='es'} returnTo="#coordinators"/>:<p role="alert">{error==='feedback_changed'?t('This guidance changed. Refresh and review the latest version before trying again.','Esta orientación cambió. Actualiza y revisa la versión más reciente antes de intentar otra vez.'):error==='invalid_feedback_link'?t('Use an https:// resource link without a username or password.','Usa un enlace https:// sin nombre de usuario ni contraseña.'):error==='feedback_paused'?t('New guidance and replies are paused. Existing guidance remains available.','La orientación nueva y las respuestas están en pausa. La orientación recibida sigue disponible.'):error==='feedback_limit'?t('This thread has reached its limit. Contact your coordinator for the next step.','Este hilo llegó a su límite. Contacta a tu coordinador para continuar.'):t('Guidance could not be updated or access has ended. Refresh to check access.','No se pudo actualizar la orientación o terminó el acceso. Actualiza para comprobarlo.')}</p>)}
  {notice&&<p className={paper?'guidance-loading-announcement':undefined} role="status">{notice}</p>}
  {staff&&ready&&!paper&&<p>{t('Follow up on this shared selection:','Seguimiento de esta selección compartida:')} {selected.filter(f=>!f.withdrawn&&f.kind==='suggested-step').length} {t('suggested steps','pasos sugeridos')} · {selected.reduce((n,f)=>n+f.replyCount,0)} {t('student replies. Private plan progress is not shared here.','respuestas del estudiante. El progreso del plan privado no se comparte aquí.')}</p>}
  {!ready&&!error&&<p className={paper?'guidance-loading-announcement':undefined} role="status">{t('Loading guidance…','Cargando orientación…')}</p>}
  {ready&&!writes&&<p>{t('New guidance and replies are paused.','La orientación nueva y las respuestas están en pausa.')}</p>}
  {ready&&!selected.length&&!paper&&<p>{t('No coordinator guidance here yet.','Aún no hay orientación de coordinadores aquí.')}</p>}
  {!staff&&items.some(f=>f.hidden)&&<label className="guidance-hidden"><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/>{t('Show hidden guidance','Mostrar orientación oculta')}</label>}
  {paper?<>
   <p className="ink-instructions">{t('Add a red note beside a shared entry, or write in the page margin. The student sees your saved annotations in their binder.','Agrega una nota roja junto a una nota compartida o escribe en el margen. El estudiante verá tus anotaciones guardadas en su carpeta.')}</p>
   <div className="shared-paper-entries">{entries.filter(e=>e.topic===topic).map((entry,index)=><div className="shared-paper-row" key={entry.id}>
    <article className="coordinator-published-note notebook-note" lang={entry.language} tabIndex={0} role="region" aria-label={t(`Shared note ${index+1}`,`Nota compartida ${index+1}`)}>
     <div className="notebook-note-origin"><span>{entry.kind==='question'?t('Question','Pregunta'):entry.kind==='decision'?t('Decision','Decisión'):t('Shared note','Nota compartida')}</span><span>{String(index+1).padStart(2,'0')}</span></div>
     <p className="notebook-note-content">{entry.content}</p>
    </article>
    {annotationSlot(entry.id)}
   </div>)}</div>
   <section className="shared-page-margin" aria-label={t('Page margin','Margen de la página')}><span className="ink-margin-label">{t('Page notes','Notas de la página')}</span>{annotationSlot('')}</section>
   {selected.some(f=>f.publicationItemId&&!entries.some(e=>e.id===f.publicationItemId))&&<section className="shared-earlier-annotations"><h5>{t('Notes on earlier shared entries','Notas sobre entradas compartidas antes')}</h5>{selected.filter(f=>f.publicationItemId&&!entries.some(e=>e.id===f.publicationItemId)).map(renderCard)}{draft?.id&&draft.publicationItemId&&!entries.some(e=>e.id===draft.publicationItemId)&&editor}</section>}
  </>:selected.map(renderCard)}
  {staff&&!paper&&ready&&writes&&topic&&topic!=='summary'&&!draft&&<button type="button" onClick={()=>setDraft({body:'',kind:'guidance',resourceUrl:'',publicationItemId:''})}>{t('Write guidance in this topic','Escribir orientación en este tema')}</button>}
  {!paper&&editor}
 </section>;
}

function InkComment({children,id,className,reveal,sent,order}:{children:ReactNode;id:string;className:string;reveal:boolean;sent:boolean;order:number}){
 const element=useRef<HTMLElement>(null),arrived=useRef(false);
 useLayoutEffect(()=>{
  const el=element.current;
  // Sending owns the stronger drop animation. Existing cards do not replay
  // their entrance when refreshed, edited, or re-rendered while typing.
  if(sent){arrived.current=true;return;}
  if(!el||!reveal||arrived.current)return;
  if(prefersReducedMotion()){arrived.current=true;return;}
  const animation=el.animate([{opacity:0,transform:'translate(3px,10px)'},{opacity:1,transform:'translate(0,0)'}],{duration:motionDuration('section'),delay:Math.min(order,3)*30,easing:motionEasing(),fill:'backwards'});
  // Finish the reveal before remembering it; Strict Mode may clean up an
  // initial mount immediately and then mount its effects again.
  void animation.finished.then(()=>{arrived.current=true;}).catch(()=>{});
  return()=>{animation.cancel();};
 },[reveal,sent,order]);
 return <article ref={element} className={className} data-comment-id={id} tabIndex={-1}>{children}</article>;
}

function InkComposer({children}:{children:ReactNode}){
 const surface=useRef<HTMLDivElement>(null);
 // PaperSlot owns the layout transition. Animating this child's height as well
 // made the parent remember its collapsed size until the first keystroke.
 useLayoutEffect(()=>{const el=surface.current;if(!el||prefersReducedMotion())return;const animation=el.animate([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}],{duration:motionDuration('section'),easing:motionEasing()});return()=>animation.cancel();},[]);
 return <div className="ink-composer-reveal" ref={surface}>{children}</div>;
}
function PaperSlot({children,layoutKey,label,loading=false}:{children:ReactNode;layoutKey:string;label:string;loading?:boolean}){
 const element=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null),height=useRef<number|undefined>(undefined),motion=useRef<Animation|undefined>(undefined);
 useLayoutEffect(()=>{
  const el=element.current,inner=content.current;if(!el||!inner)return;
  // Track the natural content size independently of the animated outer height,
  // including manual textarea resizing and expanded resource options.
  const observer=new ResizeObserver(()=>{
   const style=getComputedStyle(el);
   height.current=Math.max(inner.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),parseFloat(style.minHeight)||0);
  });
  observer.observe(inner);
  return()=>{observer.disconnect();motion.current?.cancel();};
 },[]);
 useLayoutEffect(()=>{
  const el=element.current;if(!el)return;
  const previous=motion.current?.playState==='running'?el.getBoundingClientRect().height:height.current;
  motion.current?.cancel();motion.current=undefined;el.removeAttribute('data-resizing');
  const next=el.getBoundingClientRect().height;height.current=next;
  if(previous===undefined||Math.abs(next-previous)<3||prefersReducedMotion())return;
  el.setAttribute('data-resizing','');
  const animation=el.animate([{height:`${previous}px`},{height:`${next}px`}],{duration:motionDuration('layout'),easing:motionEasing()});motion.current=animation;
  void animation.finished.then(()=>{if(motion.current===animation){motion.current=undefined;el.removeAttribute('data-resizing');}}).catch(()=>{});
 // Only opening, closing or replacing a comment animates the paper. Typing and
 // dirty-state renders must never replay or cancel a layout animation.
 },[layoutKey]);
 return <div ref={element} className="binder-annotation-slot"><div ref={content} className="binder-annotation-content" role="region" aria-label={label} aria-busy={loading} tabIndex={0}>{children}</div></div>;
}
